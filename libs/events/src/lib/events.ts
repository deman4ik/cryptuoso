import { Redis } from "ioredis";
import { LightshipType } from "lightship";
import { ValidationSchema } from "fastest-validator";
import { v4 as uuid } from "uuid";
import logger, { Logger } from "@cryptuoso/logger";
import { JSONParse, round, sleep } from "@cryptuoso/helpers";
import { CloudEvent as Event, CloudEventV1 } from "cloudevents";
import { BaseError } from "@cryptuoso/errors";
import { EventsCatalog, EventHandler, BASE_REDIS_PREFIX } from "./catalog";
import dayjs from "@cryptuoso/dayjs";

export { CloudEventV1 as Event };
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
export const DEAD_LETTER_TOPIC = "dead-letter";

type StreamMsgVals = string[];
type StreamMessage = [string, StreamMsgVals];

//TODO: job for deleting dead consumers

export class Events {
    #log: Logger;
    #catalog: EventsCatalog;
    #redis: Redis;
    #lightship: LightshipType;
    #consumerId: string;
    #blockTimeout: number;
    #pendingInterval: number;
    #pendingRetryRate: number;
    #pendingMinIdleTime: number;
    #pendingMaxRetries: number;
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
    constructor(redisClient: Redis, lightship: LightshipType, config?: EventsConfig) {
        this.#log = logger;
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
    }

    get log() {
        return this.#log;
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

    _parseStreamResponse(
        reply: [string, StreamMessage[]][]
    ): { [key: string]: { msgId: string; data: { [key: string]: any } }[] } {
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
                this.log.error("Failed to parse and validate event", error);
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
        try {
            //FIXME: must be [string, [string, string[]][]][]
            // but in ioredis it is [string, string[]][] 🤷
            const rawData: any = await this.#state[topic].unbalanced.redis.xread(
                "BLOCK",
                this.#blockTimeout,
                "COUNT",
                this.#state[topic].unbalanced.count,
                "STREAMS",
                topic,
                ...[this.#state[topic].unbalanced.lastId]
            );
            const beacon = this.#lightship.createBeacon();
            if (rawData) {
                const data: {
                    [key: string]: { msgId: string; data: { [key: string]: any } }[];
                } = this._parseStreamResponse(rawData);
                const events: { [key: string]: Event } = this._parseEvents(data[topic]);
                await Promise.all(
                    Object.entries(events).map(async ([msgId, event]) => {
                        this.log.info(`Handling "${topic}" event #${msgId} (${event.id})...`);
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
                                        this.log.error(
                                            error,
                                            `Failed to handle "${topic}" event #${msgId} (${event.id}) ${event.type}`
                                        );
                                        if (error instanceof BaseError && error.type === "VALIDATION") {
                                            const letter: DeadLetter = {
                                                topic,
                                                type: event.type,
                                                data,
                                                error: error.message
                                            };
                                            await this.emitDeadLetter(letter);
                                        }
                                    }
                                })
                        );

                        this.log.info(`Handled "${topic}" event #${msgId} (${event.id})`);
                    })
                );
                this.#state[topic].unbalanced.lastId = data[topic][data[topic].length - 1].msgId;
            }
            await beacon.die();
        } catch (error) {
            this.log.error(error, "Failed to receive message");
            if (error.message !== "Connection is closed.") {
                throw error;
            }
            await sleep(5000);
        }

        if (!this.#lightship.isServerShuttingDown())
            this.#state[topic].unbalanced.timerId = setTimeout(this._receiveMessagesTick.bind(this, topic), 0);
    }

    private async _receiveMessages(topic: string) {
        try {
            if (!this.#state[topic]) this.#state[topic] = {};
            this.#state[topic].unbalanced = {
                redis: this.#redis.duplicate(),
                lastId: "$",
                count: 10,
                timerId: setTimeout(this._receiveMessagesTick.bind(this, topic), 0)
            };
        } catch (error) {
            this.log.error(error);
        }
    }

    async _receiveGroupMessagesTick(topic: string, group: string) {
        try {
            //FIXME: must be [string, [string, string[]][]][]
            // but in ioredis it is [string, string[]][] 🤷
            const rawData: any = await this.#state[`${topic}-${group}`].grouped.redis.xreadgroup(
                "GROUP",
                group,
                this.#consumerId,
                "BLOCK",
                this.#blockTimeout,
                "COUNT",
                this.#state[`${topic}-${group}`].grouped.count,
                "STREAMS",
                topic,
                ">"
            );
            //  this.log.debug(rawData);
            const beacon = this.#lightship.createBeacon();
            if (rawData) {
                const data = this._parseStreamResponse(rawData);
                const events: { [key: string]: Event } = this._parseEvents(data[topic]);
                await Promise.all(
                    Object.entries(events).map(async ([msgId, event]) => {
                        try {
                            this.log.debug(`Handling "${topic}" group "${group}" event #${msgId} (${event.id})...`);
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
                            this.log.debug(`Handled "${topic}" group "${group}" event #${msgId} (${event.id})`);
                        } catch (error) {
                            this.log.error(
                                error,
                                `Failed to handle "${topic}" group "${group}" event #${msgId} (${event.id})`
                            );
                            if (error instanceof BaseError && error.type === "VALIDATION") {
                                const letter: DeadLetter = {
                                    topic,
                                    group,
                                    type: event.type,
                                    data,
                                    error: error.message
                                };
                                await this.emitDeadLetter(letter);
                                await this.#redis.xack(topic, group, msgId);
                            }
                        }
                    })
                );
            }
            await beacon.die();
        } catch (error) {
            this.log.error(error, `Failed to receive "${topic}" message`);
            if (error.message !== "Connection is closed.") {
                throw error;
            }
            await sleep(5000);
        }
        if (!this.#lightship.isServerShuttingDown())
            this.#state[`${topic}-${group}`].grouped.timerId = setTimeout(
                this._receiveGroupMessagesTick.bind(this, topic, group),
                0
            );
    }

    private async _receiveGroupMessages(topic: string, group: string) {
        try {
            if (!this.#state[`${topic}-${group}`]) this.#state[`${topic}-${group}`] = {};
            this.#state[`${topic}-${group}`].grouped = {
                redis: this.#redis.duplicate(),
                count: 20,
                timerId: setTimeout(this._receiveGroupMessagesTick.bind(this, topic, group), 0)
            };
        } catch (error) {
            this.log.error(error);
        }
    }

    async _receivePendingGroupMessagesTick(topic: string, group: string) {
        try {
            const rawData = await this.#redis.xpending(
                topic,
                group,
                "-",
                "+",
                ...[this.#state[`${topic}-${group}`].pending.count]
            );
            // this.log.debug(rawData);
            const beacon = this.#lightship.createBeacon();
            if (rawData) {
                const data: {
                    msgId: string;
                    consumer: string;
                    idleSeconds: number;
                    retries: number;
                }[] = this._parsePendingResponse(rawData);

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
                        if (result) {
                            const [event]: Event[] = Object.values(
                                this._parseEvents(this._parseMessageResponse(result))
                            );
                            try {
                                this.log.debug(
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
                                this.log.debug(
                                    `Handled pending "${topic}" group "${group}" event #${msgId} (${event.id})`
                                );
                            } catch (error) {
                                this.log.error(
                                    error,
                                    `Failed to handle pending "${topic}" group "${group}" event #${msgId} (${event.id})`
                                );
                                if (
                                    (error instanceof BaseError && error.type === "VALIDATION") ||
                                    retries >= this.#pendingMaxRetries
                                ) {
                                    const letter: DeadLetter = {
                                        topic,
                                        group,
                                        type: event.type,
                                        data,
                                        error: error.message
                                    };
                                    await this.emitDeadLetter(letter);
                                    await this.#redis.xack(topic, group, msgId);
                                }
                            }
                        }
                    } catch (error) {
                        this.log.error(error, `Failed to claim pending "${topic}" event #${msgId}`);
                    }
                }
            }
            await beacon.die();
        } catch (error) {
            this.log.error(error, `Failed to receive pending "${topic}" message`);
            if (error.message !== "Connection is closed.") {
                throw error;
            }
            await sleep(5000);
        }
        if (!this.#lightship.isServerShuttingDown()) {
            this.#state[`${topic}-${group}`].pending.timerId = setTimeout(
                this._receivePendingGroupMessagesTick.bind(this, topic, group),
                this.#pendingInterval
            );
        }
    }

    private async _receivePendingGroupMessages(topic: string, group: string) {
        try {
            if (!this.#state[`${topic}-${group}`]) this.#state[`${topic}-${group}`] = {};
            this.#state[`${topic}-${group}`].pending = {
                count: 100,
                timerId: setTimeout(this._receivePendingGroupMessagesTick.bind(this, topic, group), 0)
            };
        } catch (error) {
            this.log.error(error);
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
            await this.#redis.xadd(topic, "*", ...args);
            this.log.debug(`Emited Event ${type}`);
        } catch (error) {
            this.log.error("Failed to emit event", error, event);
        }
    }

    subscribe(events: {
        [key: string]: {
            group?: string;
            unbalanced?: boolean;
            handler: (event: Event) => Promise<void>;
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
                    this.log.info(`Subscribing to "${topic}" group "${group}" events...`);
                    await this._createGroup(topic, group);
                    await this._receiveGroupMessages(topic, group);
                    await this._receivePendingGroupMessages(topic, group);
                })
            );
            await Promise.all(
                this.#catalog.unbalancedTopics.map(async (topic) => {
                    this.log.info(`Subscribing to "${topic}" unbalanced events...`);
                    await this._receiveMessages(topic);
                })
            );
        } catch (error) {
            this.log.error(error);
        }
    }

    closeConnections() {
        try {
            this.log.info("Closing connection redis...");
            this.#redis.quit();
            this.#catalog.groups.map(async ({ topic, group }) => {
                this.log.info(`Closing connection "${topic}" group "${group}" ...`);
                this.#state[`${topic}-${group}`].grouped.redis.quit();
            });

            this.#catalog.unbalancedTopics.map(async (topic) => {
                this.log.info(`Closing connection "${topic}" unbalanced ...`);
                this.#state[topic].unbalanced.redis.quit();
            });
        } catch (error) {
            this.log.error(error);
        }
    }
}
