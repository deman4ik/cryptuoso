import { Job } from "bullmq";
import requireFromString from "require-from-string";
import { spawn, Pool, Worker as ThreadsWorker } from "threads";
import {
    Queues,
    Robot,
    RobotJob,
    RobotJobType,
    RobotPositionState,
    RobotState,
    RobotStatus
} from "@cryptuoso/robot-state";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { DatabaseTransactionConnectionType, sql } from "slonik";
import { Candle, DBCandle, Timeframe, ValidTimeframe } from "@cryptuoso/market";
import { sortAsc } from "@cryptuoso/helpers";
import { StatsCalcRunnerEvents } from "@cryptuoso/stats-calc-events";
import { RobotWorkerError, RobotWorkerEvents, Signal } from "@cryptuoso/robot-events";
import dayjs from "dayjs";
import { BaseError } from "@cryptuoso/errors";
import { Utils } from "./utils";
import { BaseServiceError, BaseServiceEvents } from "@cryptuoso/events";

export type RobotWorkerServiceConfig = BaseServiceConfig;

interface CodeFilesInDB {
    id: string;
    name: string;
    author?: string;
    available: number;
    file: string;
}

export default class RobotWorkerService extends BaseService {
    private pool: Pool<any>;
    strategiesCode: { [key: string]: any } = {};
    baseIndicatorsCode: { [key: string]: any } = {};
    #jobRetries = 3;
    constructor(config?: RobotWorkerServiceConfig) {
        super(config);
        try {
            this.addOnStartHandler(this.onServiceStart);
            this.addOnStopHandler(this.onServiceStop);
            //TODO: Reload code event
        } catch (err) {
            this.log.error("Error while constructing RobotWorkerService", err);
        }
    }

    async onServiceStart(): Promise<void> {
        this.pool = Pool(() => spawn<Utils>(new ThreadsWorker("./utils")), {
            name: "utils",
            concurrency: 5
        });
        await this.loadCode();
        this.createQueue(Queues.robot);
        this.createWorker(Queues.robot, this.process);
    }

    async onServiceStop(): Promise<void> {
        await this.pool.terminate();
    }

    async loadCode() {
        const strategies = await this.db.pg.many<CodeFilesInDB>(sql`
         SELECT * FROM strategies WHERE available >= 5;`);

        const baseIndicators = await this.db.pg.many<CodeFilesInDB>(sql`
         SELECT * FROM indicators WHERE available >= 5;`);

        if (process.env.CODE_FILES_LOCATION === "local") {
            this.log.warn("Loading local strategy and indicators files");

            strategies.forEach(async ({ id }) => {
                this.strategiesCode[id] = await import(`../../../../strategies/${id}`);
            });

            baseIndicators.forEach(async ({ id }) => {
                this.baseIndicatorsCode[id] = await import(`../../../../indicators/${id}`);
            });
        } else {
            this.log.info("Loading remote strategy and indicator files");

            strategies.forEach(({ id, file }) => {
                this.strategiesCode[id] = requireFromString(file);
            });

            baseIndicators.forEach(async ({ id, file }) => {
                this.baseIndicatorsCode[id] = requireFromString(file);
            });
        }

        this.log.info(
            `Loaded ${Object.keys(this.strategiesCode).length} strategies and ${
                Object.keys(this.baseIndicatorsCode).length
            } indicators`
        );
    }

    #getNextJob = (robotId: string): Promise<RobotJob> =>
        this.db.pg.maybeOne<RobotJob>(sql`
     SELECT id, robot_id, type, data, retries
      FROM robot_jobs
     WHERE robot_id = ${robotId}
       AND (retries is null OR retries <= ${this.#jobRetries})
     ORDER BY created_at 
      LIMIT 1;  
     `);

    async queueRobotJob(robotId: string) {
        await this.addJob(
            Queues.robot,
            "job",
            { robotId },
            {
                jobId: robotId,
                removeOnComplete: true,
                removeOnFail: 100
            }
        );
    }

    async addRobotJob({ robotId, type, data }: RobotJob, status: RobotStatus) {
        await this.db.pg.query(sql`
        INSERT INTO robot_jobs
        (
            robot_id,
            type,
            data
        ) VALUES (
            ${robotId},
            ${type},
            ${JSON.stringify(data) || null}
        )
        ON CONFLICT ON CONSTRAINT robot_jobs_robot_id_type_key 
         DO UPDATE SET updated_at = now(),
         type = excluded.type,
         data = excluded.data,
         retries = null,
         error = null;
        `);
        if (status === RobotStatus.started) await this.queueRobotJob(robotId);
    }

    async process(job: Job) {
        this.log.debug(`Processing job ${job.name} #${job.id}`);
        switch (job.name) {
            case "job":
                await this.robotJob(job);
                break;
            case "checkAlerts":
                await this.checkAlerts(job);
                break;
            default:
                this.log.error(`Unknow job ${job.name}`);
                this.log.error(job);
                break;
        }
        this.log.debug(`Finished processing job ${job.name} #${job.id}`);
        return { result: "ok" };
    }

    async checkAlertsUtils(exchange: string, asset: string, currency: string, timeframe: ValidTimeframe) {
        return await this.pool.queue(async (utils: Utils) => utils.checkAlerts(exchange, asset, currency, timeframe));
    }

    async checkAlerts(job: Job) {
        const beacon = this.lightship.createBeacon();
        try {
            const { exchange, asset, currency, timeframe } = job.data;

            const { result, error } = await this.checkAlertsUtils(exchange, asset, currency, timeframe);
            if (error) {
                await this.events.emit<BaseServiceError>({
                    type: BaseServiceEvents.ERROR,
                    data: {
                        service: this.name,
                        exchange,
                        asset,
                        currency,
                        timeframe,
                        error
                    }
                });
            } else if (result && Array.isArray(result) && result.length) {
                await Promise.all(
                    result.map(async ({ robotId, status }) =>
                        this.addRobotJob({ robotId, type: RobotJobType.tick }, status)
                    )
                );
            }
        } catch (err) {
            this.log.error(`Error while processing job ${job.id}`, err);
            throw err;
        } finally {
            await beacon.die();
        }
    }

    async robotJob(job: Job) {
        const beacon = this.lightship.createBeacon();
        try {
            const robotId = job.id;
            let nextJob: RobotJob = await this.#getNextJob(robotId);

            if (nextJob) {
                while (nextJob) {
                    const status: RobotStatus = await this.run(nextJob);

                    if (status && status !== RobotStatus.stopped && status !== RobotStatus.paused) {
                        nextJob = await this.#getNextJob(robotId);
                    } else {
                        nextJob = null;
                    }
                }
            }
        } catch (err) {
            this.log.error(`Error while processing job ${job.id}`, err);
            throw err;
        } finally {
            await beacon.die();
        }
    }

    #loadHistoryCandles = async (
        exchange: string,
        asset: string,
        currency: string,
        timeframe: ValidTimeframe,
        limit: number
    ): Promise<Candle[]> => {
        try {
            const requiredCandles = <DBCandle[]>await this.db.pg.many<DBCandle>(sql`
            SELECT *
            FROM candles
            WHERE exchange = ${exchange}
              AND asset = ${asset}
              AND currency = ${currency}
              AND timeframe = ${timeframe}
              AND timestamp <= ${dayjs.utc(Timeframe.getPrevSince(dayjs.utc().toISOString(), timeframe)).toISOString()}
            ORDER BY timestamp DESC
            LIMIT ${limit};`);
            return requiredCandles
                .sort((a, b) => sortAsc(a.time, b.time))
                .map((candle: DBCandle) => ({ ...candle, timeframe, id: candle.id }));
        } catch (err) {
            this.log.error("Failed to load history candles", err);
            throw err;
        }
    };

    #saveRobotPositions = async (transaction: DatabaseTransactionConnectionType, positions: RobotPositionState[]) => {
        for (const position of positions) {
            await transaction.query(sql`
        INSERT INTO robot_positions
        ( id, robot_id, prefix, code, parent_id,
         direction, status, 
         entry_status, entry_price, entry_date,
         entry_order_type, entry_action, 
         entry_candle_timestamp,
         exit_status, exit_price, exit_date, 
         exit_order_type, exit_action, 
         exit_candle_timestamp,
         alerts,
         bars_held,
         internal_state, max_price
        ) VALUES (
            ${position.id},
            ${position.robotId}, ${position.prefix}, ${position.code}, ${position.parentId || null},
            ${position.direction || null}, ${position.status}, 
            ${position.entryStatus || null},${position.entryPrice || null}, ${position.entryDate || null}, 
            ${position.entryOrderType || null}, ${position.entryAction || null}, 
            ${position.entryCandleTimestamp || null},
            ${position.exitStatus || null},${position.exitPrice || null}, ${position.exitDate || null}, 
            ${position.exitOrderType || null},${position.exitAction || null}, 
            ${position.exitCandleTimestamp || null},
            ${JSON.stringify(position.alerts)},
            ${position.barsHeld || null},
            ${JSON.stringify(position.internalState)}, ${position.maxPrice || null}
        ) ON CONFLICT ON CONSTRAINT robot_positions_robot_id_code_key 
         DO UPDATE SET updated_at = now(),
         direction = excluded.direction,
         status = excluded.status,
         entry_status = excluded.entry_status,
         entry_price = excluded.entry_price,
         entry_date = excluded.entry_date,
         entry_order_type = excluded.entry_order_type,
         entry_action = excluded.entry_action,
         entry_candle_timestamp = excluded.entry_candle_timestamp,
         exit_status = excluded.exit_status,
         exit_price = excluded.exit_price,
         exit_date = excluded.exit_date,
         exit_order_type = excluded.exit_order_type,
         exit_action = excluded.exit_action,
         exit_candle_timestamp = excluded.exit_candle_timestamp,
         alerts = excluded.alerts,
         bars_held = excluded.bars_held,
         internal_state = excluded.internal_state,
         max_price = excluded.max_price;`);
        }
    };

    #saveRobotSignals = async (transaction: DatabaseTransactionConnectionType, signals: Signal[]) => {
        for (const signal of signals) {
            const {
                id,
                robotId,
                action,
                orderType,
                price,
                type,
                positionId,
                positionPrefix,
                positionCode,
                positionParentId,
                candleTimestamp,
                timestamp,
                emulated
            } = signal;
            await this.db.pg.query(sql`
                INSERT INTO robot_signals
                (id, robot_id, action, order_type, price, type, position_id,
                position_prefix, position_code, position_parent_id,
                candle_timestamp,timestamp, emulated)
                VALUES (${id}, ${robotId}, ${action}, ${orderType}, ${price || null}, ${type},
                ${positionId}, ${positionPrefix}, ${positionCode}, ${positionParentId || null}, ${candleTimestamp},
                ${timestamp}, ${emulated || false})
            `);
        }
    };
    #saveRobotState = async (transaction: DatabaseTransactionConnectionType, state: RobotState) =>
        transaction.query(sql`
            UPDATE robots 
            SET state = ${JSON.stringify(state.state)}, 
            last_candle = ${JSON.stringify(state.lastCandle)}, 
            has_alerts = ${state.hasAlerts},
            full_stats = ${JSON.stringify(state.fullStats) || null},
            period_stats = ${JSON.stringify(state.periodStats) || null},
            emulated_full_stats = ${JSON.stringify(state.emulatedFullStats) || null},
            emulated_period_stats = ${JSON.stringify(state.emulatedPeriodStats) || null}
            WHERE id = ${state.id};
            `);

    async run(job: RobotJob): Promise<RobotStatus> {
        const { id, robotId, type } = job;
        this.log.info(`Robot #${robotId} - Processing ${type} job...`);
        try {
            const robotState = await this.db.pg.one<RobotState>(sql`
             SELECT r.id, 
                    r.exchange, 
                    r.asset, 
                    r.currency, 
                    r.timeframe, 
                    r.strategy, 
                    json_build_object('strategySettings', rs.strategy_settings,
                                      'robotSettings', rs.robot_settings,
                                      'activeFrom', rs.active_from) as settings,
                    r.last_candle, 
                    r.state, 
                    r.has_alerts, 
                    r.status,
                    r.started_at, 
                    r.stopped_at,
                    r.full_stats,
                    r.period_stats,
                    r.emulated_full_stats,
                    r.emulated_period_stats
            FROM robots r, v_robot_settings rs 
            WHERE rs.robot_id = r.id AND id = ${robotId};`);

            const robot = new Robot(robotState);

            if (type === RobotJobType.tick) {
                if (robot.hasAlerts) {
                    const currentTime = dayjs.utc(Timeframe.getCurrentSince(1, robot.timeframe)).toISOString();
                    const currentCandle: DBCandle = await this.db.pg.maybeOne(sql`
                SELECT * 
                FROM candles
                WHERE exchange = ${robot.exchange}
                AND asset = ${robot.asset}
                AND currency = ${robot.currency}
                AND timeframe = ${robot.timeframe}
                and timestamp = ${currentTime};`);
                    if (!currentCandle) {
                        this.log.error(
                            `Robot #${robotId} - Failed to load ${robot.exchange}-${robot.asset}-${robot.currency}-${robot.timeframe}-${currentTime} current candle`
                        );
                        return robot.status;
                    }
                    robot.setStrategy(null);
                    const { success, error } = robot.handleCurrentCandle({
                        ...currentCandle,
                        timeframe: robot.timeframe,
                        id: currentCandle.id
                    });

                    if (success) {
                        robot.checkAlerts();
                        robot.calcStats();
                    } else {
                        this.log.error(error);
                    }
                }
            } else if (type === RobotJobType.candle) {
                robot.setStrategy(this.strategiesCode[robot.strategy]);
                if (robot.hasBaseIndicators) {
                    robot.setBaseIndicatorsCode(
                        robot.baseIndicatorsFileNames.map((fileName) => ({
                            fileName,
                            code: this.baseIndicatorsCode[fileName]
                        }))
                    );
                }
                robot.setIndicators();

                const historyCandles: Candle[] = await this.#loadHistoryCandles(
                    robot.exchange,
                    robot.asset,
                    robot.currency,
                    robot.timeframe,
                    robot.strategySettings.requiredHistoryMaxBars
                );
                robot.handleHistoryCandles(historyCandles);
                const { success, error } = robot.handleCandle(historyCandles[historyCandles.length - 1]);
                if (success) {
                    await robot.calcIndicators();
                    robot.runStrategy();
                    // TODO:  robot.calcStats();
                    robot.finalize();
                } else {
                    this.log.error(error);
                }
            } else if (type === RobotJobType.stop) {
                robot.stop();
            } else throw new BaseError(`Unknown robot job type "${type}"`, job);

            await this.db.pg.transaction(async (t) => {
                if (robot.positionsToSave.length) await this.#saveRobotPositions(t, robot.positionsToSave);

                if (robot.signalsToSave.length)
                    await this.#saveRobotSignals(
                        t,
                        robot.signalsToSave.map(({ data }) => data)
                    );

                await this.#saveRobotState(t, robot.robotState);

                await t.query(sql`DELETE FROM robot_jobs WHERE id = ${job.id};`);
            });

            if (robot.hasClosedPositions) {
                // <StatsCalcRunnerRobot>
                await this.events.emit<any>({
                    type: StatsCalcRunnerEvents.ROBOT,
                    data: {
                        robotId
                    }
                });
            }

            for (const event of robot.eventsToSend) {
                await this.events.emit(event);
            }
            this.log.info(`Robot #${robotId} - Processed ${type} job (${id})`);
            return robot.status;
        } catch (err) {
            this.log.error(`Robot #${robotId} processing ${type} job #${id} error`, err);
            try {
                const retries = job.retries ? job.retries + 1 : 1;
                await this.db.pg.query(sql`
                    UPDATE robot_jobs
                    SET retries = ${retries}, 
                        error = ${err.message}
                    WHERE id = ${job.id};`);
            } catch (e) {
                this.log.error(`Failed to update robot's #${robotId} failed job status`, e);
            }

            if (job.retries >= this.#jobRetries) {
                await this.events.emit<RobotWorkerError>({
                    type: RobotWorkerEvents.ERROR,
                    data: {
                        robotId,
                        error: err.message,
                        job
                    }
                });
            }
        }
        return RobotStatus.started;
    }
}
