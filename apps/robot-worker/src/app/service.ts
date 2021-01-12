import { Job } from "bullmq";
import requireFromString from "require-from-string";
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

export type RobotWorkerServiceConfig = BaseServiceConfig;

interface CodeFilesInDB {
    id: string;
    name: string;
    author?: string;
    available: number;
    file: string;
}

export default class RobotWorkerService extends BaseService {
    strategiesCode: { [key: string]: any } = {};
    baseIndicatorsCode: { [key: string]: any } = {};
    #jobRetries = 3;
    constructor(config?: RobotWorkerServiceConfig) {
        super(config);
        try {
            this.addOnStartHandler(this.onServiceStart);
            //TODO: Reload code event
        } catch (err) {
            this.log.error("Error while constructing RobotWorkerService", err);
        }
    }

    async onServiceStart(): Promise<void> {
        await this.loadCode();

        this.createWorker(Queues.robot, this.process);
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

    async process(job: Job) {
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
            await beacon.die();
        } catch (err) {
            this.log.error(`Error while processing job ${job.id}`, err);
            throw err;
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
            FROM ${sql.identifier([`candles${timeframe}`])}
            WHERE exchange = ${exchange}
              AND asset = ${asset}
              AND currency = ${currency}
              AND time <= ${Timeframe.getPrevSince(dayjs.utc().toISOString(), timeframe)}
            ORDER BY time DESC
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
         internal_state
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
            ${JSON.stringify(position.internalState)}
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
         internal_state = excluded.internal_state;`);
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
                timestamp
            } = signal;
            await this.db.pg.query(sql`
                INSERT INTO robot_signals
                (id, robot_id, action, order_type, price, type, position_id,
                position_prefix, position_code, position_parent_id,
                candle_timestamp,timestamp)
                VALUES (${id}, ${robotId}, ${action}, ${orderType}, ${price || null}, ${type},
                ${positionId}, ${positionPrefix}, ${positionCode}, ${positionParentId || null}, ${candleTimestamp},
                ${timestamp})
            `);
        }
    };
    #saveRobotState = async (transaction: DatabaseTransactionConnectionType, state: RobotState) =>
        transaction.query(sql`
            UPDATE robots 
            SET state = ${JSON.stringify(state.state)}, 
            last_candle = ${JSON.stringify(state.lastCandle)}, 
            has_alerts = ${state.hasAlerts}
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
                    r.stopped_at
            FROM robots r, v_robot_settings rs 
            WHERE rs.robot_id = r.id AND id = ${robotId};`);

            const robot = new Robot(robotState);

            if (type === RobotJobType.tick) {
                if (robot.hasAlerts) {
                    const currentCandle: DBCandle = await this.db.pg.one(sql`
                SELECT * 
                FROM ${sql.identifier([`candles${robot.timeframe}`])}
                WHERE exchange = ${robot.exchange}
                AND asset = ${robot.asset}
                AND currency = ${robot.currency}
                ORDER BY time DESC
                LIMIT 1;`);

                    robot.setStrategy(null);
                    const { success, error } = robot.handleCurrentCandle({
                        ...currentCandle,
                        timeframe: robot.timeframe,
                        id: currentCandle.id
                    });

                    if (success) {
                        robot.checkAlerts();
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
                await this.events.emit({
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
