import { Queue } from "bullmq";
import { v4 as uuid } from "uuid";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { CANDLES_RECENT_AMOUNT } from "@cryptuoso/helpers";
import { BaseError } from "@cryptuoso/errors";
import { Timeframe } from "@cryptuoso/market";
import {
    BacktesterRunnerEvents,
    BacktesterWorkerEvents,
    BacktesterRunnerSchema,
    BacktesterRunnerStart,
    BacktesterRunnerStartMany,
    BacktesterRunnerStop,
    BacktesterWorkerCancel,
    BacktesterWorkerFailed
} from "@cryptuoso/backtester-events";
import { RobotState } from "@cryptuoso/robot-state";
import { BacktesterState } from "@cryptuoso/backtester-state";

export type BacktesterRunnerServiceConfig = HTTPServiceConfig;

export default class BacktesterRunnerService extends HTTPService {
    queues: { [key: string]: Queue<any> };
    constructor(config?: BacktesterRunnerServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                backtesterStart: {
                    inputSchema: BacktesterRunnerSchema[BacktesterRunnerEvents.START],
                    auth: true,
                    roles: ["manager", "admin"],
                    handler: this.startHTTPHandler
                },
                backtesterStartMany: {
                    inputSchema: BacktesterRunnerSchema[BacktesterRunnerEvents.START_MANY],
                    auth: true,
                    roles: ["manager", "admin"],
                    handler: this.startManyHTTPHandler
                },
                backtesterStop: {
                    inputSchema: BacktesterRunnerSchema[BacktesterRunnerEvents.STOP],
                    auth: true,
                    roles: ["manger", "admin"],
                    handler: this.stopHTTPHandler
                }
            });
            this.events.subscribe({
                [BacktesterRunnerEvents.START]: {
                    handler: this.start.bind(this),
                    schema: BacktesterRunnerSchema[BacktesterRunnerEvents.START]
                },
                [BacktesterRunnerEvents.START_MANY]: {
                    handler: this.startMany.bind(this),
                    schema: BacktesterRunnerSchema[BacktesterRunnerEvents.START_MANY]
                },
                [BacktesterRunnerEvents.STOP]: {
                    handler: this.stop.bind(this),
                    schema: BacktesterRunnerSchema[BacktesterRunnerEvents.STOP]
                }
            });
            this.addOnStartHandler(this.onStartService);
            this.addOnStopHandler(this.onStopService);
        } catch (err) {
            this.log.error(err, "While consctructing BacktesterRunnerService");
        }
    }

    async onStartService() {
        this.queues = {
            backtest: new Queue("backtest", { connection: this.redis })
        };
    }

    async onStopService() {
        await this.queues.backtest?.close();
    }

    async startHTTPHandler(
        req: {
            body: {
                input: BacktesterRunnerStart;
            };
        },
        res: any
    ) {
        const result = await this.start(req.body.input);
        res.send(result);
        res.end();
    }

    #checkJobStatus = async (id: string) => {
        const lastJob = await this.queues.backtest.getJob(id);
        if (lastJob) {
            const lastJobState = await lastJob.getState();
            if (["stuck", "completed", "failed"].includes(lastJobState)) {
                try {
                    await lastJob.remove();
                } catch (e) {
                    this.log.warn(e);
                    return lastJobState;
                }
            } else return lastJobState;
        }
        return "free";
    };

    async start(params: BacktesterRunnerStart) {
        const id: string = params.id || uuid();

        try {
            //Validation
            if (!params.robotId && !params.robotParams)
                throw new BaseError("Wrong parameters: robotId or robotParams must be specefied", null, "VALIDATION");

            if (!params.robotId && !params.robotSettings)
                throw new BaseError("Wrong parameters: robotId or robotSettings must be specefied", null, "VALIDATION");

            if (params.settings?.populateHistory && (!params.robotId || id != params.robotId))
                throw new BaseError(
                    "Wrong Backtest or Robot ID to populate history",
                    { backtestId: params.id, robotId: params.robotId },
                    "VALIDATION"
                );

            if (dayjs.utc(params.dateFrom).valueOf() >= dayjs.utc(params.dateTo).valueOf())
                throw new BaseError(
                    "Wrong parametes: dateFrom must be less than dateTo",
                    { dateFrom: params.dateFrom, dateTo: params.dateTo },
                    "VALIDATION"
                );

            // Job Status
            const jobStatus = await this.#checkJobStatus(id);

            if (jobStatus !== "free")
                throw new BaseError(`Backtest #${id} is still ${jobStatus}`, { backtestId: params.id, jobStatus });

            // Combine robot parameters and settings
            let robotParams = params.robotParams;
            let robotSettings;
            if (params.robotId) {
                const robot: RobotState = await this.db.pg.one(
                    this.db
                        .sql`select exchange, asset, currency, timeframe, strategy_name, settings from robots where id = ${id}`
                );
                robotParams = {
                    exchange: robot.exchange,
                    asset: robot.asset,
                    currency: robot.currency,
                    timeframe: robot.timeframe,
                    strategyName: robot.strategyName
                };

                robotSettings = { ...robot.settings };
            }

            if (params.robotSettings) {
                robotSettings = { ...robotSettings, ...params.robotSettings };
            }

            // Check history
            //TODO

            // Delete previous backtester state if exists
            const existedBacktest: { id: string } = await this.db.pg.maybeOne(this.db.sql`
             select id from backtests where id = ${id}
             `);
            if (existedBacktest) {
                this.log.info(`Backtester #${id} - Found previous backtest. Deleting...`);
                await this.db.pg.query(this.db.sql`delete from backtests where id = ${id}`);
            }

            //TODO queue job
        } catch (error) {
            this.log.error(error);
            await this.events.emit<BacktesterWorkerFailed>({
                type: BacktesterWorkerEvents.FAILED,
                data: { id, error: error.message }
            });
            throw error;
        }
    }

    async startManyHTTPHandler(
        req: {
            body: {
                input: BacktesterRunnerStartMany;
            };
        },
        res: any
    ) {
        const result = await this.startMany(req.body.input);
        res.send(result);
        res.end();
    }

    async startMany(params: BacktesterRunnerStartMany) {
        try {
            //TODO
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }

    async stopHTTPHandler(
        req: {
            body: {
                input: BacktesterRunnerStop;
            };
        },
        res: any
    ) {
        const result = await this.stop(req.body.input);
        res.send(result);
        res.end();
    }

    async stop(params: BacktesterRunnerStop) {
        try {
            //TODO
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }
}
