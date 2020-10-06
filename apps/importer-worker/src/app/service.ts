import { DataStream } from "scramjet";
import os from "os";
import { spawn, Pool, Worker as ThreadsWorker } from "threads";
import { Worker, Job } from "bullmq";
import retry from "async-retry";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { PublicConnector } from "@cryptuoso/ccxt-public";
import { Importer, CandlesChunk, TradesChunk, ImporterState } from "@cryptuoso/importer-state";
import dayjs from "@cryptuoso/dayjs";
import { ExchangeCandle, ExchangeTrade, ExchangeCandlesInTimeframes } from "@cryptuoso/market";
import { BaseError } from "@cryptuoso/errors";
import {
    ImporterWorkerFailed,
    ImporterWorkerFinished,
    ImporterWorkerCancel,
    ImporterWorkerSchema,
    ImporterWorkerEvents
} from "@cryptuoso/importer-events";
import { ImporterUtils } from "./importerUtilsWorker";
import { sql } from "@cryptuoso/postgres";

export type ImporterWorkerServiceConfig = BaseServiceConfig;

export default class ImporterWorkerService extends BaseService {
    connector: PublicConnector;
    abort: { [key: string]: boolean } = {};
    cpus: number;
    pool: Pool<any>;
    workers: { [key: string]: Worker };
    constructor(config?: ImporterWorkerServiceConfig) {
        super(config);
        try {
            this.connector = new PublicConnector();
            this.cpus = os.cpus().length;
            this.addOnStartHandler(this.onStartService);
            this.addOnStopHandler(this.onStopService);
            this.events.subscribe({
                [ImporterWorkerEvents.CANCEL]: {
                    handler: this.cancel.bind(this),
                    schema: ImporterWorkerSchema[ImporterWorkerEvents.CANCEL],
                    unbalanced: true
                }
            });
        } catch (err) {
            this.log.error("Error in ImporterWorkerService constructor", err);
        }
    }

    async onStartService(): Promise<void> {
        this.pool = Pool(() => spawn<ImporterUtils>(new ThreadsWorker("./importerUtilsWorker")), {
            name: "importer-utils"
        });
        this.workers = {
            importCandles: new Worker("importCandles", async (job: Job) => this.process(job), {
                connection: this.redis
            })
        };
    }

    async onStopService(): Promise<void> {
        await this.workers.importCandles.close();
        await this.pool.terminate();
    }

    cancel({ id }: ImporterWorkerCancel): void {
        this.abort[id] = true;
    }

    async tradesToCandles({
        timeframes,
        chunk,
        trades
    }: {
        timeframes: number[];
        chunk: TradesChunk;
        trades: ExchangeTrade[];
    }): Promise<{ chunk: TradesChunk; candlesInTimeframes: ExchangeCandlesInTimeframes }> {
        return this.pool.queue(async (utils: ImporterUtils) => utils.tradesToCandles({ timeframes, chunk, trades }));
    }

    async process(job: Job<ImporterState, ImporterState>): Promise<ImporterState> {
        try {
            const importer = new Importer(job.data);
            await this.connector.initConnector(importer.exchange);
            importer.createChunks(this.connector.connectors[importer.exchange].timeframes);
            importer.start();
            this.log.info(
                `Importer #${importer.id} - Starting ${importer.type} load of ${importer.exchange} ${importer.asset}/${importer.currency} candles`
            );
            try {
                if (importer.type === "history" && importer.exchange === "kraken") {
                    await this.importTrades(job, importer);
                } else {
                    await this.importCandles(job, importer);
                }
            } catch (err) {
                importer.fail(err.message);
                this.log.warn(`Importer #${importer.id}`, err);
            }
            importer.finish(this.abort[importer.id]);
            if (this.abort[importer.id]) delete this.abort[importer.id];
            this.log.info(`Importer #${importer.id} is ${importer.status}!`);
            job.update(importer.state);
            if (importer.isFailed) {
                await this.events.emit<ImporterWorkerFailed>({
                    type: ImporterWorkerEvents.FAILED,
                    data: {
                        id: importer.id,
                        type: importer.type,
                        exchange: importer.exchange,
                        asset: importer.asset,
                        currency: importer.currency,
                        error: importer.error
                    }
                });
                throw new BaseError(importer.error, { importerId: importer.id }); //TODO: requeue
            }
            if (importer.isFinished)
                await this.events.emit<ImporterWorkerFinished>({
                    type: ImporterWorkerEvents.FINISHED,
                    data: {
                        id: importer.id,
                        type: importer.type,
                        exchange: importer.exchange,
                        asset: importer.asset,
                        currency: importer.currency,
                        status: importer.status
                    }
                });
            return importer.state;
        } catch (err) {
            this.log.error(`Error while processing job ${job.id}`, err);
            throw err;
        }
    }

    async importTrades(job: Job<ImporterState, ImporterState>, importer: Importer): Promise<void> {
        try {
            await DataStream.from(importer.tradesChunks, { maxParallel: this.cpus * 2 })
                .while(() => importer.isStarted && !this.abort[importer.id])
                .map(async (chunk: TradesChunk) => this.loadTrades(importer, chunk))
                .while(() => importer.isStarted && !this.abort[importer.id])
                .map(
                    async ({
                        timeframes,
                        chunk,
                        trades
                    }: {
                        timeframes: number[];
                        chunk: TradesChunk;
                        trades: ExchangeTrade[];
                    }) => this.tradesToCandles({ timeframes, chunk, trades })
                )
                .while(() => importer.isStarted && !this.abort[importer.id])
                .each(
                    async ({
                        chunk,
                        candlesInTimeframes
                    }: {
                        chunk: TradesChunk;
                        candlesInTimeframes: ExchangeCandlesInTimeframes;
                    }) => this.finalizeTrades(job, importer, chunk, candlesInTimeframes)
                )
                .catch((err: Error) => {
                    importer.fail(err.message);
                })
                .while(() => importer.isStarted && !this.abort[importer.id])
                .whenEnd();
        } catch (err) {
            this.log.error(`Importer #${importer.id} - Failed while importing trades`, err);
            throw err;
        }
    }

    async importCandles(job: Job<ImporterState, ImporterState>, importer: Importer): Promise<void> {
        try {
            await DataStream.from(importer.candlesChunks, { maxParallel: 10 })
                .while(() => importer.isStarted)
                .map(async (chunk: CandlesChunk) => this.loadCandles(importer, chunk))
                .while(() => importer.isStarted)
                .each(async ({ chunk, candles }: { chunk: CandlesChunk; candles: ExchangeCandle[] }) =>
                    this.finalizeCandles(job, importer, chunk, candles)
                )
                .catch((err: Error) => {
                    importer.fail(err.message);
                })
                .while(() => importer.isStarted)
                .whenEnd();
        } catch (err) {
            this.log.error(`Importer #${importer.id} - Failed while importing candle`, err);
            throw err;
        }
    }

    async loadTrades(
        importer: Importer,
        chunk: TradesChunk
    ): Promise<{
        timeframes: number[];
        chunk: TradesChunk;
        trades: ExchangeTrade[];
    }> {
        try {
            this.log.info(`Importer #${importer.id} - Loading chunk ${chunk.dateFrom} - ${chunk.dateTo}`);
            let trades: ExchangeTrade[] = [];
            let dateNext = dayjs.utc(chunk.dateFrom);
            while (dateNext.valueOf() <= dayjs.utc(chunk.dateTo).valueOf()) {
                const response: ExchangeTrade[] = await this.connector.getTrades(
                    importer.exchange,
                    importer.asset,
                    importer.currency,
                    dateNext.toISOString()
                );
                if (!response || !Array.isArray(response)) throw new Error("Wrong connector response");
                dateNext = dayjs.utc(chunk.dateTo);
                if (response.length > 0) {
                    trades = [...trades, ...response];

                    dateNext = dayjs.utc(response[response.length - 1].timestamp);
                }
            }
            this.log.info(
                `Importer #${importer.id} - Loaded chunk ${chunk.dateFrom} - ${chunk.dateTo} => ${trades.length}`
            );
            return {
                timeframes: importer.params.timeframes,
                chunk,
                trades
            };
        } catch (err) {
            this.log.error(`Importer #${importer.id} - Failed to load chunk ${chunk.dateFrom} - ${chunk.dateTo}`, err);
            throw err;
        }
    }

    async loadCandles(
        importer: Importer,
        chunk: CandlesChunk
    ): Promise<{
        chunk: TradesChunk;
        candles: ExchangeCandle[];
    }> {
        try {
            this.log.info(
                `Importer #${importer.id} - Loading ${chunk.timeframe} chunk ${chunk.dateFrom} - ${chunk.dateTo}`
            );
            let candles = await this.connector.getCandles(
                importer.exchange,
                importer.asset,
                importer.currency,
                chunk.timeframe,
                chunk.dateFrom,
                chunk.limit
            );
            if (!candles || !Array.isArray(candles) || candles.length === 0) {
                this.log.warn(
                    `Importer #${importer.id} - Failed to load ${chunk.timeframe} chunk ${chunk.dateFrom} - ${chunk.dateTo}`
                );
                if (importer.type === "recent") return { chunk, candles: [] };
                else throw new Error(`Empty response`);
            }
            const dateFromValueOf = dayjs.utc(chunk.dateFrom).valueOf();
            const dateToValueOf = dayjs.utc(chunk.dateTo).valueOf();
            candles = candles.filter((candle) => candle.time >= dateFromValueOf && candle.time <= dateToValueOf);

            this.log.info(
                `Importer #${importer.id} - Loaded ${chunk.timeframe} chunk ${chunk.dateFrom}(${
                    candles[0].timestamp
                }) - ${chunk.dateTo}(${candles[candles.length - 1].timestamp}) => ${candles.length}`
            );

            return {
                chunk,
                candles
            };
        } catch (err) {
            this.log.error(
                `Importer #${importer.id} - Failed to load ${chunk.timeframe} chunk ${chunk.dateFrom} - ${chunk.dateTo}`,
                err
            );
            throw err;
        }
    }

    async upsertCandles(candles: ExchangeCandle[]): Promise<void> {
        try {
            if (candles && Array.isArray(candles) && candles.length > 0) {
                const timeframe = candles[0].timeframe;

                const call = async (bail: (e: Error) => void) => {
                    try {
                        await this.db.pg.query(sql`
                insert into ${sql.identifier([`candles${timeframe}`])} 
                (exchange, asset, currency, open, high, low, close, volume, time, timestamp, type)
                SELECT *
                FROM ${sql.unnest(
                    this.db.util.prepareUnnest(candles, [
                        "exchange",
                        "asset",
                        "currency",
                        "open",
                        "high",
                        "low",
                        "close",
                        "volume",
                        "time",
                        "timestamp",
                        "type"
                    ]),
                    [
                        "varchar",
                        "varchar",
                        "varchar",
                        "numeric",
                        "numeric",
                        "numeric",
                        "numeric",
                        "numeric",
                        "int8",
                        "timestamp",
                        "varchar"
                    ]
                )}
                ON CONFLICT ON CONSTRAINT ${sql.identifier([`candles${timeframe}_time_exchange_asset_currency_key`])}
                DO UPDATE SET open = excluded.open,
                high = excluded.high,
                low = excluded.low,
                close = excluded.close,
                volume = excluded.volume,
                type = excluded.type;`);
                    } catch (e) {
                        bail(e);
                    }
                };
                await retry(call, {
                    retries: 5,
                    minTimeout: 500,
                    maxTimeout: 30000,
                    onRetry: (err: any, i: number) => {
                        if (err) {
                            this.log.warn(`Retry save candles ${i} - ${err.message}`);
                        }
                    }
                });
            }
        } catch (err) {
            this.log.error("Failed to upsert candles", err);
            throw err;
        }
    }

    async finalizeCandles(
        job: Job<ImporterState, ImporterState>,
        importer: Importer,
        chunk: CandlesChunk,
        candles: ExchangeCandle[]
    ): Promise<void> {
        try {
            if (candles && Array.isArray(candles) && candles.length > 0) {
                this.log.info(
                    `Importer #${importer.id} - Finalizing ${chunk.timeframe} candles ${candles[0].timestamp} - ${
                        candles[candles.length - 1].timestamp
                    }`
                );
                await this.upsertCandles(candles);
            }
            const progress = importer.setCandlesProgress(chunk.timeframe, chunk.id);
            await job.updateProgress(progress);
            await job.update(importer.state);
        } catch (err) {
            this.log.error(
                `Importer #${importer.id} - Failed to save ${chunk.timeframe} chunk ${chunk.dateFrom} - ${chunk.dateTo}`,
                err
            );
            throw err;
        }
    }

    async finalizeTrades(
        job: Job<ImporterState, ImporterState>,
        importer: Importer,
        chunk: TradesChunk,
        candlesInTimeframes: ExchangeCandlesInTimeframes
    ): Promise<void> {
        try {
            for (const [timeframe, candles] of Object.entries(candlesInTimeframes)) {
                this.log.info(
                    `Importer #${importer.id} - Finalizing ${timeframe} candles ${candles[0].timestamp} - ${
                        candles[candles.length - 1].timestamp
                    }`
                );
                await this.upsertCandles(candles);
            }

            const progress = importer.setTradesProgress(chunk.id);
            await job.updateProgress(progress);
            await job.update(importer.state);
        } catch (err) {
            this.log.error(`Importer #${importer.id} - Failed to save chunk ${chunk.dateFrom} - ${chunk.dateTo}`, err);
            throw err;
        }
    }
}
