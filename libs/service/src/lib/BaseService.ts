import { createLightship, LightshipType } from "lightship";
import Redis from "ioredis";
import logger, { Logger } from "@cryptuoso/logger";
import { sql, pg, pgUtil } from "@cryptuoso/postgres";
import { Events } from "@cryptuoso/events";

export interface BaseServiceConfig {
    name?: string;
    blockTimeout?: number;
}

export class BaseService {
    #log: Logger;
    #lightship: LightshipType;
    #name: string;
    #onServiceStart: { (): Promise<void> }[] = [];
    #onServiceStop: { (): Promise<void> }[] = [];
    #redisConnection: Redis.Redis;
    #db: { sql: typeof sql; pg: typeof pg; util: typeof pgUtil };
    #blockTimeout: number;
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
            this.#blockTimeout = config?.blockTimeout;
            this.#db = {
                sql,
                pg: pg,
                util: pgUtil
            };
            this.#redisConnection = new Redis(
                process.env.REDISCS //,{enableReadyCheck: false}
            );
            this.#events = new Events(this.#redisConnection, this.#lightship, this.#blockTimeout);
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

    get redis() {
        return this.#redisConnection;
    }
}
