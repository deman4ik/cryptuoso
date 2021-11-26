import { createLightship, Lightship } from "lightship";
import {
    Job,
    JobsOptions,
    Processor,
    Queue,
    QueueEvents,
    QueueEventsOptions,
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
import { GenericObject, sleep } from "@cryptuoso/helpers";
import cron from "node-cron";

export interface BaseServiceConfig {
    name?: string;
    eventsConfig?: EventsConfig;
}

export class BaseService {
    #log: Logger;
    #lightship: Lightship;
    #name: string;
    #onServiceStart: { (): Promise<void> }[] = [];
    #onServiceStarted: { (): Promise<void> }[] = [];
    #onServiceStop: { (): Promise<void> }[] = [];
    #redisConnection: Redis.Redis;
    #redLock: RedLock;
    #db: { sql: typeof sql; pg: typeof pg; util: typeof pgUtil };
    #events: Events;
    #queues: { [key: string]: { instance: Queue<any>; scheduler: QueueScheduler; events?: QueueEvents } } = {};
    #workers: { [key: string]: Worker } = {};
    #workerConcurrency = +process.env.WORKER_CONCURRENCY || 10;
    #lockers = new Map<string, { unlock(): Promise<void> }>();
    #cleanQueueGrace = +process.env.CLEAN_QUEUE_GRACE || 1000 * 60 * 60 * 48;
    #cleanQueues = async () => {
        await Promise.all(
            Object.keys(this.#queues).map(async (name) => {
                this.log.debug(`Cleaning ${name} queue...`);
                const completed = await this.#queues[name].instance.clean(this.#cleanQueueGrace, 0, "completed");
                const failed = await this.#queues[name].instance.clean(this.#cleanQueueGrace, 0, "failed");
                this.log.debug(`Cleaned ${name} queue completed: ${completed?.length}, failed: ${failed?.length}`);
            })
        );
    };
    #queuesClean = cron.schedule("*/6 */4 * * *", this.#cleanQueues.bind(this), { scheduled: false });

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
            this.#redisConnection = new Redis(process.env.REDISCS, {
                maxRetriesPerRequest: null,
                enableReadyCheck: false,
                connectTimeout: 60000,
                //retryStrategy: this.redisRetryStrategy.bind(this),
                reconnectOnError: this.redisReconnectOnError.bind(this)
            });
            this.#redisConnection.on("error", this.#hanleRedisError.bind(this));

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

    redisRetryStrategy = (times: number) => {
        this.#log.warn(`REDIS Retries to reconnect ${times}`);
        if (times > 20) process.exit(1);
        const delay = Math.min(times * 500, 5000);
        return delay;
    };

    redisReconnectOnError = (err: Error) => {
        if (err.message.toUpperCase().includes("BUSYGROUP")) return true;
        this.#log.error(`REDIS Error: ${err.message}`, err);
        if (err.message.toLowerCase().includes("eai_again") || err.message.toLowerCase().includes("econnreset"))
            process.exit(1);
        return true;
    };

    #hanleRedisError = (err: Error) => {
        this.#log.error(`REDIS on Error: ${err.message}`, err);
        /* if (err.message.toLowerCase().includes("eai_again") || err.message.toLowerCase().includes("econnreset"))
            process.exit(1);*/
    };

    #addOnStartHandler = async (func: () => Promise<void>) => {
        if (func && typeof func === "function") this.#onServiceStart.push(func.bind(this));
    };

    get addOnStartHandler() {
        return this.#addOnStartHandler;
    }

    #addOnStartedHandler = async (func: () => Promise<void>) => {
        if (func && typeof func === "function") this.#onServiceStarted.push(func.bind(this));
    };

    get addOnStartedHandler() {
        return this.#addOnStartedHandler;
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
            if (this.#onServiceStarted.length > 0) {
                for (const onStartedFunc of this.#onServiceStarted) {
                    await onStartedFunc();
                }
            } else {
                await Promise.resolve();
            }
        } catch (err) {
            console.error(err);
            this.#log.error(`Failed to start ${this.#name} service`, err);
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
            await this.events.closeConnections();
            this.#queuesClean.stop();
            await this.#redisConnection.quit();
            await this.#db.pg.end();
            await this.#lightship.shutdown();
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

                    if (this.#lockers.has(lockName)) throw new Error("Locked locally");

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
                        if (!err.message.includes("Unable to fully release the lock on resource"))
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

    #createQueue = (
        name: string,
        queueOpts?: QueueOptions,
        schedulerOpts?: QueueSchedulerOptions,
        eventsOpts?: QueueEventsOptions,
        logOpts?: {
            completed?: boolean;
            failed?: boolean;
            stalled?: boolean;
            progress?: boolean;
        },
        light = false
    ) => {
        if (this.#queues[name]) throw new Error(`Queue ${name} already exists`);
        this.#queues[name] = {
            instance: new Queue(name, {
                ...queueOpts,
                connection: this.redis.duplicate(),
                streams: { events: { maxLen: 1000 } }
            }),
            scheduler: light
                ? null
                : new QueueScheduler(name, {
                      stalledInterval: 60000,
                      ...schedulerOpts,
                      connection: this.redis.duplicate()
                  }),
            events: light
                ? null
                : new QueueEvents(name, {
                      ...eventsOpts,
                      connection: this.redis.duplicate()
                  })
        };
        if (!light || logOpts?.completed !== false)
            this.#queues[name].events.on("completed", ({ jobId, returnvalue }) =>
                this.#jobCompletedLogger(name, jobId, returnvalue)
            );
        if (!light || logOpts?.failed !== false)
            this.#queues[name].events.on("failed", ({ jobId, failedReason }) =>
                this.#jobErrorLogger(name, jobId, failedReason)
            );
        if (!light || logOpts?.stalled !== false)
            this.#queues[name].events.on("stalled", ({ jobId }) => this.#jobStalledLogger(name, jobId));
        if (!light || logOpts?.progress !== false)
            this.#queues[name].events.on("progress", ({ jobId, data }) => this.#jobProgressLogger(name, jobId, data));
        if (!light) this.#queuesClean.start();
    };

    get createQueue() {
        return this.#createQueue;
    }

    #createLightQueue = (name: string) => {
        return this.#createQueue(name, null, null, null, null, true);
    };

    get createLightQueue() {
        return this.#createLightQueue;
    }

    #jobCompletedLogger = (name: string, jobId: string, returnvalue: string) => {
        this.log.debug(`Queue ${name} job #${jobId} - completed `, returnvalue);
    };

    #jobErrorLogger = (name: string, jobId: string, failedReason: string) => {
        this.log.error(`Queue ${name} job #${jobId} - failed - ${failedReason}`);
    };

    #jobStalledLogger = (name: string, jobId: string) => {
        this.log.error(`Queue ${name} job #${jobId} - stalled`);
    };

    #jobProgressLogger = (name: string, jobId: string, data: number | GenericObject<any>) => {
        this.log.debug(`Queue ${name} job #${jobId} - progress - ${JSON.stringify(data)}`);
    };

    #addJob = async <T>(queueName: string, jobName: string, data: T, opts?: JobsOptions): Promise<Job<any, any>> => {
        if (!this.#queues[queueName]) throw new Error(`Queue ${queueName} doesn't exists`);
        if (opts && opts.jobId) {
            const lastJob = await this.#queues[queueName].instance.getJob(opts.jobId);
            if (lastJob) {
                const lastJobState = await lastJob.getState();
                if (["unknown", "completed", "failed"].includes(lastJobState)) {
                    try {
                        await lastJob.remove();
                    } catch (e) {
                        this.log.warn(e);
                    }
                }
            }
        }
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
        this.#workers[name].on("error", (err) => {
            this.log.warn(`Worker ${name} error`, err);
        });
    };

    get createWorker() {
        return this.#createWorker;
    }

    get workerConcurrency() {
        return this.#workerConcurrency;
    }
}
