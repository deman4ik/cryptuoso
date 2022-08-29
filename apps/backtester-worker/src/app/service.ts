import { spawn, Thread, Worker as ThreadsWorker } from "threads";
import { Job } from "bullmq";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { BaseError } from "@cryptuoso/errors";
import { BacktesterState, Backtester, Status } from "@cryptuoso/backtester-state";

import {
    BacktesterWorkerCancel,
    BacktesterWorkerEvents,
    BacktesterWorkerFailed,
    BacktesterWorkerFinished,
    BacktesterWorkerSchema,
    BacktesterRunnerEvents,
    BacktesterRunnerSchema,
    BacktesterRunnerStart,
    BacktesterRunnerStop
} from "@cryptuoso/backtester-events";
import { sql } from "@cryptuoso/postgres";
import { BacktestWorker } from "./worker";
import combinate from "combinate";
import { GenericObject } from "@cryptuoso/helpers";
import { getRobotStatusEventName, RobotRunnerStatus } from "@cryptuoso/robot-events";
import { CandleType, ValidTimeframe } from "@cryptuoso/market";
import { v4 as uuid } from "uuid";
import { RobotSettings, StrategySettings } from "@cryptuoso/robot-settings";
import { RobotStatus } from "@cryptuoso/robot-types";

export type BacktesterWorkerServiceConfig = HTTPServiceConfig;

export default class BacktesterWorkerService extends HTTPService {
    abort: { [key: string]: boolean } = {};

    constructor(config?: BacktesterWorkerServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                backtesterStart: {
                    inputSchema: BacktesterRunnerSchema[BacktesterRunnerEvents.START],
                    roles: ["manager", "admin"],
                    handler: this.HTTPHandler.bind(this, this.start.bind(this))
                },
                backtesterStop: {
                    inputSchema: BacktesterRunnerSchema[BacktesterRunnerEvents.STOP],
                    roles: ["manger", "admin"],
                    handler: this.HTTPHandler.bind(this, this.stop.bind(this))
                }
            });
            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error("Error in BacktesterWorkerService constructor", err);
        }
    }

    async onServiceStart(): Promise<void> {
        this.events.subscribe({
            [BacktesterRunnerEvents.START]: {
                handler: this.start.bind(this),
                schema: BacktesterRunnerSchema[BacktesterRunnerEvents.START]
            },
            [BacktesterRunnerEvents.STOP]: {
                handler: this.stop.bind(this),
                schema: BacktesterRunnerSchema[BacktesterRunnerEvents.STOP]
            },
            [BacktesterWorkerEvents.CANCEL]: {
                handler: this.cancel.bind(this),
                schema: BacktesterWorkerSchema[BacktesterWorkerEvents.CANCEL],
                unbalanced: true
            }
        });
        this.createQueue("backtest", null, {
            maxStalledCount: 1,
            stalledInterval: 120000
        });
        this.createWorker("backtest", this.process);
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
            FROM candles
            WHERE exchange = ${exchange}
              AND asset = ${asset}
              AND currency = ${currency}
              AND timeframe = ${timeframe}
              AND type != ${CandleType.previous}
              AND timestamp < ${dayjs.utc(loadFrom).toISOString()}
            ORDER BY timestamp DESC
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

            if (["active", "delayed", "waiting"].includes(jobStatus)) {
                this.log.error(`Backtest #${id} is still ${jobStatus}`);
                return { result: false };
            }

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
                    throw new BaseError(`Wrong Robot status "${robot.status}" must be "${RobotStatus.starting}"`, {
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

            /* const allStrategySettings: { [key: string]: StrategySettings } = {};
            if (!Array.isArray(params.strategySettings)) {
                allStrategySettings[params.robotId || id] = strategySettings;
            } else if (params.strategySettings && Array.isArray(params.strategySettings)) {
                params.strategySettings.forEach((settings: StrategySettings) => {
                    allStrategySettings[uuid()] = settings;
                });
            }*/

            if (params.strategySettings) {
                strategySettings = { ...strategySettings, ...params.strategySettings };
            }

            if (params.robotSettings) {
                robotSettings = { ...robotSettings, ...params.robotSettings };
            }

            const robots: BacktesterState["robots"] = {};
            let allOptions: { [key: string]: number }[];

            if (params.settingsRange && Array.isArray(params.settingsRange) && params.settingsRange.length) {
                const options: { [key: string]: number[] } = {};

                for (const setting of params.settingsRange) {
                    options[`${setting.context}#${setting.prop}`] = [];

                    let current = setting.from;
                    while (current <= setting.to) {
                        options[`${setting.context}#${setting.prop}`].push(current);
                        current += setting.step;
                    }
                }

                allOptions = combinate(options);
                for (const option of allOptions) {
                    const newStrategySettings: GenericObject<number> = {};
                    const newRobotSettings: GenericObject<number> = {};
                    for (const [key, value] of Object.entries(option)) {
                        const [context, prop] = key.split("#");
                        if (context === "strategy") {
                            newStrategySettings[prop] = value;
                        } else if (context === "robot") {
                            newRobotSettings[prop] = value;
                        }
                    }
                    robots[uuid()] = {
                        strategySettings: {
                            ...strategySettings,
                            ...newStrategySettings
                        },
                        robotSettings: {
                            ...robotSettings,
                            ...newRobotSettings
                        }
                    };
                }
            }

            if (!Object.keys(robots).length) {
                robots[params.robotId || uuid()] = {
                    strategySettings,
                    robotSettings
                };
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
                robots,
                status: Status.queued
            });

            await this.addJob("backtest", "backtest", backtester.state, {
                jobId: backtester.id,
                removeOnComplete: true,
                removeOnFail: 100,
                attempts: 1
            });
            this.log.info(`Backtester ${backtester.id} scheduled`);
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

    cancel({ id }: BacktesterWorkerCancel): void {
        this.abort[id] = true;
    }

    #saveState = async (state: BacktesterState) => {
        try {
            this.log.info(`Backtester #${state.id} - Saving state`);

            await this.db.pg.query(sql`
        INSERT INTO backtests
            (id, robot_id, exchange, asset, currency, 
            timeframe, strategy,
            date_from, date_to, settings, 
            total_bars, processed_bars, left_bars, completed_percent, 
            status, started_at, finished_at, error, robot_state ) 
        VALUES (
            ${state.id}, ${state.robotId}, ${state.exchange}, ${state.asset}, ${state.currency}, 
            ${state.timeframe}, ${state.strategy},
            ${state.dateFrom}, ${state.dateTo}, ${JSON.stringify(state.settings)}, 
            ${state.totalBars}, ${state.processedBars}, ${state.leftBars},${state.completedPercent}, 
            ${state.status}, ${state.startedAt}, ${state.finishedAt}, ${state.error}, ${JSON.stringify(
                state.robotState || {}
            )}
        )
        ON CONFLICT ON CONSTRAINT backtests_pkey
        DO UPDATE SET robot_id = ${state.robotId},
            asset = ${state.asset},
            currency = ${state.currency},
            timeframe = ${state.timeframe},
            strategy = ${state.strategy},
            date_from = ${state.dateFrom},
            date_to = ${state.dateTo},
            settings = ${JSON.stringify(state.settings)},
            total_bars = ${state.totalBars},
            processed_bars = ${state.processedBars},
            left_bars = ${state.leftBars},
            completed_percent = ${state.completedPercent},
            status = ${state.status},
            started_at = ${state.startedAt},
            finished_at = ${state.finishedAt},
            error = ${state.error},
            robot_state = ${JSON.stringify(state.robotState || {})};
        `);
        } catch (err) {
            this.log.error("Failed to save backtester state", err);
            throw err;
        }
    };

    async process(job: Job<BacktesterState, Status>): Promise<Status> {
        try {
            this.log.info(`Processing job ${job.id}`);
            const beacon = this.lightship.createBeacon();
            const backtesterWorker = await spawn<BacktestWorker>(new ThreadsWorker("./worker"));
            this.log.info(`Worker spawned ${job.id}`);
            try {
                let backtester = new Backtester(job.data);
                backtester.start();
                backtesterWorker.progress().subscribe(async (percent: number) => {
                    await job.updateProgress(percent);

                    if (this.abort[backtester.id]) {
                        backtester.finish(true);
                        await this.#saveState(backtester.state);
                        delete this.abort[backtester.id];
                        throw new Error(`Backtester #${backtester.id} is canceled`);
                    }
                });

                const initState = await backtesterWorker.init(backtester.state);
                backtester = new Backtester(initState);
                const finalState = await backtesterWorker.process();
                backtester = new Backtester(finalState);
                this.log.info(`Backtester #${backtester.id} is ${backtester.status}!`);
                // job.update(backtester.state);
                if (backtester.isFailed) {
                    await this.events.emit<BacktesterWorkerFailed>({
                        type: BacktesterWorkerEvents.FAILED,
                        data: {
                            id: backtester.id,
                            robotId: backtester.robotId,
                            error: backtester.error
                        }
                    });
                    throw new BaseError(backtester.error, { backtesterId: backtester.id });
                }
                if (backtester.isFinished) {
                    await this.events.emit<BacktesterWorkerFinished>({
                        type: BacktesterWorkerEvents.FINISHED,
                        data: {
                            id: backtester.id,
                            robotId: backtester.robotId,
                            status: backtester.status
                        }
                    });
                    if (backtester.settings.populateHistory) {
                        await this.events.emit<RobotRunnerStatus>({
                            type: getRobotStatusEventName(backtester.exchange),
                            data: {
                                robotId: backtester.robotId,
                                status: "restart"
                            }
                        });
                    }
                    this.log.info(
                        `Backtester #${backtester.id} finished in ${dayjs
                            .utc(backtester.finishedAt)
                            .diff(backtester.startedAt, "milliseconds")} ms`
                    );
                }

                return backtester.status;
            } finally {
                await Thread.terminate(backtesterWorker);
                await beacon.die();
            }
        } catch (err) {
            this.log.error(`Error while processing job #${job.id}`, err);
            throw err;
        }
    }
}
