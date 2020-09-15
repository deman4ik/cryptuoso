import { DataStream } from "scramjet";
import { Worker, Job, QueueBase } from "bullmq";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { BaseError } from "@cryptuoso/errors";
import { BacktesterState, Backtester, Status } from "@cryptuoso/backtester-state";
import requireFromString from "require-from-string";
import { StrategyCode } from "@cryptuoso/robot-state";
import { IndicatorCode } from "@cryptuoso/robot-indicators";
import { ValidTimeframe, Candle, DBCandle } from "@cryptuoso/market";
import { sortAsc, sleep } from "@cryptuoso/helpers";
import { makeChunksGenerator, pg, pgUtil, sql } from "@cryptuoso/postgres";
import logger from "@cryptuoso/logger";

export type BacktesterWorkerServiceConfig = BaseServiceConfig;

export default class BacktesterWorkerService extends BaseService {
    abort: { [key: string]: boolean } = {};
    defaultChunkSize = 2;
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
            strategyCode = await import(`../../../../strategies/${strategyName}`);
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
                this.log.warn(`Backtester #${backtester.id}`, err);
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
            await DataStream.from(
                makeChunksGenerator(
                    this.db.pg,
                    sql`SELECT * FROM ${query} ORDER BY time`,
                    candlesCount > this.defaultChunkSize ? this.defaultChunkSize : candlesCount
                )
            )
                .flatMap((i) => i)
                .map(async (data: DBCandle) => {
                    this.log.info(data);
                })
                .whenEnd();
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
                        savePositions: false,
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
                    dateTo: "2020-09-15T00:15:00.000Z",
                    status: Status.queued
                }).state
            );
            await this.#process(job);
        } catch (err) {
            this.log.error(err);
        }
    }
}
