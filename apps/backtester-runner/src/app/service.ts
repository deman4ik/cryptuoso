import { Queue } from "bullmq";
import { v4 as uuid } from "uuid";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { CANDLES_RECENT_AMOUNT } from "@cryptuoso/helpers";
import { BaseError } from "@cryptuoso/errors";
import { Timeframe, ValidTimeframe } from "@cryptuoso/market";
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
import { RobotSettings, RobotState, StrategySettings } from "@cryptuoso/robot-state";
import { Backtester, BacktesterState, Status } from "@cryptuoso/backtester-state";
import { sql } from "@cryptuoso/postgres";

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
                    handler: this.start.bind(this),
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

    async startManyHTTPHandler(
        req: {
            body: {
                input: BacktesterRunnerStartMany;
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

    #countHistoryCandles = async (
        exchange: string,
        asset: string,
        currency: string,
        timeframe: ValidTimeframe,
        loadFrom: string,
        limit: number
    ): Promise<number> =>
        +(await this.db.pg.query(
            sql`select count(1)
            from ${sql.identifier([`candles${timeframe}`])}
            where
            exchange = ${exchange}
            and asset = ${asset}
            and currency = ${currency}
            and time < ${dayjs.utc(loadFrom).valueOf()}
                 order by time desc
                 limit ${limit} `
        ));

    async start(params: BacktesterRunnerStart | BacktesterRunnerStartMany) {
        const id: string = params.id || uuid();

        try {
            //Validation
            if (!params.robotId && !params.robotParams)
                throw new BaseError("Wrong parameters: robotId or robotParams must be specified", null, "VALIDATION");

            if (!params.robotId && (!params.robotSettings || !params.strategySettings))
                throw new BaseError(
                    "Wrong parameters: robotId or strategy and robot settings must be specified",
                    null,
                    "VALIDATION"
                );

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
            let strategySettings: StrategySettings;
            let robotSettings: RobotSettings;
            if (params.robotId) {
                const robot: {
                    exchange: string;
                    asset: string;
                    currency: string;
                    timeframe: ValidTimeframe;
                    strategyName: string;
                    strategySettings?: StrategySettings;
                    robotSettings?: RobotSettings;
                } = await this.db.pg.one(
                    sql`SELECT r.exchange, r.asset, r.currency,
                               r.timeframe, r.strategy_name, 
                               s.strategy_settings, s.robot_settings
                         FROM robots r, v_robot_settings s
                         WHERE s.robot_id = r.id
                         AND r.id = ${id};`
                );
                robotParams = {
                    exchange: robot.exchange,
                    asset: robot.asset,
                    currency: robot.currency,
                    timeframe: robot.timeframe,
                    strategyName: robot.strategyName
                };

                strategySettings = { ...robot.strategySettings };
                robotSettings = { ...robot.robotSettings };
            }

            /*
            if ("strategySettingsRange" in params) {
                //TODO: generate strategySettings from range
            }
            */

            const allStrategySettings: { [key: string]: StrategySettings } = {};
            if (params.strategySettings && !Array.isArray(params.strategySettings)) {
                strategySettings = { ...strategySettings, ...params.strategySettings };
                allStrategySettings[params.robotId || id] = strategySettings;
            }

            if (params.strategySettings && Array.isArray(params.strategySettings)) {
                params.strategySettings.forEach((settings) => {
                    allStrategySettings[uuid()] = settings;
                });
            }

            if (params.robotSettings) {
                robotSettings = { ...robotSettings, ...params.robotSettings };
            }

            // Check history
            const historyCandlesCount = await this.#countHistoryCandles(
                robotParams.exchange,
                robotParams.asset,
                robotParams.currency,
                robotParams.timeframe,
                params.dateFrom,
                robotSettings.requiredHistoryMaxBars
            );
            if (historyCandlesCount < robotSettings.requiredHistoryMaxBars)
                this.log.warn(
                    `Backtester #${id} - Not enough history candles! Required: ${robotSettings.requiredHistoryMaxBars} bars but loaded: ${historyCandlesCount} bars`
                );
            if (robotSettings.requiredHistoryMaxBars > 0 && historyCandlesCount === 0)
                throw new Error(
                    `Not enough history candles! Required: ${robotSettings.requiredHistoryMaxBars} bars but loaded: ${historyCandlesCount} bars`
                );

            const backtester = new Backtester({
                id,
                robotId: params.robotId || id,
                ...robotParams,
                dateFrom: params.dateFrom,
                dateTo: params.dateTo,
                settings: params.settings,
                strategySettings: allStrategySettings,
                robotSettings,
                status: Status.queued
            });

            await this.queues.backtest.add("single", backtester.state, {
                jobId: backtester.id,
                removeOnComplete: true
            });
            return { result: backtester.id };
        } catch (error) {
            this.log.error(error);
            await this.events.emit<BacktesterWorkerFailed>({
                type: BacktesterWorkerEvents.FAILED,
                data: { id, error: error.message }
            });
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
