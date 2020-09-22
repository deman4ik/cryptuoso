import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
//import { CloudEvent } from "cloudevents";
import { eventsManagementConfig, BASE_REDIS_PREFIX, DEAD_LETTER_TOPIC, DeadLetter, Event } from "@cryptuoso/events";
import { UserRoles } from "@cryptuoso/user-state";
import { JSONParse } from '@cryptuoso/helpers';
//import { BASE_REDIS_PREFIX } from "../../../../libs/events/src/lib/catalog";

//const BASE_REDIS_PREFIX = "cpz:events:";
//const DEAD_LETTER_TOPIC = "test-events-e2e-dead-letter";
const TEST_TOPIC = "test_topic";

interface StoredDeadLetter {
    id: string;
    eventId: string;
    topic: string;
    type: string;
    data: Event;
    timestamp: string;
    resend: boolean;
    processed: boolean;
    createdAt: string;
    updatedAt: string;
}

interface RedisGroupInfo {
    name: string;
    consumers: number;
    pending: number;
    "last-delivered-id": string;
}

interface RedisConsumerInfo {
    name: string;
    pending: number;
    idle: number;
}

export interface EventsManagerConfig extends HTTPServiceConfig {
    /** in seconds */
    checkInterval: number;
    clearingChunkSize: number;
}

export default class EventsManager extends HTTPService {
    /** in milliseconds */
    checkInterval: number;
    clearingChunkSize: number;

    constructor(config?: EventsManagerConfig) {
        super(config);

        this.checkInterval = 1e3 * (config?.checkInterval || +process.env.CHECK_INTERVAL || 10);
        this.clearingChunkSize = config?.clearingChunkSize || 100;

        this.createRoutes({
            resend: {
                auth: true,
                roles: [UserRoles.admin],
                handler: this._resendHandler.bind(this),
                inputSchema: {
                    eventId: {
                        type: "uuid",
                        optional: true
                    },
                    topic: {
                        type: "string",
                        optional: true
                    },
                    type: {
                        type: "string",
                        optional: true
                    },
                    resend: {
                        type: "boolean",
                        optional: true
                    }
                }
            }
        });

        this.addOnStartHandler(this._onServiceStart);
        this.addOnStopHandler(this._onServiceStop);
    }

    async _onServiceStart() {
        this.events.subscribe({
            ["errors.*.*"]: {
                handler: this._errorsHandler.bind(this)
            },
            [`${DEAD_LETTER_TOPIC}.*`]: {
                /* passFullEvent: true, */
                handler: this._deadLettersHandler.bind(this)
            } /*  as any */,
            [TEST_TOPIC]: {
                handler: this._testHandler.bind(this)
            }
        });

        //await this._testSender();

        this.update();
    }

    async _onServiceStop() {}

    async _resendHandler(
        req: {
            body: {
                input: {
                    eventId?: string;
                    topic?: string;
                    type?: string;
                    resend?: boolean;
                };
            };
        },
        res: any
    ) {
        try {
            await this.checkStoredDeadLetters(req.body.input);
            res.send({ success: true });
        } catch (err) {
            res.send({ success: false, error: err.message });
        }

        res.end();
    }

    async deleteExpiresEvents(stream: string, ttl: number) {
        const threshold = (Date.now() - ttl).toString();
        let prevId = "-";

        while (true) {
            const ids = (await this.redis.xrange(stream, prevId, threshold, "COUNT", this.clearingChunkSize)).map(
                (raw) => raw[0]
            );

            const expiresIds = ids.filter((id) => id < threshold);

            if (expiresIds.length == 0) break;

            await this.redis.xdel(stream, ...expiresIds);

            if (expiresIds.length < ids.length) break;

            prevId = ids[ids.length - 1];
        }
    }

     _parseInfoArray<T extends { [key: string]: any }>(groups: string[][]): T[] {
        if (!(groups instanceof Array)) throw new Error("Argument must be array");

        const result: T[] = [];

        groups.forEach((group) => {
            if (!(group instanceof Array)) throw new Error("All elements must be arrays of strings");

            const parsed: { [key: string]: any } = {};

            for (let i = 0; i < group.length; i += 2) {
                parsed[group[i]] = JSONParse(group[i + 1]);
            }

            result.push(parsed as any);
        });

        return result;
    }

    async deleteOldConsumers(stream: string, ttl: number) {
        const groups = this._parseInfoArray<RedisGroupInfo>(
            await this.redis.xinfo("GROUPS", stream)
        );
        
        for(const group of groups) {
            if(!group.consumers) continue;

            const consumers = this._parseInfoArray<RedisConsumerInfo>(
                await this.redis.xinfo("CONSUMERS", stream, group.name)
            );

            if(!consumers?.length) continue;

            const oldConsumers = consumers.filter((c) => c.pending == 0 && c.idle > ttl);

            for(const consumer of oldConsumers) {
                await this.redis.xgroup("DELCONSUMER", stream, group.name, consumer.name);
            }
        }
    }

    async clearStreams() {
        const streams = await this.redis.keys(`${BASE_REDIS_PREFIX}*`);
        const { common, configs } = eventsManagementConfig;

        for (const stream of streams) {

            let config: typeof common;

            if (stream in configs) config = configs[stream];
            else {
                config = (Object.entries(configs).find(
                    ([name]) => name.slice(-1) == "*" && stream.startsWith(name.slice(0, -1))
                ) || [null, common])[1];
            }

            await this.deleteExpiresEvents(stream, 1e3 * config.eventTTL);
            await this.deleteOldConsumers(stream, 1e3 * config.consumerIdleTTL);
        }
    }

    async _updateProcessedDeadLetters(ids: string[]) {
        if (!ids.length) return;

        await this.db.pg.any(this.db.sql`
            UPDATE dead_letters
            SET processed = true
            WHERE id IN (${this.db.sql.join(ids, this.db.sql`, `)});
        `);
    }

    async checkStoredDeadLetters({
        eventId,
        topic,
        type,
        resend
    }: {
        eventId?: string;
        topic?: string;
        type?: string;
        resend?: boolean;
    }) {
        this.log.info("DB Cheking");

        const conditionEventId = eventId ? this.db.sql`AND event_id = ${eventId}` : this.db.sql``;
        const conditionTopic = topic ? this.db.sql`AND topic = ${topic}` : this.db.sql``;
        const conditionType = type ? this.db.sql`AND "type" = ${type}` : this.db.sql``;
        const conditionResend = typeof resend == "boolean" ? this.db.sql`AND resend = ${resend}` : this.db.sql``;

        const deadLetters: StoredDeadLetter[] = await this.db.pg.any(this.db.sql`
            SELECT *
            FROM dead_letters
            WHERE processed = false
                ${conditionEventId}
                ${conditionTopic}
                ${conditionType}
                ${conditionResend};
        `);

        if (!deadLetters?.length) return;

        // TODO: resolve problem of wrong event id

        for (const event of deadLetters) {
            await this.redis.xadd(
                event.topic,
                "*",
                "id",
                event.id,
                "type",
                event.type,
                "timestamp",
                event.timestamp,
                "event",
                JSON.stringify(event.data)
            );
        }

        await this._updateProcessedDeadLetters(deadLetters.map((dl) => dl.id));

        //await this._testSender();
    }

    async update() {
        if (this.lightship.isServerShuttingDown()) return;

        const startTime = Date.now();

        try {
            await this.checkStoredDeadLetters({ resend: true });

            // TODO: think about possibility of deleting dead letters before handling

            await this.clearStreams();
        } catch (err) {
            this.log.error(err);
        }

        setTimeout(this.update.bind(this), this.checkInterval - (Date.now() - startTime));
    }

    async _deadLettersHandler(deadLetter: DeadLetter) {
        console.warn("Dead Letter");
        console.log(deadLetter);

        const msgIds: string[] = deadLetter.data.map((info: any) => info.msgId);

        const tuples: [string, string, string, string, string][] = [];

        for (const msgId of msgIds) {
            /* const [{ data }] = this.events._parseMessageResponse(
                await this.redis.xrange(deadLetter.topic, msgId, msgId)
            ); */
            const [[_, rawData]] = await this.redis.xrange(deadLetter.topic, msgId, msgId);

            tuples.push([
                rawData[1], // eventId
                deadLetter.topic, // topic
                rawData[3], // type
                rawData[5], // timestamp
                rawData[7] // data (event JSON)
            ]);
        }

        this.db.pg.query(this.db.sql`
            INSERT INTO dead_letters(
                event_id, topic, "type", "timestamp", data
            )
            SELECT * FROM ${this.db.sql.unnest(tuples, [
                "uuid", // eventId
                "varchar", // topic
                "varchar", // type
                `timestamp`, // timestamp
                "jsonb" // data (event JSON)
            ])};
        `);
    }

    async _errorsHandler(event: { type: string; data: any; timestamp: string }) {
        await this.db.pg.query(this.db.sql`
            INSERT INTO error_events (
                "type", data, "timestamp"
            ) VALUES (
                ${`${BASE_REDIS_PREFIX}${event.type}`},
                ${this.db.sql.json(event.data)},
                ${event.timestamp}
            );
        `);
    }

    async _testSender() {
        await this.events.emit({
            type: TEST_TOPIC,
            data: { foo: "bar" }
        });
    }

    async _testHandler(data: any) {
        console.log(data);
        throw new Error("Test error");
    }
}
