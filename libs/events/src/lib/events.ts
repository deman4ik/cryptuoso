import Redis from "ioredis";
import { Lightship } from "lightship";
import { ValidationSchema } from "fastest-validator";
import { v4 as uuid } from "uuid";
import logger from "@cryptuoso/logger";
import { GenericObject, JSONParse, round, sleep } from "@cryptuoso/helpers";
import { CloudEvent as Event, CloudEventV1 } from "cloudevents";
import { BaseError } from "@cryptuoso/errors";
import { EventsCatalog, EventHandler, BASE_REDIS_PREFIX } from "./catalog";
import dayjs from "@cryptuoso/dayjs";

export { Event };
export interface NewEvent<T> {
    type: string;
    data: T;
    subject?: string;
}
export interface EventsConfig {
    blockTimeout?: number;
    pendingInterval?: number;
    pendingRetryRate?: number;
    pendingMinIdleTime?: number;
    pendingMaxRetries?: number;
    groupMessagesCount?: number;
    unbalancedMessagesCount?: number;
    deadLetterTopic?: string;
}

export interface DeadLetter {
    topic: string;
    group?: string;
    type: string;
    data: Event | any;
    error: string;
}

const BLOCK_TIMEOUT = 60000;
const PENDING_INTERVAL = 15000;
const PENDING_RETRY_RATE = 30;
const PENDING_MAX_RETRIES = 3;
const GROUP_MESSAGES_COUNT = 30;
const UNBALANCED_MESSAGES_COUNT = 20;
export const DEAD_LETTER_TOPIC = "dead-letter";

type StreamMsgVals = string[];
type StreamMessage = [string, StreamMsgVals];

export class Events {
    #catalog: EventsCatalog;
    #redis: Redis;
    #lightship: Lightship;
    #consumerId: string;
    #blockTimeout: number;
    #pendingInterval: number;
    #pendingRetryRate: number;
    #pendingMinIdleTime: number;
    #pendingMaxRetries: number;
    #groupMessagesCount: number;
    #unbalancedMessagesCount: number;
    #deadLetterTopic: string;
    #state: {
        [topic: string]: {
            unbalanced?: {
                redis: Redis; // need separate client for blocking
                timerId?: NodeJS.Timer;
                lastId?: string;
                count?: number;
            };
            grouped?: {
                redis: Redis; // need separate client for blocking
                timerId?: NodeJS.Timer;
                count?: number;
            };
            pending?: {
                timerId: NodeJS.Timer;
                count?: number;
            };
        };
    } = {};
    constructor(redisClient: Redis, lightship: Lightship, config?: EventsConfig) {
        this.#redis = redisClient.duplicate();
        this.#lightship = lightship;

        this.#consumerId = uuid();
        this.#catalog = new EventsCatalog();
        this.#blockTimeout = config?.blockTimeout || BLOCK_TIMEOUT;
        this.#pendingInterval = config?.pendingInterval || PENDING_INTERVAL;
        this.#pendingMinIdleTime = config?.pendingMinIdleTime || BLOCK_TIMEOUT;
        this.#pendingRetryRate = config?.pendingRetryRate || PENDING_RETRY_RATE;
        this.#pendingMaxRetries = config?.pendingMaxRetries || PENDING_MAX_RETRIES;
        this.#deadLetterTopic = config?.deadLetterTopic || DEAD_LETTER_TOPIC;
        this.#groupMessagesCount = config?.groupMessagesCount || GROUP_MESSAGES_COUNT;
        this.#unbalancedMessagesCount = config?.unbalancedMessagesCount || UNBALANCED_MESSAGES_COUNT;
    }

    _parseObjectResponse(reply: StreamMsgVals): { [key: string]: any } {
        const data: { [key: string]: any } = {};
        for (let i = 0; i < reply.length; i += 2) {
            data[reply[i]] = JSONParse(reply[i + 1]);
        }
        return data;
    }

    _parseMessageResponse(reply: StreamMessage[]): { msgId: string; data: { [key: string]: any } }[] {
        return reply.map((message) => {
            return {
                msgId: message[0],
                data: this._parseObjectResponse(message[1])
            };
        });
    }

    _parseStreamResponse(reply: [string, StreamMessage[]][]): {
        [key: string]: { msgId: string; data: { [key: string]: any } }[];
    } {
        const object: { [key: string]: { msgId: string; data: { [key: string]: any } }[] } = {};
        for (const stream of reply) {
            object[stream[0]] = this._parseMessageResponse(stream[1]);
        }
        return object;
    }

    _parsePendingResponse(
        reply: string[][]
    ): { msgId: string; consumer: string; idleSeconds: number; retries: number }[] {
        if (!reply || reply.length === 0) return [];
        return reply.map((message: string[]) => ({
            msgId: message[0],
            consumer: message[1],
            idleSeconds: round(parseInt(message[2]) / 1000),
            retries: parseInt(message[3])
        }));
    }

    _parseEvents(rawEvents: { msgId: string; data: { [key: string]: any } }[]): { [key: string]: Event } {
        const events: { [key: string]: Event } = {};
        for (const {
            msgId,
            data: { event }
        } of rawEvents) {
            try {
                const newEvent = new Event(event);
                events[msgId] = newEvent;
            } catch (error) {
                logger.error(`Failed to parse and validate event - ${error.message}`);
            }
        }
        return events;
    }

    private async _createGroup(topic: string, group: string) {
        try {
            await this.#redis.xgroup("CREATE", topic, group, "0", "MKSTREAM");
        } catch (err) {
            if (!err.message.includes("BUSYGROUP")) throw err;
        }
    }

    async _receiveMessagesTick(topic: string) {
        const beacon = this.#lightship.createBeacon();
        try {
            const rawData = await this.#state[topic].unbalanced.redis.xread(
                "COUNT",
                this.#state[topic].unbalanced.count,
                "BLOCK",
                this.#blockTimeout,
                "STREAMS",
                topic,
                this.#state[topic].unbalanced.lastId
            );
            // logger.debug("_receiveMessagesTick");
            //  logger.debug(JSON.stringify(rawData) || "no data");
            if (rawData) {
                const data: {
                    [key: string]: { msgId: string; data: { [key: string]: any } }[];
                } = this._parseStreamResponse(rawData);
                const events: { [key: string]: Event } = this._parseEvents(data[topic]);
                await Promise.all(
                    Object.entries(events).map(async ([msgId, event]) => {
                        logger.info(`Handling "${topic}" event #${msgId} (${event.id})...`);
                        await Promise.all(
                            this.#catalog
                                .getUnbalancedHandlers(topic, event.type)
                                .map(async ({ handler, validate, passFullEvent }: EventHandler) => {
                                    try {
                                        const validationErrors = await validate(event.toJSON());
                                        const data = passFullEvent ? event : event.data;
                                        if (validationErrors === true) await handler(data);
                                        else
                                            throw new BaseError(
                                                validationErrors.map((e) => e.message).join(" "),
                                                { validationErrors },
                                                "VALIDATION"
                                            );
                                    } catch (error) {
                                        logger.error(
                                            `Failed to handle "${topic}" event #${msgId} (${event.id}) ${event.type}  - ${error.message}`
                                        );

                                        const letter: DeadLetter = {
                                            topic,
                                            type: event.type,
                                            data: event,
                                            error: error.message
                                        };
                                        await this.emitDeadLetter(letter);
                                    }
                                })
                        );

                        logger.info(`Handled "${topic}" event #${msgId} (${event.id})`);
                    })
                );
                this.#state[topic].unbalanced.lastId =
                    data[topic][data[topic].length - 1]?.msgId || this.#state[topic].unbalanced.lastId;
            }
        } catch (error) {
            logger.error(`Failed to receive message - ${error.message}`, error);
            await sleep(5000);
        } finally {
            await beacon.die();
            if (!this.#lightship.isServerShuttingDown())
                this.#state[topic].unbalanced.timerId = setTimeout(this._receiveMessagesTick.bind(this, topic), 0);
        }
    }

    private async _receiveMessages(topic: string) {
        try {
            if (!this.#state[topic]) this.#state[topic] = {};
            this.#state[topic].unbalanced = {
                redis: this.#redis.duplicate(),
                lastId: "$",
                count: this.#unbalancedMessagesCount,
                timerId: setTimeout(this._receiveMessagesTick.bind(this, topic), 0)
            };
        } catch (error) {
            logger.error(error.message);
        }
    }

    async _receiveGroupMessagesTick(topic: string, group: string) {
        const beacon = this.#lightship.createBeacon();
        try {
            const rawData = await this.#state[`${topic}-${group}`].grouped.redis.xreadgroup(
                "GROUP",
                group,
                this.#consumerId,

                "COUNT",
                this.#state[`${topic}-${group}`].grouped.count,
                "BLOCK",
                this.#blockTimeout,
                "STREAMS",
                topic,
                ">"
            );
            // logger.debug("_receiveGroupMessagesTick");
            //  logger.debug(JSON.stringify(rawData) || "no data");
            if (rawData) {
                const data = this._parseStreamResponse(rawData as [string, StreamMessage[]][]);
                const events: { [key: string]: Event } = this._parseEvents(data[topic]);
                await Promise.all(
                    Object.entries(events).map(async ([msgId, event]) => {
                        try {
                            logger.debug(`Handling "${topic}" group "${group}" event #${msgId} (${event.id})...`);
                            const handlers: EventHandler[] = this.#catalog.getGroupHandlers(topic, group, event.type);
                            for (const { handler, validate, passFullEvent } of handlers) {
                                const validationErrors = await validate(event.toJSON());
                                const data = passFullEvent ? event : event.data;
                                if (validationErrors === true) await handler(data);
                                else
                                    throw new BaseError(
                                        validationErrors.map((e) => e.message).join(" "),
                                        { validationErrors },
                                        "VALIDATION"
                                    );
                            }

                            await this.#state[`${topic}-${group}`].grouped.redis.xack(topic, group, msgId);
                            logger.debug(`Handled "${topic}" group "${group}" event #${msgId} (${event.id})`);
                        } catch (error) {
                            logger.error(
                                `Failed to handle "${topic}" group "${group}" event #${msgId} (${event.id})  - ${error.message}`
                            );
                            if (error instanceof BaseError && error.type === "VALIDATION") {
                                const letter: DeadLetter = {
                                    topic,
                                    group,
                                    type: event.type,
                                    data: event,
                                    error: error.message
                                };
                                await this.emitDeadLetter(letter);
                                await this.#redis.xack(topic, group, msgId);
                            }
                        }
                    })
                );
            }
        } catch (error) {
            logger.error(`Failed to receive "${topic}" message  - ${error.message}`, error);
            if (error.message.includes("NOGROUP")) {
                await this._createGroup(topic, group);
            }
            await sleep(5000);
        } finally {
            await beacon.die();
            if (!this.#lightship.isServerShuttingDown())
                this.#state[`${topic}-${group}`].grouped.timerId = setTimeout(
                    this._receiveGroupMessagesTick.bind(this, topic, group),
                    0
                );
        }
    }

    private async _receiveGroupMessages(topic: string, group: string) {
        try {
            if (!this.#state[`${topic}-${group}`]) this.#state[`${topic}-${group}`] = {};
            this.#state[`${topic}-${group}`].grouped = {
                redis: this.#redis.duplicate(),
                count: this.#groupMessagesCount,
                timerId: setTimeout(this._receiveGroupMessagesTick.bind(this, topic, group), 0)
            };
        } catch (error) {
            logger.error(error.message);
        }
    }

    async _receivePendingGroupMessagesTick(topic: string, group: string) {
        const beacon = this.#lightship.createBeacon();
        try {
            const rawData = await this.#redis.xpending(
                topic,
                group,
                "-",
                "+",
                this.#state[`${topic}-${group}`].pending.count
            );

            if (rawData) {
                const data: {
                    msgId: string;
                    consumer: string;
                    idleSeconds: number;
                    retries: number;
                }[] = this._parsePendingResponse(rawData as string[][]);

                for (const { msgId, retries } of data.filter(
                    ({ idleSeconds, retries }) => idleSeconds > retries * this.#pendingRetryRate
                )) {
                    try {
                        const result = await this.#redis.xclaim(
                            topic,
                            group,
                            this.#consumerId,
                            this.#pendingMinIdleTime,
                            msgId
                        );

                        if (result && Array.isArray(result) && result.length && result[0]) {
                            const [event]: Event[] = Object.values(
                                this._parseEvents(this._parseMessageResponse(result))
                            );

                            if (!event) continue;

                            try {
                                logger.debug(
                                    `Handling pending "${topic}" group "${group}" event #${msgId} (${event.id})...`
                                );
                                const handlers: EventHandler[] = this.#catalog.getGroupHandlers(
                                    topic,
                                    group,
                                    event.type
                                );
                                for (const { handler, validate, passFullEvent } of handlers) {
                                    const validationErrors = await validate(event.toJSON());
                                    const data = passFullEvent ? event : event.data;
                                    if (validationErrors === true) await handler(data);
                                    else
                                        throw new BaseError(
                                            validationErrors.map((e) => e.message).join(" "),
                                            { validationErrors },
                                            "VALIDATION"
                                        );
                                }
                                await this.#redis.xack(topic, group, msgId);
                                logger.debug(
                                    `Handled pending "${topic}" group "${group}" event #${msgId} (${event.id})`
                                );
                            } catch (error) {
                                logger.error(
                                    `Failed to handle pending "${topic}" group "${group}" event #${msgId} (${event.id})  - ${error.message}`
                                );
                                if (
                                    (error instanceof BaseError && error.type === "VALIDATION") ||
                                    retries >= this.#pendingMaxRetries
                                ) {
                                    const letter: DeadLetter = {
                                        topic,
                                        group,
                                        type: event.type,
                                        data: event,
                                        error: error.message
                                    };
                                    await this.emitDeadLetter(letter);
                                    await this.#redis.xack(topic, group, msgId);
                                }
                            }
                        }
                    } catch (error) {
                        logger.error(`Failed to claim pending "${topic}" event #${msgId}  - ${error.message}`, error);
                    }
                }
            }
        } catch (error) {
            logger.error(`Failed to receive pending "${topic}" message - ${error.message}`, error);

            if (error.message.includes("NOGROUP")) {
                await this._createGroup(topic, group);
            }
            await sleep(5000);
        } finally {
            await beacon.die();
            if (!this.#lightship.isServerShuttingDown()) {
                this.#state[`${topic}-${group}`].pending.timerId = setTimeout(
                    this._receivePendingGroupMessagesTick.bind(this, topic, group),
                    this.#pendingInterval
                );
            }
        }
    }

    private async _receivePendingGroupMessages(topic: string, group: string) {
        try {
            if (!this.#state[`${topic}-${group}`]) this.#state[`${topic}-${group}`] = {};
            this.#state[`${topic}-${group}`].pending = {
                count: this.#groupMessagesCount,
                timerId: setTimeout(this._receivePendingGroupMessagesTick.bind(this, topic, group), 0)
            };
        } catch (error) {
            logger.error(error.message);
        }
    }

    async emitDeadLetter(deadLetter: DeadLetter) {
        const typeChunks = deadLetter.type.split(".");
        const evt = {
            type: `${this.#deadLetterTopic}.${typeChunks.slice(2, typeChunks.length).join(".")}`,
            data: deadLetter
        };
        await this.emit(evt);
    }

    async emit<T>(event: NewEvent<T>) {
        try {
            const { type, data, subject } = event;
            const [topicName] = type.split(".", 1);
            const topic = `${BASE_REDIS_PREFIX}${topicName}`;
            const cloudEvent = new Event({
                source: `https://${process.env.SERVICE || "events"}.cryptuoso.com`,
                specversion: "1.0",
                datacontenttype: "application/json",
                type: `com.cryptuoso.${type}`,
                data,
                subject
            });

            const args = [
                "id",
                cloudEvent.id,
                "type",
                cloudEvent.type,
                "timestamp",
                dayjs.utc(cloudEvent.time).toISOString(),
                "event",
                JSON.stringify(cloudEvent.toJSON())
            ];
            const result = await this.#redis.xadd(topic, "*", ...args);
            logger.debug(`Emited Event ${type} - ${result}`);
        } catch (error) {
            logger.error(`Failed to emit event - ${error.message}`, event);
        }
    }

    async emitRaw(topic: string, event: CloudEventV1<GenericObject<any>>) {
        try {
            const cloudEvent = new Event(event);

            const args = [
                "id",
                cloudEvent.id,
                "type",
                cloudEvent.type,
                "timestamp",
                dayjs.utc(cloudEvent.time).toISOString(),
                "event",
                JSON.stringify(cloudEvent.toJSON())
            ];
            await this.#redis.xadd(topic, "*", ...args);
            logger.debug(`Emited Raw Event ${cloudEvent.type}`);
        } catch (error) {
            logger.error(`Failed to emit event - ${error.message}`, event);
        }
    }

    subscribe(events: {
        [key: string]: {
            group?: string;
            unbalanced?: boolean;
            handler: (event: Event | any) => Promise<void>;
            passFullEvent?: boolean;
            schema?: ValidationSchema;
        };
    }): void {
        this.#catalog.add(events);
    }

    async start() {
        try {
            await this._createGroup(`${BASE_REDIS_PREFIX}${this.#deadLetterTopic}`, this.#deadLetterTopic);
            await Promise.all(
                this.#catalog.groups.map(async ({ topic, group }) => {
                    logger.info(`Subscribing to "${topic}" group "${group}" events...`);
                    await this._createGroup(topic, group);
                    await this._receiveGroupMessages(topic, group);
                    await this._receivePendingGroupMessages(topic, group);
                })
            );
            await Promise.all(
                this.#catalog.unbalancedTopics.map(async (topic) => {
                    logger.info(`Subscribing to "${topic}" unbalanced events...`);
                    await this._receiveMessages(topic);
                })
            );
        } catch (error) {
            logger.error(error.message);
        }
    }

    async closeConnections() {
        try {
            logger.info("Closing connection redis...");
            await this.#redis.quit();
            this.#catalog.groups.map(async ({ topic, group }) => {
                logger.info(`Closing connection "${topic}" group "${group}" ...`);
                clearInterval(this.#state[`${topic}-${group}`].grouped.timerId);
                await this.#state[`${topic}-${group}`].grouped.redis.quit();
            });

            this.#catalog.unbalancedTopics.map(async (topic) => {
                logger.info(`Closing connection "${topic}" unbalanced ...`);
                clearInterval(this.#state[topic].unbalanced.timerId);
                await this.#state[topic].unbalanced.redis.quit();
            });
        } catch (error) {
            logger.error(error.message);
        }
    }
}
