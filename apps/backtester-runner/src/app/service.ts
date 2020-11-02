import { v4 as uuid } from "uuid";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { BaseError } from "@cryptuoso/errors";
import { CandleType, ValidTimeframe } from "@cryptuoso/market";
import {
    BacktesterRunnerEvents,
    BacktesterWorkerEvents,
    BacktesterRunnerSchema,
    BacktesterRunnerStart,
    BacktesterRunnerStop,
    BacktesterWorkerCancel,
    BacktesterWorkerFailed
} from "@cryptuoso/backtester-events";
import { RobotStatus } from "@cryptuoso/robot-state";
import { Backtester, Status } from "@cryptuoso/backtester-state";
import { sql } from "@cryptuoso/postgres";
import { RobotSettings, StrategySettings } from "@cryptuoso/robot-settings";

export type BacktesterRunnerServiceConfig = HTTPServiceConfig;

export default class BacktesterRunnerService extends HTTPService {
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
                [BacktesterRunnerEvents.STOP]: {
                    handler: this.stop.bind(this),
                    schema: BacktesterRunnerSchema[BacktesterRunnerEvents.STOP]
                }
            });
            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error(err, "While constructing BacktesterRunnerService");
        }
    }

    async onServiceStart() {
        this.createQueue("backtest");
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
        const lastJob = await this.queues["backtest"].instance.getJob(id);
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
        +(await this.db.pg.query<string>(
            sql`SELECT count(1) FROM (SELECT id
            FROM ${sql.identifier([`candles${timeframe}`])}
            WHERE exchange = ${exchange}
              AND asset = ${asset}
              AND currency = ${currency}
              AND type != ${CandleType.previous}
              AND time < ${dayjs.utc(loadFrom).valueOf()}
            ORDER BY time DESC
            LIMIT ${limit}) t`
        ));

    async start(params: BacktesterRunnerStart) {
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
                const robot = await this.db.pg.one<{
                    exchange: string;
                    asset: string;
                    currency: string;
                    timeframe: ValidTimeframe;
                    strategy: string;
                    status: RobotStatus;
                    strategySettings?: StrategySettings;
                    robotSettings?: RobotSettings;
                }>(
                    sql`SELECT r.exchange, r.asset, r.currency,
                               r.timeframe, r.strategy, 
                               r.status,
                               s.strategy_settings, s.robot_settings
                         FROM robots r, v_robot_settings s
                         WHERE s.robot_id = r.id
                         AND r.id = ${params.robotId};`
                );
                if (params.settings?.populateHistory && robot.status !== RobotStatus.starting)
                    throw new BaseError(`Wrong Robot status "${status}" must be "${RobotStatus.starting}"`, {
                        backtestId: params.id,
                        robotId: params.robotId
                    });
                robotParams = {
                    exchange: robot.exchange,
                    asset: robot.asset,
                    currency: robot.currency,
                    timeframe: robot.timeframe,
                    strategy: robot.strategy
                };

                strategySettings = { ...robot.strategySettings };
                robotSettings = { ...robot.robotSettings };
            }

            /*
            TODO: generate strategySettings from range
            if ("strategySettingsRange" in params) {
                
            }
            */

            const allStrategySettings: { [key: string]: StrategySettings } = {};
            if (!Array.isArray(params.strategySettings)) {
                strategySettings = { ...strategySettings, ...params.strategySettings };
                allStrategySettings[params.robotId || id] = strategySettings;
            } else if (params.strategySettings && Array.isArray(params.strategySettings)) {
                params.strategySettings.forEach((settings: StrategySettings) => {
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
                strategySettings.requiredHistoryMaxBars
            );
            if (historyCandlesCount < strategySettings.requiredHistoryMaxBars)
                this.log.warn(
                    `Backtester #${id} - Not enough history candles! Required: ${strategySettings.requiredHistoryMaxBars} bars but loaded: ${historyCandlesCount} bars`
                );
            if (strategySettings.requiredHistoryMaxBars > 0 && historyCandlesCount === 0)
                throw new Error(
                    `Not enough history candles! Required: ${strategySettings.requiredHistoryMaxBars} bars but loaded: ${historyCandlesCount} bars`
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

            await this.addJob("backtest", "backtest", backtester.state, {
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

    async stop({ id }: BacktesterRunnerStop) {
        try {
            const job = await this.queues["backtest"].instance.getJob(id);
            if (job) {
                if (job.isActive) {
                    await this.events.emit<BacktesterWorkerCancel>({
                        type: BacktesterWorkerEvents.CANCEL,
                        data: {
                            id
                        }
                    });
                } else {
                    await job.remove();
                }
            }
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }
}
