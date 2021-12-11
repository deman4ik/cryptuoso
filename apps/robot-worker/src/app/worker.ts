import { expose } from "threads/worker";
import requireFromString from "require-from-string";
import Redis from "ioredis";
import Cache from "ioredis-cache";
import logger, { Logger, Tracer } from "@cryptuoso/logger";
import { Robot, RobotJob, RobotJobType, RobotPositionState, RobotState, RobotStatus } from "@cryptuoso/robot-state";
import { DatabaseTransactionConnectionType } from "slonik";
import { Candle, DBCandle, Timeframe, ValidTimeframe } from "@cryptuoso/market";
import { round, sleep, sortAsc } from "@cryptuoso/helpers";
import { StatsCalcRunnerEvents } from "@cryptuoso/stats-calc-events";
import { ActiveAlert, RobotWorkerError, RobotWorkerEvents, Signal } from "@cryptuoso/robot-events";
import dayjs from "dayjs";
import { BaseError } from "@cryptuoso/errors";
import { Events } from "@cryptuoso/events";
import { sql, pg, pgUtil } from "@cryptuoso/postgres";
import {
    TradeStatsRunnerEvents,
    TradeStatsRunnerPortfolioRobot,
    TradeStatsRunnerRobot
} from "@cryptuoso/trade-stats-events";

interface CodeFilesInDB {
    id: string;
    name: string;
    author?: string;
    available: number;
    file: string;
}

class RobotJobWorker {
    #log: Logger;
    #db: { sql: typeof sql; pg: typeof pg; util: typeof pgUtil };
    #cache: Cache;
    #events: Events;
    #redisConnection: Redis.Redis;
    #jobRetries = 3;

    strategiesCode: { [key: string]: any } = {};
    baseIndicatorsCode: { [key: string]: any } = {};

    #ready = false;
    constructor() {
        this.#log = logger;
        this.#db = {
            sql,
            pg: pg,
            util: pgUtil
        };
        this.#redisConnection = new Redis(process.env.REDISCS, {
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            connectTimeout: 60000
        });
        this.#cache = new Cache(this.#redisConnection);
        this.#events = new Events(this.#redisConnection, null, null);
    }

    get log() {
        return this.#log;
    }

    get db() {
        return this.#db;
    }

    get events() {
        return this.#events;
    }

    get cache() {
        return this.#cache;
    }

    get jobRetries() {
        return this.#jobRetries;
    }

    async loadCode() {
        this.log.debug("Loading strategy and indicators code");
        try {
            /*const strategies = await this.cache.cache(
                `cache:strategies`,
                () =>
                    this.db.pg.many<CodeFilesInDB>(sql`
                SELECT * FROM strategies WHERE available >= 5;`),
                24 * 60 * 60
            );
           
            const baseIndicators = await this.cache.cache(
                `cache:strategies`,
                () =>
                    this.db.pg.many<CodeFilesInDB>(sql`
                SELECT * FROM indicators WHERE available >= 5;`),
                24 * 60 * 60
            ); */
            const strategies = await this.db.pg.many<CodeFilesInDB>(sql`
            SELECT * FROM strategies WHERE available >= 5;`);
            const baseIndicators = await this.db.pg.many<CodeFilesInDB>(sql`
             SELECT * FROM indicators WHERE available >= 5;`);
            this.log.debug(`Loaded ${strategies.length} strategies`);
            this.log.debug(`Loaded ${baseIndicators.length} base indicators`);
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
            this.#ready = true;
        } catch (err) {
            this.log.error(`Failed to load strategies and indicators ${err.message}`);
            this.log.error(err);
            throw err;
        }
    }

    get ready() {
        return this.#ready;
    }

    #loadHistoryCandles = async (
        exchange: string,
        asset: string,
        currency: string,
        timeframe: ValidTimeframe,
        limit: number
    ): Promise<Candle[]> => {
        try {
            const requiredCandles = await this.cache.cache(
                `cache:candles:${exchange}:${asset}:${currency}:${timeframe}:${limit}`,
                () =>
                    this.db.pg.many<DBCandle>(sql`
        SELECT *
        FROM candles
        WHERE exchange = ${exchange}
          AND asset = ${asset}
          AND currency = ${currency}
          AND timeframe = ${timeframe}
          AND timestamp <= ${dayjs.utc(Timeframe.getPrevSince(dayjs.utc().toISOString(), timeframe)).toISOString()}
        ORDER BY timestamp DESC
        LIMIT ${limit};`),
                round(60 * (timeframe / 2))
            );
            return [...requiredCandles]
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
            await transaction.query(sql`
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

    #saveRobotActiveAlerts = async (transaction: DatabaseTransactionConnectionType, signals: ActiveAlert[]) => {
        for (const signal of signals) {
            const {
                id,
                robotId,
                action,
                orderType,
                price,
                positionId,
                candleTimestamp,
                timeframe,
                exchange,
                asset,
                currency,
                activeFrom,
                activeTo
            } = signal;
            await transaction.query(sql`
            INSERT INTO robot_active_alerts
            (id, robot_id, action, order_type, price, position_id, 
            exchange, asset, currency,
            timeframe,
            candle_timestamp, active_from, active_to)
            VALUES (${id}, ${robotId}, ${action}, ${orderType}, ${price},
            ${positionId}, 
            ${exchange}, ${asset}, ${currency},
            ${timeframe}, ${candleTimestamp},
            ${activeFrom}, ${activeTo})
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
    /* TODO full_stats = ${JSON.stringify(state.fullStats) || null},
period_stats = ${JSON.stringify(state.periodStats) || null},
emulated_full_stats = ${JSON.stringify(state.emulatedFullStats) || null},
emulated_period_stats = ${JSON.stringify(state.emulatedPeriodStats) || null}*/

    #getRobotState = async (robotId: string): Promise<RobotState> => {
        try {
            return await this.cache.cache(
                `cache:robot:${robotId}`,
                () =>
                    this.db.pg.one<RobotState>(sql`
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
            WHERE rs.robot_id = r.id AND id = ${robotId};`),
                600
            );
        } catch (err) {
            this.log.error("Failed to load robot state", err);
            throw err;
        }
    };
    async run(job: RobotJob): Promise<RobotStatus> {
        const { id, robotId, type } = job;
        this.log.info(`Robot #${robotId} - Processing ${type} job...`);

        try {
            const tracer = new Tracer();
            const runJobTrace = tracer.start("Start job");
            const getRobotStateTrace = tracer.start("Get robot state");
            const robotState = await this.#getRobotState(robotId);
            tracer.end(getRobotStateTrace);

            const robot = new Robot(robotState);

            if (type === RobotJobType.tick) {
                if (robot.hasAlerts) {
                    const alert = job.data as ActiveAlert;

                    const currentTime = dayjs.utc(Timeframe.getCurrentSince(1, robot.timeframe)).toISOString();

                    if (!alert || (alert && dayjs.utc(alert.activeTo).valueOf() > dayjs.utc().valueOf())) {
                        //TODO: remove backward compatibility
                        const loadCurrentCandleTrace = tracer.start("Load current candle");
                        const currentCandle: DBCandle = await this.db.pg.maybeOne(sql`
                                    SELECT * 
                                    FROM candles
                                    WHERE exchange = ${robot.exchange}
                                    AND asset = ${robot.asset}
                                    AND currency = ${robot.currency}
                                    AND timeframe = ${robot.timeframe}
                                    and timestamp = ${currentTime};`);
                        tracer.end(loadCurrentCandleTrace);
                        if (!currentCandle) {
                            throw new Error(
                                `Robot #${robotId} - Failed to load ${robot.exchange}-${robot.asset}-${robot.currency}-${robot.timeframe}-${currentTime} current candle`
                            );
                        }
                        const robotMethodsTrace = tracer.start("Robot methods");
                        robot.setStrategy(null);
                        const { success, error } = robot.handleCurrentCandle({
                            ...currentCandle,
                            timeframe: robot.timeframe,
                            id: currentCandle.id
                        });

                        if (success) {
                            robot.checkAlerts();
                            //robot.calcStats();
                        } else {
                            this.log.error(error);
                        }
                        tracer.end(robotMethodsTrace);
                    }
                }
            } else if (type === RobotJobType.candle) {
                if (!this.strategiesCode[robot.strategy]) {
                    await this.loadCode();
                }
                const setStrIndTrace = tracer.start("Set strategies and inds");
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

                tracer.end(setStrIndTrace);

                const loadHistoryCandlesTrace = tracer.start("Load history candles");
                const historyCandles: Candle[] = await this.#loadHistoryCandles(
                    robot.exchange,
                    robot.asset,
                    robot.currency,
                    robot.timeframe,
                    robot.strategySettings.requiredHistoryMaxBars
                );
                tracer.end(loadHistoryCandlesTrace);
                const handleCandlesTrace = tracer.start("Handle candles");
                robot.handleHistoryCandles(historyCandles);
                const { success, error } = robot.handleCandle(historyCandles[historyCandles.length - 1]);
                tracer.end(handleCandlesTrace);
                if (success) {
                    const calcIndTrace = tracer.start("Calc indicators");
                    await robot.calcIndicators();
                    tracer.end(calcIndTrace);
                    const runStrTrace = tracer.start("Run Strategy");
                    robot.runStrategy();
                    tracer.end(runStrTrace);
                    // TODO: await robot.calcStats(); don't forget to save state
                    robot.finalize();
                } else {
                    this.log.error(error);
                }
            } else if (type === RobotJobType.stop) {
                robot.stop();
            } else throw new BaseError(`Unknown robot job type "${type}"`, job);

            const saveTrace = tracer.start("Save state");
            await this.db.pg.transaction(async (t) => {
                if (robot.positionsToSave.length) await this.#saveRobotPositions(t, robot.positionsToSave);

                if (robot.signalsToSave.length || type === RobotJobType.stop) {
                    await t.query(sql`DELETE FROM robot_active_alerts WHERE robot_id = ${robot.id}`);
                }
                if (robot.signalsToSave.length) {
                    await this.#saveRobotSignals(
                        t,
                        robot.signalsToSave.map(({ data }) => data)
                    );
                }

                if (robot.alertsToSave.length) {
                    await this.#saveRobotActiveAlerts(t, robot.alertsToSave);
                }

                await this.#saveRobotState(t, robot.robotState);

                await t.query(sql`DELETE FROM robot_jobs WHERE id = ${job.id};`);
            });
            tracer.end(saveTrace);

            const sendEventsTrace = tracer.start("Send events");
            if (robot.eventsToSend.length)
                await Promise.all(
                    robot.eventsToSend.map(async (event) => {
                        await this.events.emit(event);
                    })
                );

            if (robot.hasClosedPositions) {
                // <StatsCalcRunnerRobot>
                await this.events.emit<any>({
                    type: StatsCalcRunnerEvents.ROBOT,
                    data: {
                        robotId
                    }
                }); //TODO: deprecate

                await this.events.emit<TradeStatsRunnerRobot>({
                    type: TradeStatsRunnerEvents.ROBOT,
                    data: {
                        robotId
                    }
                });

                await this.events.emit<TradeStatsRunnerPortfolioRobot>({
                    type: TradeStatsRunnerEvents.PORTFOLIO_ROBOT,
                    data: {
                        robotId
                    }
                });
            }
            tracer.end(sendEventsTrace);

            await this.cache.setCache(`cache:robot:${robotId}`, robot.robotState, robot.timeframe * 60 + 600);
            this.log.info(`Robot #${robotId} - Processed ${type} job (${id})`);
            tracer.end(runJobTrace);

            await this.events.emit({
                type: RobotWorkerEvents.LOG,
                data: {
                    traces: tracer.state,
                    robotId,
                    jobType: type
                }
            });

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

            if (job.retries >= this.jobRetries) {
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

    #getNextJob = (robotId: string): Promise<RobotJob> =>
        this.db.pg.maybeOne<RobotJob>(sql`
 SELECT id, robot_id, type, data, retries
  FROM robot_jobs
 WHERE robot_id = ${robotId}
   AND (retries is null OR retries <= ${this.jobRetries})
 ORDER BY created_at 
  LIMIT 1;  
 `);

    async robotJob(robotId: string) {
        try {
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
            this.log.error(`Error while processing job ${robotId}`, err);
            throw err;
        }
    }
}

const robotWorker = new RobotJobWorker();
robotWorker.loadCode();

const worker = {
    async process(robotId: string) {
        while (!robotWorker.ready) {
            await sleep(5000);
        }
        await robotWorker.robotJob(robotId);
    }
};

export type RobotWorker = typeof worker;

expose(worker);
