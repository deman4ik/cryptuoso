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
import { Job } from "bullmq";

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

const enum JobTypes {
    clearStreams = "clearStreams"
}

export type EventsManagerConfig = HTTPServiceConfig;

export default class EventsManager extends HTTPService {
    clearingChunkSize = 100;

    constructor(config?: EventsManagerConfig) {
        super(config);

        this.events.subscribe({
            [`${DEAD_LETTER_TOPIC}.*`]: {
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
                    eventIds: {
                        type: "array",
                        items: "uuid"
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
    }

    async _onServiceStart() {
        const queueKey = this.name;

        this.createQueue(queueKey);
        this.createWorker(queueKey, this.processJob);

        await this.addJob(queueKey, JobTypes.clearStreams, null, {
            jobId: JobTypes.clearStreams,
            repeat: {
                cron: "30 6 * * * *"
            },
            removeOnComplete: true,
            removeOnFail: 100
        });
    }

    #deadLettersHandler = async (deadLetter: DeadLetter) => {
        const event: Event = deadLetter.data;

        await this.db.pg.query(this.db.sql`
            INSERT INTO dead_letters(
                event_id, topic, "type", "timestamp", data
            ) VALUES (
                ${event.id},
                ${deadLetter.topic.replace(BASE_REDIS_PREFIX, "")},
                ${deadLetter.type},
                ${dayjs.utc(event.time).toISOString()},
                ${JSON.stringify(event)}
            );
        `);

        this.log.info(`Dead letter event: #${event.id} ${event.type} saved`);
    };

    #errorHandler = async (event: Event) => {
        await this.db.pg.query(this.db.sql`
            INSERT INTO error_events (
                event_id, topic, "type", data, "timestamp"
            ) VALUES (
                ${event.id},
                ${event.type.replace("com.cryptuoso.", "")},
                ${event.type},
                ${JSON.stringify(event.toJSON())},
                ${dayjs.utc(event.time).toISOString()}
            );
        `);

        this.log.info(`Error event: #${event.id} ${event.type} saved`);
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
        eventIds,
        topic,
        type,
        resend
    }: {
        eventId?: string;
        eventIds?: string[];
        topic?: string;
        type?: string;
        resend?: boolean;
    }) {
        if (!eventId && !eventIds?.length && !topic && !type && typeof resend != "boolean")
            throw new Error("Few arguments provided");

        const conditionEventId = eventId ? this.db.sql`AND event_id = ${eventId}` : this.db.sql``;
        const conditionEventIds = eventIds?.length
            ? this.db.sql`AND event_id = ANY(${this.db.sql.array(eventIds, this.db.sql`uuid[]`)})`
            : this.db.sql``;
        const conditionTopic = topic ? this.db.sql`AND topic = ${topic}` : this.db.sql``;
        const conditionType = type ? this.db.sql`AND "type" = ${type}` : this.db.sql``;
        const conditionResend = typeof resend == "boolean" ? this.db.sql`AND resend = ${resend}` : this.db.sql``;

        const deadLetters = await this.db.pg.any<StoredDeadLetter>(this.db.sql`
            SELECT *
            FROM dead_letters
            WHERE processed = false
                ${conditionEventId}
                ${conditionEventIds}
                ${conditionTopic}
                ${conditionType}
                ${conditionResend};
        `);

        if (!deadLetters?.length) return;

        for (const dl of deadLetters) {
            const locker = this.makeLocker(`lock:${this.name}:re-emit.${dl.eventId}`, 3000);

            try {
                await locker.lock();
                await this.events.emitRaw(`${BASE_REDIS_PREFIX}${dl.topic}`, {
                    ...dl.data,
                    time: new Date()
                });

                this.log.info(`Dead letter event: #${dl.eventId} ${dl.type} resend`);

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

    async processJob(job: Job) {
        try {
            if (this.lightship.isServerShuttingDown()) throw new Error("Server is shutting down");

            //await this.checkStoredDeadLetters({ resend: true });

            // TODO: think about possibility of deleting dead letters before handling

            if (job.name === JobTypes.clearStreams) await this.clearStreams();
            else throw new Error(`Unknown job name ${job.name}`);
        } catch (err) {
            this.log.error("Failed to process job", job, err);
            throw err;
        }
    }

    async clearStreams() {
        this.log.info("Starting events streams clean...");
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

            await this.deleteExpiredEvents(stream, config.eventTTL);
            await this.deleteOldConsumers(stream, config.consumerIdleTTL);
        }
    }

    /**
     * Removes outdated events by using dependency of Redis-Streams note id from creation time
     *
     * @param stream stream full name
     * @param ttl stream event time to live
     *
     * @description
     * It gets stream notes by chunks from oldest one to the last outdated
     * ( command: `XRANGE ${stream} - ${lastUnsuitableId} COUNT ${chunkSize}` ).
     * And then deletes by single command all notes whose id includes in current chunk
     * ( command: `XDEL ${stream} ${ids[0]} ${ids[1]} ...` ).
     */
    async deleteExpiredEvents(stream: string, ttl: number) {
        const lastUnsuitableId = (Date.now() - ttl - 1).toString();
        let prevId = "-";
        let deleted = 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const expiresIds = (
                await this.redis.xrange(stream, prevId, lastUnsuitableId, "COUNT", this.clearingChunkSize)
            ).map((raw) => raw[0]);

            if (expiresIds.length == 0) break;

            await this.redis.xdel(stream, ...expiresIds);
            deleted += expiresIds.length;
            if (expiresIds.length < this.clearingChunkSize) break;

            prevId = expiresIds[expiresIds.length - 1];
        }

        this.log.info(`${deleted} messages deleted from ${stream}`);
    }

    /**
     * Removes old consumers by using `XINFO` Redis command
     *
     * @param stream stream full name
     * @param ttl time to live of idle stream consumer
     *
     * @description
     * It gets info about stream groups, then gets info about consumers of group which has them.
     * And then deletes consumers who has no pending messages and has idle time great than `ttl` value
     * ( command: `XGROUP DELCONSUMER ${stream} ${group} ${consumer}` ).
     */
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
                this.log.info(`${consumer.name} ${group.name} deleted form ${stream}`);
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
