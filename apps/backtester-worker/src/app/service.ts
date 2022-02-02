import { spawn, Thread, Worker as ThreadsWorker } from "threads";
import { Job } from "bullmq";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { BaseError } from "@cryptuoso/errors";
import { BacktesterState, Backtester, Status } from "@cryptuoso/backtester-state";

import {
    BacktesterWorkerCancel,
    BacktesterWorkerEvents,
    BacktesterWorkerFailed,
    BacktesterWorkerFinished,
    BacktesterWorkerSchema
} from "@cryptuoso/backtester-events";
import { sql } from "@cryptuoso/postgres";
import { BacktestWorker } from "./worker";
import { getRobotStatusEventName, RobotRunnerStatus } from "@cryptuoso/robot-events";

export type BacktesterWorkerServiceConfig = BaseServiceConfig;

export default class BacktesterWorkerService extends BaseService {
    abort: { [key: string]: boolean } = {};

    constructor(config?: BacktesterWorkerServiceConfig) {
        super(config);
        try {
            this.events.subscribe({
                [BacktesterWorkerEvents.CANCEL]: {
                    handler: this.cancel.bind(this),
                    schema: BacktesterWorkerSchema[BacktesterWorkerEvents.CANCEL],
                    unbalanced: true
                }
            });
            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error("Error in BacktesterWorkerService constructor", err);
        }
    }

    async onServiceStart(): Promise<void> {
        this.createWorker("backtest", this.process);
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
                    /*  if (backtester.settings.populateHistory) {
                        await this.events.emit<RobotRunnerStatus>({
                            type: getRobotStatusEventName(backtester.exchange),
                            data: {
                                robotId: backtester.robotId,
                                status: "starting"
                            }
                        });
                    }*/ //TODO: turn on
                    this.log.info(
                        `Backtester #${backtester.id} finished in ${dayjs
                            .utc(backtester.finishedAt)
                            .to(backtester.startedAt)}`
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
