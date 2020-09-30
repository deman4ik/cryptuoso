import { createLightship, LightshipType } from "lightship";
import Redis from "ioredis";
import RedLock from "redlock";
import logger, { Logger } from "@cryptuoso/logger";
import { sql, pg, pgUtil } from "@cryptuoso/postgres";
import { Events, EventsConfig } from "@cryptuoso/events";
import { sleep } from "@cryptuoso/helpers";

export interface BaseServiceConfig {
    name?: string;
    eventsConfig?: EventsConfig;
}

export class BaseService {
    #log: Logger;
    #lightship: LightshipType;
    #name: string;
    #onServiceStart: { (): Promise<void> }[] = [];
    #onServiceStop: { (): Promise<void> }[] = [];
    #redisConnection: Redis.Redis;
    #redLock: RedLock;
    #db: { sql: typeof sql; pg: typeof pg; util: typeof pgUtil };
    #events: Events;

    constructor(config?: BaseServiceConfig) {
        try {
            //TODO: check environment variables
            process.on("uncaughtException", this.#handleUncaughtException.bind(this));
            process.on("unhandledRejection", this.#handleUnhandledRejection.bind(this));
            this.#log = logger;
            this.#lightship = createLightship({
                port: +process.env.LS_PORT || 9000,
                detectKubernetes: process.env.NODE_ENV === "production"
            });
            this.#lightship.registerShutdownHandler(this.#stopService.bind(this));
            this.#name = config?.name || process.env.SERVICE;
            this.#db = {
                sql,
                pg: pg,
                util: pgUtil
            };
            this.#redisConnection = new Redis(
                process.env.REDISCS //,{enableReadyCheck: false}
            );

            this.#redLock = new RedLock([this.#redisConnection], {
                retryCount: 0,
                driftFactor: 0.01
            });

            this.#events = new Events(this.#redisConnection, this.#lightship, config?.eventsConfig);
        } catch (err) {
            console.error(err);
            process.exit(1);
        }
    }

    get log() {
        return this.#log;
    }

    get name() {
        return this.#name;
    }

    get db() {
        return this.#db;
    }

    get events() {
        return this.#events;
    }

    #handleUncaughtException = (err: Error) => {
        this.#log.error("uncaughtException", err);
    };
    #handleUnhandledRejection = (err: Error) => {
        this.#log.error("unhandledRejection", err);
    };

    #addOnStartHandler = async (func: () => Promise<void>) => {
        if (func && typeof func === "function") this.#onServiceStart.push(func.bind(this));
    };

    get addOnStartHandler() {
        return this.#addOnStartHandler;
    }

    #addOnStopHandler = async (func: () => Promise<void>) => {
        if (func && typeof func === "function") this.#onServiceStop.push(func.bind(this));
    };

    get addOnStopHandler() {
        return this.#addOnStopHandler;
    }

    #startService = async () => {
        this.#log.info(`Starting ${this.#name} service...`);
        try {
            if (this.#onServiceStart.length > 0) {
                for (const onStartFunc of this.#onServiceStart) {
                    await onStartFunc();
                }
            } else {
                await Promise.resolve();
            }
            await this.#events.start();
            this.#lightship.signalReady();
            this.#log.info(`Started ${this.#name} service`);
        } catch (err) {
            console.error(err);
            this.#log.error(err, `Failed to start ${this.#name} service`);
            process.exit(1);
        }
    };

    get startService() {
        return this.#startService;
    }

    #stopService = async () => {
        this.#log.info(`Stopping ${this.#name} service...`);
        try {
            if (this.#onServiceStop.length > 0) {
                for (const onStopFunc of this.#onServiceStop) {
                    await onStopFunc();
                }
            }
            await this.#redisConnection.quit();
            await this.#db.pg.end();
        } catch (err) {
            this.#log.error(err, `Failed to correctly stop ${this.#name} service`);
            process.exit(1);
        }
    };

    #makeLocker: {
        (resource: null, ttl: number): {
            lock: (resource: string) => Promise<void>;
            unlock: () => Promise<void>;
        };
        (resource: string, ttl: number): {
            lock: () => Promise<void>;
            unlock: () => Promise<void>;
        };
    } = (resource: string, ttl: number) => {
        if (!resource && resource !== null) throw new Error(`"resource" argument must be non-empty string or null`);

        const sleepTime = Math.trunc(0.9 * ttl);
        let lockName: string = resource;
        let ended = false;
        let lock: RedLock.Lock;

        const checkForUnlock = async () => {
            await sleep(sleepTime);
            try {
                while (!ended) {
                    lock = await lock.extend(ttl);
                    await sleep(sleepTime);
                }
            } catch (err) {
                this.log.error(`Failed to extend lock (${lockName})`, err);
            }
        };

        return {
            lock: async (resource?: string) => {
                try {
                    if (!lockName) {
                        if (!resource) throw new Error(`"resource" argument must be non-empty string`);
                        lockName = resource;
                    }

                    lock = await this.#redLock.lock(lockName, ttl);
                } catch (err) {
                    this.log.error(`Failed to lock (${lockName})` /* , err */);
                    throw err;
                }
                checkForUnlock();
            },
            unlock: async () => {
                ended = true;

                if (lock) {
                    try {
                        await lock.unlock();
                    } catch (err) {
                        this.log.error(`Failed to unlock (${lockName})`, err);
                    }
                }
            }
        };
    };

    get makeLocker() {
        return this.#makeLocker;
    }

    get redLock() {
        return this.#redLock;
    }

    get redis() {
        return this.#redisConnection;
    }

    get lightship() {
        return this.#lightship;
    }

    get isDev() {
        return this.#name.includes("-dev");
    }
}
