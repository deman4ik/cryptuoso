import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import {
    eventsManagementConfig,
    BASE_REDIS_PREFIX,
    DEAD_LETTER_TOPIC,
    ERRORS_TOPIC,
    DeadLetter,
    Event
} from "@cryptuoso/events";
import { UserRoles } from "@cryptuoso/user-state";
import { JSONParse } from "@cryptuoso/helpers";
import dayjs from "dayjs";
import { CloudEvent } from "cloudevents";

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
    checkInterval?: number;
    clearingChunkSize?: number;
}

export default class EventsManager extends HTTPService {
    /** in milliseconds */
    checkInterval: number;
    clearingChunkSize: number;
    #isUpdateStarted: boolean;

    constructor(config?: EventsManagerConfig) {
        super(config);

        this.checkInterval = 1000 * (config?.checkInterval || +process.env.CHECK_INTERVAL || 100);
        this.clearingChunkSize = config?.clearingChunkSize || 100;

        this.events.subscribe({
            [`${DEAD_LETTER_TOPIC}.*`]: {
                //passFullEvent: true,
                handler: this.#deadLettersHandler.bind(this)
            },
            [`${ERRORS_TOPIC}.*.*`]: {
                passFullEvent: true,
                handler: this.#errorHandler.bind(this)
            }
        });

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
        //this.addOnStopHandler(this._onServiceStop);
    }

    async _onServiceStart() {
        this.update();
    }

    //async _onServiceStop() {}

    #deadLettersHandler = async (deadLetter: DeadLetter) => {
        const event: Event = deadLetter.data;

        this.db.pg.query(this.db.sql`
            INSERT INTO dead_letters(
                event_id, topic, "type", "timestamp", data
            ) VALUES (
                ${event.id},
                ${deadLetter.topic},
                ${deadLetter.type},
                ${dayjs.utc(event.time).toISOString()},
                ${this.db.sql.json(event)}
            );
        `);
    };

    #errorHandler = async (event: CloudEvent) => {
        await this.db.pg.query(this.db.sql`
            INSERT INTO error_events (
                event_id, topic, "type", data, "timestamp"
            ) VALUES (
                ${event.id},
                ${event.type.replace("com.cryptuoso.", BASE_REDIS_PREFIX)},
                ${event.type},
                ${this.db.sql.json(event.toJSON())},
                ${dayjs.utc(event.time).toISOString()}
            );
        `);
    };

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
        if (!eventId && !topic && !type && typeof resend != "boolean") throw new Error("Few arguments provided");

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

        for (const dl of deadLetters) {
            const locker = this.makeLocker(`lock:${this.name}:re-emit.${dl.eventId}`, 3000);

            try {
                await locker.lock();
                await this.events.emitRaw(dl.topic, {
                    ...dl.data,
                    time: dayjs.utc().toISOString()
                });

                await this.db.pg.query(this.db.sql`
                    UPDATE dead_letters
                    SET processed = true
                    WHERE id = ${dl.id};
                `);
                await locker.unlock();
            } catch (err) {
                this.log.error(err);
                await locker.unlock();
            }
        }
    }

    async update(ingroneStarted = false) {
        if (!ingroneStarted && this.#isUpdateStarted) return;

        if (this.lightship.isServerShuttingDown()) {
            this.#isUpdateStarted = false;
            return;
        }

        this.#isUpdateStarted = true;

        const startTime = Date.now();

        try {
            //await this.checkStoredDeadLetters({ resend: true });

            // TODO: think about possibility of deleting dead letters before handling

            await this.clearStreams();
        } catch (err) {
            this.log.error(err);
        }

        setTimeout(this.update.bind(this), this.checkInterval - (Date.now() - startTime), true);
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

            await this.deleteExpiresEvents(stream, config.eventTTL);
            await this.deleteOldConsumers(stream, config.consumerIdleTTL);
        }
    }

    async deleteExpiresEvents(stream: string, ttl: number) {
        const threshold = (Date.now() - ttl).toString();
        let prevId = "-";

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const expiresIds = (
                await this.redis.xrange(stream, prevId, threshold, "COUNT", this.clearingChunkSize)
            ).map((raw) => raw[0]);

            if (expiresIds.length == 0) break;

            await this.redis.xdel(stream, ...expiresIds);

            if (expiresIds.length < this.clearingChunkSize) break;

            prevId = expiresIds[expiresIds.length - 1];
        }
    }

    async deleteOldConsumers(stream: string, ttl: number) {
        const groups = this._parseRedisInfoArray<RedisGroupInfo>(await this.redis.xinfo("GROUPS", stream));

        for (const group of groups) {
            if (!group.consumers) continue;

            const consumers = this._parseRedisInfoArray<RedisConsumerInfo>(
                await this.redis.xinfo("CONSUMERS", stream, group.name)
            );

            if (!consumers?.length) continue;

            const oldConsumers = consumers.filter((c) => c.pending == 0 && c.idle > ttl);

            for (const consumer of oldConsumers) {
                await this.redis.xgroup("DELCONSUMER", stream, group.name, consumer.name);
            }
        }
    }

    _parseRedisInfoArray<T extends { [key: string]: any }>(groups: string[][]): T[] {
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
}
