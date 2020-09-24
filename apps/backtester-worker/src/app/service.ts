import { DataStream } from "scramjet";
import { Worker, Job, QueueBase } from "bullmq";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { BaseError } from "@cryptuoso/errors";
import {
    BacktesterState,
    Backtester,
    Status,
    BacktesterSignals,
    BacktesterPositionState,
    BacktesterLogs,
    BacktesterStats
} from "@cryptuoso/backtester-state";
import requireFromString from "require-from-string";
import { StrategyCode } from "@cryptuoso/robot-state";
import { IndicatorCode } from "@cryptuoso/robot-indicators";
import { ValidTimeframe, Candle, DBCandle } from "@cryptuoso/market";
import { sortAsc, sleep, chunkArray } from "@cryptuoso/helpers";
import { makeChunksGenerator, pg, pgUtil, sql } from "@cryptuoso/postgres";

export type BacktesterWorkerServiceConfig = BaseServiceConfig;

export default class BacktesterWorkerService extends BaseService {
    abort: { [key: string]: boolean } = {};
    defaultChunkSize = 500;
    defaultImportChunkSize: 1000;
    constructor(config?: BacktesterWorkerServiceConfig) {
        super(config);
        try {
            /*  this.events.subscribe({
                [BacktesterWorkerEvents.PAUSE]: {
                    handler: this.pause.bind(this),
                    schema: BacktesterWorkerSchema[BacktesterWorkerEvents.PAUSE],
                    unbalanced: true
                }
            });*/
            // this.addOnStopHandler(this.onStopService);
        } catch (err) {
            this.log.error("Error in BacktesterWorkerService constructor", err);
        }
    }

    /* async onStopService(): Promise<void> {
        
    }*/

    /*pause({ id }: BacktesterWorkerPause): void {
        this.abort[id] = true;
    }*/

    #loadStrategyCode = async (strategyName: string, local: boolean) => {
        let strategyCode: StrategyCode;
        if (local) {
            this.log.debug(`Loading local strategy ${strategyName}`);
            strategyCode = require(`../../../../strategies/${strategyName}`);
        } else {
            this.log.debug(`Loading remote strategy ${strategyName}`);
            const { file }: { file: string } = await this.db.pg.one(
                sql`select file from strategies where id = ${strategyName}`
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
                    code = require(`../../../../indicators/${fileName}`);
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
        const requiredCandles: DBCandle[] = await this.db.pg.many(
            sql`select *
            from ${sql.identifier([`candles${timeframe}`])}
            where
            exchange = ${exchange}
            and asset = ${asset}
            and currency = ${currency}
            and time < ${dayjs.utc(loadFrom).valueOf()}
                 order by time desc
                 limit ${limit} `
        );
        return requiredCandles
            .sort((a, b) => sortAsc(a.time, b.time))
            .map((candle: DBCandle) => ({ ...candle, timeframe, id: candle.id }));
    };

    #process = async (job: Job<BacktesterState, BacktesterState>): Promise<BacktesterState> => {
        try {
            const backtester = new Backtester(job.data);
            backtester.start();
            this.log.info(`Backtester #${backtester.id} - Starting`);
            try {
                // Load strategy and indicators code, init strategy and indicators
                const strategyCode = await this.#loadStrategyCode(backtester.strategyName, backtester.settings.local);
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
                // Run backtest and save results
                await this.run(job, backtester);
            } catch (err) {
                backtester.fail(err.message);
                this.log.warn(`Backtester #${backtester.id}`, err.message);
            }
            backtester.finish(this.abort[backtester.id]);
            if (this.abort[backtester.id]) delete this.abort[backtester.id];
            this.log.info(`Backtester #${backtester.id} is ${backtester.status}!`);
            job.update(backtester.state);
            if (backtester.isFailed) {
                /*await this.events.emit<BacktesterWorkerFailed>({
                    type: BacktesterWorkerEvents.FAILED,
                    data: {
                        id: backtester.id,
                        error: backtester.error
                    }
                }); */
                throw new BaseError(backtester.error, { backtesterId: backtester.id });
            }
            if (backtester.isFinished)
                /* await this.events.emit<BacktesterWorkerFinished>({
                    type: BacktesterWorkerEvents.FINISHED,
                    data: {
                        id: backtester.id
                    }
                });*/
                return backtester.state;
        } catch (err) {
            this.log.error(`Error while processing job ${job.id}`, err.message);
            throw err;
        }
    };

    #saveSignals = async (signals: BacktesterSignals[]) => {
        const chunks = chunkArray(signals, this.defaultImportChunkSize);
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
                "timestamp without time zone",
                "varchar",
                "varchar",
                "varchar",
                "numeric",
                "uuid",
                "varchar",
                "varchar",
                "uuid",
                "timestamp without time zone"
            ]
        )}`);
        }
    };

    #savePositions = async (positions: BacktesterPositionState[]) => {
        const chunks = chunkArray(positions, this.defaultImportChunkSize);
        for (const chunk of chunks) {
            await this.db.pg.query(sql`
        INSERT INTO backtest_positions
        (backtest_id, robot_id, prefix, code, parent_id,
        direction, status, entry_status, entry_price, entry_date,
        entry_order_type, entry_action, entry_candle_timestamp,
        exit_status, exit_price, exit_date, exit_order_type,
        exit_action, exit_candle_timestamp, alerts,
        bars_held, internal_state)
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
                "timestamp without time zone",
                "varchar",
                "varchar",
                "timestamp without time zone",
                "varchar",
                "numeric",
                "timestamp without time zone",
                "varchar",
                "varchar",
                "timestamp without time zone",
                "jsonb",
                "numeric",
                "jsonb"
            ]
        )}
        `);
        }
    };

    #saveLogs = async (logs: BacktesterLogs[]) => {
        const chunks = chunkArray(
            logs.map((log) => ({
                backtestId: log.backtestId,
                robotId: log.robotId,
                candleTimestamp: log.candle.timestamp,
                data: JSON.stringify(log)
            })),
            this.defaultImportChunkSize
        );
        for (const chunk of chunks) {
            await this.db.pg.query(sql`
            INSERT INTO backtest_logs
            (backtest_id, robot_id, candle_timestamp, data)
            SELECT * FROM
            ${sql.unnest(this.db.util.prepareUnnest(chunk, ["backtestId", "robotId", "candleTimestamp", "data"]), [
                "uuid",
                "uuid",
                "timestamp without time zone",
                "jsonb"
            ])}
            `);
        }
    };

    #saveStats = async ({
        backtestId,
        robotId,
        statistics,
        equity,
        equityAvg,
        lastPositionExitDate,
        lastUpdatedAt
    }: BacktesterStats) => {
        await this.db.pg.query(sql`
        INSERT INTO backtest_stats 
        (backtest_id, robot_id, 
        statistics, equity, equity_avg, 
        last_position_exit_date, last_updated_at) VALUES (
            ${backtestId}, ${robotId}, ${sql.json(statistics)}, ${sql.json(equity)}, ${sql.json(equityAvg)},
            ${lastPositionExitDate},${lastUpdatedAt}
        )
        `);
    };

    async run(job: Job<BacktesterState, BacktesterState>, backtester: Backtester): Promise<void> {
        try {
            const query = sql`${sql.identifier([`candles${backtester.timeframe}`])} 
              WHERE exchange = ${backtester.exchange}
              AND asset = ${backtester.asset}
              AND currency = ${backtester.currency} 
              AND timestamp >= ${backtester.dateFrom}
              AND timestamp <= ${backtester.dateTo}
              AND type != 'previous'`;
            const candlesCount: number = +(await this.db.pg.oneFirst(sql`
               SELECT COUNT(*) FROM ${query}`));
            backtester.init(candlesCount);
            await DataStream.from(
                makeChunksGenerator(
                    this.db.pg,
                    sql`SELECT * FROM ${query} ORDER BY time`,
                    candlesCount > this.defaultChunkSize ? this.defaultChunkSize : candlesCount
                )
            )
                .flatMap((i) => i)
                .each(async (candle: DBCandle) => {
                    await backtester.handleCandle(candle);
                    backtester.incrementProgress();
                })
                .whenEnd();

            for (const [id, robot] of Object.entries(backtester.robots)) {
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
                this.log.info("positions", Object.keys(robot.data.positions).length);
                //this.log.info("stats", robot.data.stats);
            }
        } catch (err) {
            this.log.error(`Backtester #${backtester.id} - Failed`, err.message);
            throw err;
        }
    }

    async test(): Promise<void> {
        try {
            const job = new Job(
                new QueueBase("test"),
                "test",
                new Backtester({
                    id: "test",
                    robotId: "test",
                    exchange: "binance_futures",
                    asset: "BTC",
                    currency: "USDT",
                    strategyName: "breakout",
                    timeframe: 5,
                    settings: {
                        local: true,
                        populateHistory: false,
                        saveSignals: false,
                        savePositions: true,
                        saveLogs: false
                    },
                    strategySettings: {
                        ["test"]: {
                            adxHigh: 30,
                            lookback: 10,
                            adxPeriod: 25,
                            trailBars: 1
                        }
                    },
                    robotSettings: {
                        volume: 0.002,
                        requiredHistoryMaxBars: 300
                    },
                    dateFrom: "2020-09-15T00:00:00.000Z",
                    dateTo: "2020-09-15T20:15:00.000Z",
                    status: Status.queued
                }).state
            );
            await this.#process(job);
        } catch (err) {
            this.log.error(err);
        }
    }
}
