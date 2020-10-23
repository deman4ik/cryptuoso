import { createLightship, LightshipType } from "lightship";
import {
    Job,
    JobsOptions,
    Processor,
    Queue,
    QueueOptions,
    QueueScheduler,
    QueueSchedulerOptions,
    Worker,
    WorkerOptions
} from "bullmq";
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
    #queues: { [key: string]: { instance: Queue<any>; scheduler: QueueScheduler } } = {};
    #workers: { [key: string]: Worker } = {};
    #workerConcurrency = +process.env.WORKER_CONCURRENCY || 10;
    #lockers = new Map<string, { unlock(): Promise<void> }>();

    constructor(config?: BaseServiceConfig) {
        try {
            //TODO: check environment variables
            process.on("uncaughtException", this.#handleUncaughtException.bind(this));
            process.on("unhandledRejection", this.#handleUnhandledRejection.bind(this));
            this.#log = logger;
            this.#lightship = createLightship({
                port: +process.env.LS_PORT || 9000,
                detectKubernetes: process.env.NODE_ENV === "production",
                signals: process.env.NODE_ENV === "production" ? ["SIGTERM", "SIGHUP", "SIGINT"] : ["SIGTERM", "SIGHUP"]
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
            await Promise.all(
                Array.from(this.#lockers.values()).map(async (locker) => {
                    try {
                        await locker.unlock();
                    } catch (err) {
                        this.log.error(`Failed to correctly unlock locker while stopping ${this.#name} service`, err);
                    }
                })
            );
            await Promise.all(
                Object.values(this.#workers).map(async (worker) => {
                    try {
                        await worker.close();
                    } catch (err) {
                        this.log.error(`Failed to correctly close worker while stopping ${this.#name} service`, err);
                    }
                })
            );
            await Promise.all(
                Object.values(this.#queues).map(async ({ instance, scheduler }) => {
                    try {
                        await instance.close();
                        await scheduler.close();
                    } catch (err) {
                        this.log.error(`Failed to correctly close queues while stopping ${this.#name} service`, err);
                    }
                })
            );

            await this.#redisConnection.quit();
            await this.#db.pg.end();
        } catch (err) {
            this.#log.error(`Failed to correctly stop ${this.#name} service`, err);
            process.exit(1);
        }
    };

    #makeLocker: {
        (resource: null, ttl: number, extensionStep?: number): {
            lock: (resource: string) => Promise<void>;
            unlock: () => Promise<void>;
        };
        (resource: string, ttl: number, extensionStep?: number): {
            lock: () => Promise<void>;
            unlock: () => Promise<void>;
        };
    } = (resource: string, ttl: number, extensionStep = 0.5) => {
        if (!resource && resource !== null) throw new Error(`"resource" argument must be non-empty string or null`);

        let lockName: string = resource;
        let ended = false;
        let redlock: RedLock.Lock;

        const getNextTTL = (cnt: number) => (1 + cnt * extensionStep) * ttl;

        const getCheckDt = () => 0.8 * (redlock.expiration - Date.now());

        const extendUntilEnded = async () => {
            let checksCount = 0;
            await sleep(getCheckDt());
            try {
                while (!ended) {
                    ++checksCount;
                    redlock = await redlock.extend(getNextTTL(checksCount));
                    await sleep(getCheckDt());
                }
            } catch (err) {
                this.log.error(`Failed to extend lock (${lockName})`, err);
            }
        };

        const locker = {
            lock: async (resource?: string) => {
                try {
                    if (!lockName) {
                        if (!resource) throw new Error(`"resource" argument must be non-empty string`);
                        lockName = resource;
                    }

                    if (this.#lockers.has(lockName)) throw new Error("Local locked");

                    this.#lockers.set(lockName, locker);
                    redlock = await this.#redLock.lock(lockName, ttl);
                    extendUntilEnded();
                } catch (err) {
                    //if (this.#lockers.get(lockName) === locker) this.#lockers.delete(lockName);
                    await locker.unlock();

                    this.log.error(`Failed to lock (${lockName}).` /* , err */);
                    throw err;
                }
            },
            unlock: async () => {
                ended = true;

                if (this.#lockers.get(lockName) === locker) this.#lockers.delete(lockName);

                if (redlock) {
                    try {
                        await redlock.unlock();
                    } catch (err) {
                        this.log.error(`Failed to unlock (${lockName})`, err);
                    }
                }
            }
        };

        return locker;
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

    get queues() {
        return this.#queues;
    }

    #createQueue = (name: string, queueOpts?: QueueOptions, schedulerOpts?: QueueSchedulerOptions) => {
        if (this.#queues[name]) throw new Error(`Queue ${name} already exists`);
        this.#queues[name] = {
            instance: new Queue(name, { ...queueOpts, connection: this.redis.duplicate() }),
            scheduler: new QueueScheduler(name, { ...schedulerOpts, connection: this.redis.duplicate() })
        };
    };

    get createQueue() {
        return this.#createQueue;
    }

    #addJob = async <T>(queueName: string, jobName: string, data: T, opts?: JobsOptions): Promise<Job<any, any>> => {
        if (!this.#queues[queueName]) throw new Error(`Queue ${queueName} doesn't exists`);
        return this.#queues[queueName].instance.add(jobName, data, opts);
    };

    get addJob() {
        return this.#addJob;
    }

    #createWorker = async (name: string, processor: Processor, opts?: WorkerOptions) => {
        if (this.#workers[name]) throw new Error(`Worker ${name} already exists`);
        this.#workers[name] = new Worker(name, processor.bind(this), {
            lockDuration: 60000,
            connection: this.redis.duplicate(),
            concurrency: +this.#workerConcurrency,
            ...opts
        });
        /* this.#workers[name].on("error", (err) => {
            this.log.error("Worker error", err);
        });*/
    };

    get createWorker() {
        return this.#createWorker;
    }
}
