import { DataStream } from "scramjet";
import { Job } from "bullmq";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { BaseError } from "@cryptuoso/errors";
import {
    BacktesterState,
    Backtester,
    BacktesterSignals,
    BacktesterPositionState,
    BacktesterLogs,
    BacktesterStats
} from "@cryptuoso/backtester-state";
import requireFromString from "require-from-string";
import { RobotPositionState, RobotState, RobotStats, RobotStatus, StrategyCode } from "@cryptuoso/robot-state";
import { IndicatorCode } from "@cryptuoso/robot-indicators";
import { ValidTimeframe, Candle, DBCandle, SignalEvent, CandleType } from "@cryptuoso/market";
import { sortAsc, chunkArray } from "@cryptuoso/helpers";
import { makeChunksGenerator, sql } from "@cryptuoso/postgres";
import { RobotSettings, StrategySettings } from "@cryptuoso/robot-settings";
import {
    BacktesterWorkerCancel,
    BacktesterWorkerEvents,
    BacktesterWorkerFailed,
    BacktesterWorkerFinished,
    BacktesterWorkerSchema
} from "@cryptuoso/backtester-events";

export type BacktesterWorkerServiceConfig = BaseServiceConfig;

export default class BacktesterWorkerService extends BaseService {
    abort: { [key: string]: boolean } = {};
    defaultChunkSize = 500;
    defaultInsertChunkSize = 1000;
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

    #loadStrategyCode = async (strategy: string, local: boolean) => {
        let strategyCode: StrategyCode;
        if (local) {
            this.log.debug(`Loading local strategy ${strategy}`);
            strategyCode = await import(`../../../../strategies/${strategy}`);
        } else {
            this.log.debug(`Loading remote strategy ${strategy}`);
            const { file }: { file: string } = await this.db.pg.one(
                sql`select file from strategies where id = ${strategy}`
            );
            strategyCode = requireFromString(file);
        }
        return strategyCode;
    };

    #loadBaseIndicatorsCode = async (fileNames: string[], local: boolean) => {
        if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) return [];
        const indicatorsCode: { fileName: string; code: IndicatorCode }[] = await Promise.all(
            fileNames.map(async (fileName) => {
                let code: IndicatorCode;
                if (local) {
                    code = await import(`../../../../indicators/${fileName}`);
                } else {
                    const { file }: { file: string } = await this.db.pg.one(
                        sql`select file from indicators where id = ${fileName}`
                    );
                    code = requireFromString(file);
                }
                return { fileName, code };
            })
        );
        return indicatorsCode;
    };

    #loadHistoryCandles = async (
        exchange: string,
        asset: string,
        currency: string,
        timeframe: ValidTimeframe,
        loadFrom: string,
        limit: number
    ): Promise<Candle[]> => {
        try {
            const requiredCandles = <DBCandle[]>await this.db.pg.many<DBCandle>(
                sql`select *
                from ${sql.identifier([`candles${timeframe}`])}
                where
                exchange = ${exchange}
                and asset = ${asset}
                and currency = ${currency}
                and time < ${dayjs.utc(loadFrom).valueOf()}
                    order by time desc
                    limit ${limit};`
            );
            return requiredCandles
                .sort((a, b) => sortAsc(a.time, b.time))
                .map((candle: DBCandle) => ({ ...candle, timeframe, id: candle.id }));
        } catch (err) {
            this.log.error("Failed to load history candles", err);
            throw err;
        }
    };

    async process(job: Job<BacktesterState, BacktesterState>): Promise<BacktesterState> {
        try {
            const beacon = this.lightship.createBeacon();
            const backtester = new Backtester(job.data);
            backtester.start();
            this.log.info(`Backtester #${backtester.id} - Starting`);
            try {
                // Delete previous backtester state if exists
                const existedBacktest = await this.db.pg.maybeOne<{ id: string }>(sql`
                    SELECT id FROM backtests WHERE id = ${backtester.id}
                `);
                if (existedBacktest) {
                    this.log.info(`Backtester #${backtester.id} - Found previous backtest. Deleting...`);
                    await this.db.pg.query(sql`DELETE FROM backtests WHERE id = ${backtester.id}`);
                }
                // Load strategy and indicators code, init strategy and indicators
                const strategyCode = await this.#loadStrategyCode(backtester.strategy, backtester.settings.local);
                backtester.initRobots(strategyCode);
                const baseIndicatorsFileNames = backtester.robotInstancesArray[0].baseIndicatorsFileNames;
                const baseIndicatorsCode = await this.#loadBaseIndicatorsCode(
                    baseIndicatorsFileNames,
                    backtester.settings.local
                );
                backtester.initIndicators(baseIndicatorsCode);

                // Load required history candles
                const requiredHistoryMaxBars = backtester.robotInstancesArray[0].requiredHistoryMaxBars;
                const historyCandles: Candle[] = await this.#loadHistoryCandles(
                    backtester.exchange,
                    backtester.asset,
                    backtester.currency,
                    backtester.timeframe,
                    backtester.dateFrom,
                    requiredHistoryMaxBars
                );
                if (historyCandles.length < requiredHistoryMaxBars)
                    this.log.warn(
                        `Backtester #${backtester.id} - Not enough history candles! Required: ${requiredHistoryMaxBars} bars but loaded: ${historyCandles.length} bars`
                    );
                if (requiredHistoryMaxBars > 0 && historyCandles.length === 0)
                    throw new Error(
                        `Not enough history candles! Required: ${requiredHistoryMaxBars} bars but loaded: ${historyCandles.length} bars`
                    );
                this.log.info(`Backtester #${backtester.id} - History from ${historyCandles[0].timestamp}`);
                backtester.handleHistoryCandles(historyCandles);

                // Load average fee
                const { averageFee } = await this.db.pg.one<{ averageFee: number }>(sql`
                    SELECT average_fee FROM markets
                    WHERE exchange = ${backtester.exchange} 
                    and asset = ${backtester.asset} 
                    and currency = ${backtester.currency};`);
                backtester.averageFee = averageFee;

                await this.#saveState(backtester.state);

                await this.run(job, backtester);
            } catch (err) {
                backtester.fail(err.message);
                this.log.warn(`Backtester #${backtester.id}`, err);
            }
            backtester.finish(this.abort[backtester.id]);
            await this.#saveState(backtester.state);
            if (this.abort[backtester.id]) delete this.abort[backtester.id];

            this.log.info(`Backtester #${backtester.id} is ${backtester.status}!`);
            job.update(backtester.state);
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
            if (backtester.isFinished)
                await this.events.emit<BacktesterWorkerFinished>({
                    type: BacktesterWorkerEvents.FINISHED,
                    data: {
                        id: backtester.id,
                        robotId: backtester.robotId,
                        status: backtester.status
                    }
                });

            await beacon.die();
            return backtester.state;
        } catch (err) {
            this.log.error(`Error while processing job ${job.id}`, err);
            throw err;
        }
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

    #saveSignals = async (signals: BacktesterSignals[]) => {
        try {
            if (signals && Array.isArray(signals) && signals.length > 0) {
                this.log.info(
                    `Backtester #${signals[0].backtestId} - Saving robot's #${signals[0].robotId} ${signals.length} signals`
                );

                const chunks = chunkArray(signals, this.defaultInsertChunkSize);
                for (const chunk of chunks) {
                    await this.db.pg.query(sql`
        INSERT INTO backtest_signals
        (backtest_id, robot_id, timestamp, type, 
        action, order_type, price,
        position_id, position_prefix, position_code, position_parent_id,
        candle_timestamp)
        SELECT * FROM
        ${sql.unnest(
            this.db.util.prepareUnnest(chunk, [
                "backtestId",
                "robotId",
                "timestamp",
                "type",
                "action",
                "orderType",
                "price",
                "positionId",
                "positionPrefix",
                "positionCode",
                "positionParentId",
                "candleTimestamp"
            ]),
            [
                "uuid",
                "uuid",
                "timestamp",
                "varchar",
                "varchar",
                "varchar",
                "numeric",
                "uuid",
                "varchar",
                "varchar",
                "uuid",
                "timestamp"
            ]
        )}`);
                }
            }
        } catch (err) {
            this.log.error("Failed to save backtester signals", err);
            throw err;
        }
    };

    #savePositions = async (positions: BacktesterPositionState[]) => {
        try {
            if (positions && Array.isArray(positions) && positions.length > 0) {
                this.log.info(
                    `Backtester #${positions[0].backtestId} - Saving robot's #${positions[0].robotId} ${positions.length} positions`
                );
                const chunks = chunkArray(positions, this.defaultInsertChunkSize);
                for (const chunk of chunks) {
                    await this.db.pg.query(sql`
        INSERT INTO backtest_positions
        (backtest_id, robot_id, prefix, code, parent_id,
         direction, status, entry_status, entry_price, 
         entry_date,
         entry_order_type, entry_action, 
         entry_candle_timestamp,
         exit_status, exit_price,
         exit_date, 
         exit_order_type,
         exit_action, 
         exit_candle_timestamp,
         alerts,
         bars_held,
         internal_state
        )
        SELECT * FROM 
        ${sql.unnest(
            this.db.util.prepareUnnest(
                chunk.map((pos) => ({
                    ...pos,
                    alerts: JSON.stringify(pos.alerts),
                    internalState: JSON.stringify(pos.internalState)
                })),
                [
                    "backtestId",
                    "robotId",
                    "prefix",
                    "code",
                    "parentId",
                    "direction",
                    "status",
                    "entryStatus",
                    "entryPrice",
                    "entryDate",
                    "entryOrderType",
                    "entryAction",
                    "entryCandleTimestamp",
                    "exitStatus",
                    "exitPrice",
                    "exitDate",
                    "exitOrderType",
                    "exitAction",
                    "exitCandleTimestamp",
                    "alerts",
                    "barsHeld",
                    "internalState"
                ]
            ),
            [
                "uuid",
                "uuid",
                "varchar",
                "varchar",
                "uuid",
                "varchar",
                "varchar",
                "varchar",
                "numeric",
                "timestamp",
                "varchar",
                "varchar",
                "timestamp",
                "varchar",
                "numeric",
                "timestamp",
                "varchar",
                "varchar",
                "timestamp",
                "jsonb",
                "numeric",
                "jsonb"
            ]
        )}
        `);
                }
            }
        } catch (err) {
            this.log.error(`Failed to save backtster positions`, err);
            throw err;
        }
    };

    #saveLogs = async (logs: BacktesterLogs[]) => {
        try {
            const chunks = chunkArray(
                logs.map((log) => ({
                    backtestId: log.backtestId,
                    robotId: log.robotId,
                    candleTimestamp: log.candle.timestamp,
                    data: JSON.stringify(log)
                })),
                this.defaultInsertChunkSize
            );
            for (const chunk of chunks) {
                await this.db.pg.query(sql`
            INSERT INTO backtest_logs
            (backtest_id, robot_id, candle_timestamp, data)
            SELECT * FROM
            ${sql.unnest(this.db.util.prepareUnnest(chunk, ["backtestId", "robotId", "candleTimestamp", "data"]), [
                "uuid",
                "uuid",
                "timestamp",
                "jsonb"
            ])}
            `);
            }
        } catch (err) {
            this.log.error(`Failed to save backtster logs`, err);
            throw err;
        }
    };

    #saveStats = async (stats: BacktesterStats) => {
        try {
            if (stats) {
                const {
                    backtestId,
                    robotId,
                    statistics,
                    equity,
                    equityAvg,
                    lastPositionExitDate,
                    lastUpdatedAt
                } = stats;

                this.log.info(`Backtester #${backtestId} - Saving robot's #${robotId} stats`);
                await this.db.pg.query(sql`
        INSERT INTO backtest_stats 
        (backtest_id, robot_id, 
        statistics, equity, equity_avg, 
        last_position_exit_date, last_updated_at) VALUES (
            ${backtestId}, ${robotId}, ${JSON.stringify(statistics)}, ${JSON.stringify(equity)}, ${JSON.stringify(
                    equityAvg
                )},
            ${lastPositionExitDate},${lastUpdatedAt}
        )
        `);
            }
        } catch (err) {
            this.log.error(`Failed to save backtster stats`, err);
            throw err;
        }
    };

    #saveSettings = async (
        settings: {
            backtestId: string;
            robotId: string;
            strategySettings: StrategySettings;
            robotSettings: RobotSettings;
            activeFrom: string;
        }[]
    ) => {
        try {
            const chunks = chunkArray(
                settings.map((s) => ({
                    ...s,
                    strategySettings: JSON.stringify(s.strategySettings),
                    robotSettings: JSON.stringify(s.robotSettings)
                })),
                this.defaultInsertChunkSize
            );
            for (const chunk of chunks) {
                await this.db.pg.query(sql`
            INSERT INTO backtest_settings
            (backtest_id, robot_id, strategy_settings, robot_settings, active_from)
            SELECT * FROM
            ${sql.unnest(
                this.db.util.prepareUnnest(chunk, [
                    "backtestId",
                    "robotId",
                    "strategySettings",
                    "robotSettings",
                    "activeFrom"
                ]),
                ["uuid", "uuid", "jsonb", "jsonb", "timestamp"]
            )}
            `);
            }
        } catch (err) {
            this.log.error(`Failed to save backtster settings`, err);
            throw err;
        }
    };

    #checkRobotStatus = async (robotId: string) => {
        this.log.info(`Robot #${robotId} - Checking status...`);
        const { status }: { status: RobotStatus } = await this.db.pg.one(sql`
        SELECT status 
         FROM robots
        WHERE id = ${robotId}
        `);

        if (status !== RobotStatus.starting) throw new Error(`Failed to start Robot #${robotId}. Robot is ${status}`);
    };

    #saveRobotState = async (state: RobotState) => {
        try {
            this.log.info(`Robot #${state.id} - Saving state`);
            await this.db.pg.query(sql`
        UPDATE robots 
        SET state = ${JSON.stringify(state.state)}, 
        last_candle = ${JSON.stringify(state.lastCandle)}, 
        has_alerts = ${state.hasAlerts}
        WHERE id = ${state.id};
        `);
        } catch (err) {
            this.log.error(`Failed to save robot state`, err);
            throw err;
        }
    };

    #saveRobotSettings = async (
        robotId: string,
        settings: {
            strategySettings: StrategySettings;
            robotSettings: RobotSettings;
            activeFrom: string;
        }[]
    ) => {
        try {
            this.log.info(`Robot #${robotId} - Saving settings`);
            await this.db.pg.query(sql`DELETE FROM robot_settings WHERE robot_id = ${robotId}`);

            const chunks = chunkArray(
                settings.map((s) => ({
                    ...s,
                    robotId,
                    strategySettings: JSON.stringify(s.strategySettings),
                    robotSettings: JSON.stringify(s.robotSettings)
                })),
                this.defaultInsertChunkSize
            );

            for (const chunk of chunks) {
                await this.db.pg.query(sql`
            INSERT INTO robot_settings
            (robot_id, strategy_settings, robot_settings, active_from)
            SELECT * FROM
            ${sql.unnest(
                this.db.util.prepareUnnest(chunk, ["robotId", "strategySettings", "robotSettings", "activeFrom"]),
                ["uuid", "jsonb", "jsonb", "timestamp"]
            )}
            `);
            }
        } catch (err) {
            this.log.error(`Failed to save robot settings`, err);
            throw err;
        }
    };

    #saveRobotTrades = async (robotId: string, signals: SignalEvent[]) => {
        try {
            this.log.info(`Robot #${robotId} - Saving trades`);
            await this.db.pg.query(sql`DELETE FROM robot_signals where robot_id = ${robotId}`);
            if (signals && Array.isArray(signals) && signals.length > 0) {
                const chunks = chunkArray(signals, this.defaultInsertChunkSize);
                for (const chunk of chunks) {
                    await this.db.pg.query(sql`
        INSERT INTO robot_signals
        (robot_id, timestamp, type, 
        action, order_type, price,
        position_id, position_prefix, position_code, position_parent_id,
        candle_timestamp)
        SELECT * FROM
        ${sql.unnest(
            this.db.util.prepareUnnest(chunk, [
                "robotId",
                "timestamp",
                "type",
                "action",
                "orderType",
                "price",
                "positionId",
                "positionPrefix",
                "positionCode",
                "positionParentId",
                "candleTimestamp"
            ]),
            [
                "uuid",
                "timestamp",
                "varchar",
                "varchar",
                "varchar",
                "numeric",
                "uuid",
                "varchar",
                "varchar",
                "uuid",
                "timestamp"
            ]
        )}`);
                }
            }
        } catch (err) {
            this.log.error(`Failed to save robot trades`, err);
            throw err;
        }
    };

    #saveRobotPositions = async (robotId: string, positions: RobotPositionState[]) => {
        try {
            this.log.info(`Robot #${robotId} - Saving positions`);
            await this.db.pg.query(sql`DELETE FROM robot_positions where robot_id = ${robotId}`);
            if (positions && Array.isArray(positions) && positions.length > 0) {
                const chunks = chunkArray(positions, this.defaultInsertChunkSize);
                for (const chunk of chunks) {
                    try {
                        await this.db.pg.query(sql`
        INSERT INTO robot_positions
        ( robot_id, prefix, code, parent_id,
         direction, status, entry_status, entry_price, 
         entry_date,
         entry_order_type, entry_action, 
         entry_candle_timestamp,
         exit_status, exit_price,
         exit_date, 
         exit_order_type,
         exit_action, 
         exit_candle_timestamp,
         alerts,
         bars_held,
         internal_state
        )
        SELECT * FROM 
        ${sql.unnest(
            this.db.util.prepareUnnest(
                chunk.map((pos) => ({
                    ...pos,
                    alerts: JSON.stringify(pos.alerts),
                    internalState: JSON.stringify(pos.internalState)
                })),
                [
                    "robotId",
                    "prefix",
                    "code",
                    "parentId",
                    "direction",
                    "status",
                    "entryStatus",
                    "entryPrice",
                    "entryDate",
                    "entryOrderType",
                    "entryAction",
                    "entryCandleTimestamp",
                    "exitStatus",
                    "exitPrice",
                    "exitDate",
                    "exitOrderType",
                    "exitAction",
                    "exitCandleTimestamp",
                    "alerts",
                    "barsHeld",
                    "internalState"
                ]
            ),
            [
                "uuid",
                "varchar",
                "varchar",
                "uuid",
                "varchar",
                "varchar",
                "varchar",
                "numeric",
                "timestamp",
                "varchar",
                "varchar",
                "timestamp",
                "varchar",
                "numeric",
                "timestamp",
                "varchar",
                "varchar",
                "timestamp",
                "jsonb",
                "numeric",
                "jsonb"
            ]
        )}
        `);
                    } catch (err) {
                        this.log.error(err);
                    }
                }
            }
        } catch (err) {
            this.log.error(`Failed to save robot positions`, err);
            throw err;
        }
    };

    #saveRobotStats = async (robotId: string, stats: RobotStats) => {
        try {
            this.log.info(`Robot #${robotId} - Saving stats`);
            await this.db.pg.query(sql`DELETE FROM robot_stats where robot_id = ${robotId}`);
            if (stats) {
                const { robotId, statistics, equity, equityAvg, lastPositionExitDate, lastUpdatedAt } = stats;

                await this.db.pg.query(sql`
        INSERT INTO robot_stats 
        (robot_id, 
        statistics, equity, equity_avg, 
        last_position_exit_date, last_updated_at) VALUES (
            ${robotId}, ${JSON.stringify(statistics)}, ${JSON.stringify(equity)}, ${JSON.stringify(equityAvg)},
            ${lastPositionExitDate},${lastUpdatedAt}
        )
        `);
            }
        } catch (err) {
            this.log.error(`Failed to save robot stats`, err);
            throw err;
        }
    };

    #startRobot = async (robotId: string, startedAt: string) => {
        try {
            this.log.info(`Robot #${robotId} - Updating status '${RobotStatus.started}'`);
            await this.db.pg.query(sql` UPDATE robots 
            SET status = ${RobotStatus.started}, started_at = ${startedAt}, stopped_at = null
            WHERE id = ${robotId};`);
        } catch (err) {
            this.log.error(`Failed to update robot status`, err);
            throw err;
        }
    };

    async run(job: Job<BacktesterState, BacktesterState>, backtester: Backtester): Promise<void> {
        try {
            const query = sql`${sql.identifier([`candles${backtester.timeframe}`])} 
              WHERE exchange = ${backtester.exchange}
              AND asset = ${backtester.asset}
              AND currency = ${backtester.currency} 
              AND timestamp >= ${backtester.dateFrom}
              AND timestamp <= ${backtester.dateTo}
              AND type != ${CandleType.previous}`;
            const candlesCount: number = +(await this.db.pg.oneFirst(sql`
               SELECT COUNT(1) FROM ${query}`));
            backtester.init(candlesCount);
            await DataStream.from(
                makeChunksGenerator(
                    this.db.pg,
                    sql`SELECT * FROM ${query} ORDER BY time`,
                    candlesCount > this.defaultChunkSize ? this.defaultChunkSize : candlesCount
                ),
                { maxParallel: 1 }
            )
                .flatMap((i) => i)
                .while(() => backtester.isStarted && !this.abort[backtester.id])
                .each(async (candle: Candle) => {
                    await backtester.handleCandle(candle);
                    backtester.incrementProgress();
                })
                .catch((err: Error) => {
                    this.log.error(`Backtester #${backtester.id} - Error`, err.message);
                    throw new BaseError(err.message, err);
                })
                .whenEnd();

            if (!this.abort[backtester.id]) {
                if (backtester.settings.populateHistory) {
                    const robot = backtester.robots[backtester.robotId];

                    await this.#checkRobotStatus(backtester.robotId);
                    await this.#saveRobotState(robot.instance.robotState);
                    await this.#saveRobotSettings(backtester.robotId, Object.values(robot.data.settings));
                    await this.#saveRobotTrades(
                        backtester.robotId,
                        robot.data.trades.sort((a, b) => sortAsc(a.candleTimestamp, b.candleTimestamp))
                    );
                    await this.#saveRobotPositions(backtester.robotId, Object.values(robot.data.positions));
                    await this.#saveRobotStats(backtester.robotId, robot.data.stats);
                    await this.#startRobot(backtester.robotId, backtester.dateFrom);
                } else {
                    for (const robot of Object.values(backtester.robots)) {
                        if (backtester.settings.saveSignals) {
                            await this.#saveSignals(
                                [...robot.data.alerts, ...robot.data.trades].sort((a, b) =>
                                    sortAsc(a.candleTimestamp, b.candleTimestamp)
                                )
                            );
                        }

                        if (backtester.settings.savePositions) {
                            await this.#savePositions(Object.values(robot.data.positions));
                        }

                        if (backtester.settings.saveLogs) {
                            await this.#saveLogs(robot.data.logs);
                        }

                        await this.#saveStats(robot.data.stats);

                        await this.#saveSettings(
                            Object.values(robot.data.settings).map((s) => ({
                                ...s,
                                backtestId: backtester.id,
                                robotId: robot.instance.id
                            }))
                        );
                    }
                }
            }
        } catch (err) {
            this.log.error(`Backtester #${backtester.id} - Failed`, err);
            throw err;
        }
    }
}
