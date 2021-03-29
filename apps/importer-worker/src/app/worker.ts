import { Observable, Subject } from "threads/observable";
import { expose } from "threads/worker";
import { DataStream } from "scramjet";
import dayjs from "@cryptuoso/dayjs";
import { Importer, CandlesChunk, TradesChunk, ImporterState } from "@cryptuoso/importer-state";
import {
    ExchangeCandle,
    ExchangeTrade,
    ExchangeCandlesInTimeframes,
    createCandlesFromTrades,
    handleCandleGaps
} from "@cryptuoso/market";
import logger, { Logger } from "@cryptuoso/logger";
import { sql, pg, pgUtil } from "@cryptuoso/postgres";
import { PublicConnector } from "@cryptuoso/ccxt-public";
import { uniqueElementsBy, sortAsc } from "@cryptuoso/helpers";

const subject = new Subject();
let importerWorker: ImporterWorker;

class ImporterWorker {
    #connector: PublicConnector;
    #log: Logger;
    #importer: Importer;
    #db: { sql: typeof sql; pg: typeof pg; util: typeof pgUtil };
    defaultChunkSize = 1000;
    defaultInsertChunkSize = 1000;
    constructor(state: ImporterState) {
        this.#connector = new PublicConnector();
        this.#log = logger;
        this.#db = {
            sql,
            pg: pg,
            util: pgUtil
        };
        this.#importer = new Importer(state);
    }

    get log() {
        return this.#log;
    }

    get db() {
        return this.#db;
    }

    get importer() {
        return this.#importer;
    }

    #saveState = async (state: ImporterState) => {
        const {
            id,
            exchange,
            asset,
            currency,
            params,
            status,
            startedAt,
            endedAt,
            type,
            progress,
            error,
            currentState
        } = state;
        await this.db.pg.query(sql`
        INSERT INTO importers
        (id, exchange, asset, currency, 
        params, 
        status, started_at, ended_at, 
        type, progress, error,
        current_state)
        VALUES(
            ${id}, ${exchange}, ${asset}, ${currency},
            ${JSON.stringify(params) || null},
            ${status}, ${startedAt || null}, ${endedAt || null},
            ${type}, ${progress || null}, ${error || null}, 
            ${JSON.stringify(currentState) || null}
        )
        ON CONFLICT ON CONSTRAINT importers_pkey
        DO UPDATE SET params = excluded.params,
        status = excluded.status,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        progress = excluded.progress,
        error = excluded.error,
        current_state = excluded.current_state;
        `);
    };

    async process() {
        try {
            if (!this.#importer.isLoaded || this.#importer.type === "recent") {
                this.log.info(
                    `Importer #${this.#importer.id} - Starting ${this.#importer.type} load of ${
                        this.#importer.exchange
                    } ${this.#importer.asset}/${this.#importer.currency} candles`
                );
                try {
                    await this.#connector.initConnector(this.importer.exchange);
                    const timeframes = this.#connector.connectors[this.#importer.exchange].timeframes;
                    if (this.#importer.exchange === "huobipro") delete timeframes["1d"];
                    this.#importer.createChunks(timeframes);
                    await this.#saveState(this.#importer.state);
                    if (this.#importer.type === "history" && this.#importer.exchange === "kraken") {
                        await this.importTrades();
                    } else {
                        await this.importCandles();
                    }
                } catch (err) {
                    this.#importer.fail(err.message);
                    this.log.warn(`Importer #${this.#importer.id}`, err);
                }
            }
            this.#importer.finish();
            await this.#saveState(this.#importer.state);
            this.log.info(`Importer #${this.#importer.id} is ${this.#importer.status}!`);
            return this.#importer.state;
        } catch (err) {
            this.log.error(`Error while processing job ${this.#importer.id}`, err);
            throw err;
        }
    }

    #tradesToCandles = ({
        timeframes,
        chunk,
        trades
    }: {
        timeframes: number[];
        chunk: TradesChunk;
        trades: ExchangeTrade[];
    }) => {
        const uniqTrades = uniqueElementsBy(
            trades,
            (a, b) => a.time === b.time && a.price === b.price && a.amount === b.amount && a.side === b.side
        )
            .filter(
                (trade) =>
                    trade.time >= dayjs.utc(chunk.dateFrom).valueOf() && trade.time <= dayjs.utc(chunk.dateTo).valueOf()
            )
            .sort((a, b) => sortAsc(a.time, b.time));
        const candlesInTimeframes = createCandlesFromTrades(chunk.dateFrom, chunk.dateTo, timeframes, uniqTrades);
        if (candlesInTimeframes) {
            for (const timeframe of Object.keys(candlesInTimeframes)) {
                const candles = handleCandleGaps(chunk.dateFrom, chunk.dateTo, candlesInTimeframes[+timeframe]);
                candlesInTimeframes[+timeframe] = candles;
            }
        }
        return {
            chunk,
            candlesInTimeframes
        };
    };

    async importTrades(): Promise<void> {
        try {
            if (!this.#importer.tradesChunks.length) return;
            await DataStream.from(this.#importer.tradesChunks, { maxParallel: 10 })
                .map(async (chunk: TradesChunk) => this.loadTrades(chunk))
                .map(
                    async ({
                        timeframes,
                        chunk,
                        trades
                    }: {
                        timeframes: number[];
                        chunk: TradesChunk;
                        trades: ExchangeTrade[];
                    }) => this.#tradesToCandles({ timeframes, chunk, trades })
                )
                .each(
                    async ({
                        chunk,
                        candlesInTimeframes
                    }: {
                        chunk: TradesChunk;
                        candlesInTimeframes: ExchangeCandlesInTimeframes;
                    }) => this.finalizeTrades(chunk, candlesInTimeframes)
                )
                .catch((err: Error) => {
                    this.#importer.fail(err.message);
                })
                .whenEnd();
        } catch (err) {
            this.log.error(`Importer #${this.#importer.id} - Failed while importing trades`, err);
            throw err;
        }
    }

    async importCandles(): Promise<void> {
        try {
            if (!this.#importer.candlesChunks.length) return;
            await DataStream.from(this.#importer.candlesChunks, { maxParallel: 10 })
                .map(async (chunk: CandlesChunk) => this.loadCandles(chunk))
                .each(async ({ chunk, candles }: { chunk: CandlesChunk; candles: ExchangeCandle[] }) =>
                    this.finalizeCandles(chunk, candles)
                )
                .catch((err: Error) => {
                    this.#importer.fail(err.message);
                })
                .whenEnd();
        } catch (err) {
            this.log.error(`Importer #${this.#importer.id} - Failed while importing candle`, err);
            throw err;
        }
    }

    async loadTrades(
        chunk: TradesChunk
    ): Promise<{
        timeframes: number[];
        chunk: TradesChunk;
        trades: ExchangeTrade[];
    }> {
        try {
            this.log.debug(`Importer #${this.#importer.id} - Loading chunk ${chunk.dateFrom} - ${chunk.dateTo}`);
            let trades: ExchangeTrade[] = [];
            let dateNext = dayjs.utc(chunk.dateFrom);
            while (dateNext.valueOf() <= dayjs.utc(chunk.dateTo).valueOf()) {
                const response: ExchangeTrade[] = await this.#connector.getTrades(
                    this.#importer.exchange,
                    this.#importer.asset,
                    this.#importer.currency,
                    dateNext.toISOString()
                );
                if (!response || !Array.isArray(response)) throw new Error("Wrong connector response");
                dateNext = dayjs.utc(chunk.dateTo);
                if (response.length > 0) {
                    trades = [...trades, ...response];

                    dateNext = dayjs.utc(response[response.length - 1].timestamp);
                }
            }
            this.log.debug(
                `Importer #${this.#importer.id} - Loaded chunk ${chunk.dateFrom} - ${chunk.dateTo} => ${trades.length}`
            );
            return {
                timeframes: this.#importer.params.timeframes,
                chunk,
                trades
            };
        } catch (err) {
            this.log.error(
                `Importer #${this.#importer.id} - Failed to load chunk ${chunk.dateFrom} - ${chunk.dateTo}`,
                err
            );
            throw err;
        }
    }

    async loadCandles(
        chunk: CandlesChunk
    ): Promise<{
        chunk: TradesChunk;
        candles: ExchangeCandle[];
    }> {
        try {
            this.log.debug(
                `Importer #${this.#importer.id} - Loading ${chunk.timeframe} chunk ${chunk.dateFrom} - ${chunk.dateTo}`
            );
            let candles = await this.#connector.getCandles(
                this.#importer.exchange,
                this.#importer.asset,
                this.#importer.currency,
                chunk.timeframe,
                chunk.dateFrom,
                chunk.limit
            );
            if (!candles || !Array.isArray(candles) || candles.length === 0) {
                this.log.warn(
                    `Importer #${this.#importer.id} - Failed to load ${chunk.timeframe} chunk ${chunk.dateFrom} - ${
                        chunk.dateTo
                    }`
                );
                //if (this.#importer.type === "recent")
                return { chunk, candles: [] };
                //else throw new Error(`Empty response`);
            }
            const dateFromValueOf = dayjs.utc(chunk.dateFrom).valueOf();
            const dateToValueOf = dayjs.utc(chunk.dateTo).valueOf();
            candles = candles.filter((candle) => candle.time >= dateFromValueOf && candle.time <= dateToValueOf);

            this.log.debug(
                `Importer #${this.#importer.id} - Loaded ${chunk.timeframe} chunk ${chunk.dateFrom}(${
                    candles[0]?.timestamp
                }) - ${chunk.dateTo}(${candles[candles.length - 1]?.timestamp}) => ${candles.length}`
            );

            return {
                chunk,
                candles
            };
        } catch (err) {
            this.log.error(
                `Importer #${this.#importer.id} - Failed to load ${chunk.timeframe} chunk ${chunk.dateFrom} - ${
                    chunk.dateTo
                }`,
                err
            );
            throw err;
        }
    }

    async upsertCandles(candles: ExchangeCandle[]): Promise<void> {
        try {
            if (candles && Array.isArray(candles) && candles.length > 0) {
                const timeframe = candles[0].timeframe;

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
                ON CONFLICT ON (timestamp, exchange, asset, currency)
                DO UPDATE SET open = excluded.open,
                high = excluded.high,
                low = excluded.low,
                close = excluded.close,
                volume = excluded.volume,
                type = excluded.type;`);
            }
        } catch (err) {
            this.log.error("Failed to upsert candles", err);
            throw err;
        }
    }

    async finalizeCandles(chunk: CandlesChunk, candles: ExchangeCandle[]): Promise<void> {
        try {
            if (candles && Array.isArray(candles) && candles.length > 0) {
                this.log.debug(
                    `Importer #${this.#importer.id} - Finalizing ${chunk.timeframe} candles ${
                        candles[0]?.timestamp
                    } - ${candles[candles.length - 1]?.timestamp}`
                );
                await this.upsertCandles(candles);
                this.log.debug(
                    `Importer #${this.#importer.id} - Finalized ${chunk.timeframe} candles ${candles[0]?.timestamp} - ${
                        candles[candles.length - 1]?.timestamp
                    }`
                );
            }
            const progressChanged = this.#importer.setCandlesProgress(chunk.timeframe, chunk.id);
            if (progressChanged) {
                subject.next(this.#importer.state);

                this.log.info(`Importer #${this.#importer.id} - ${this.#importer.progress} %`);
            }
        } catch (err) {
            this.log.error(
                `Importer #${this.#importer.id} - Failed to save ${chunk.timeframe} chunk ${chunk.dateFrom} - ${
                    chunk.dateTo
                }`,
                err
            );
            throw err;
        }
    }

    async finalizeTrades(chunk: TradesChunk, candlesInTimeframes: ExchangeCandlesInTimeframes): Promise<void> {
        try {
            for (const [timeframe, candles] of Object.entries(candlesInTimeframes)) {
                if (candles && Array.isArray(candles) && candles.length > 0) {
                    this.log.debug(
                        `Importer #${this.#importer.id} - Finalizing ${timeframe} candles ${candles[0]?.timestamp} - ${
                            candles[candles.length - 1]?.timestamp
                        }`
                    );
                    await this.upsertCandles(candles);
                    this.log.debug(
                        `Importer #${this.#importer.id} - Finalized ${timeframe} candles ${candles[0]?.timestamp} - ${
                            candles[candles.length - 1]?.timestamp
                        }`
                    );
                }
            }

            const progressChanged = this.#importer.setTradesProgress(chunk.id);
            if (progressChanged) {
                subject.next(this.#importer.state);

                this.log.info(`Importer #${this.#importer.id} - ${this.#importer.progress} %`);
            }
        } catch (err) {
            this.log.error(
                `Importer #${this.#importer.id} - Failed to save chunk ${chunk.dateFrom} - ${chunk.dateTo}`,
                err
            );
            throw err;
        }
    }
}

const worker = {
    async init(state: ImporterState) {
        importerWorker = new ImporterWorker(state);
        return importerWorker.importer.state;
    },
    async process() {
        await importerWorker.process();
        subject.complete();
        return importerWorker.importer.state;
    },
    progress() {
        return Observable.from(subject);
    }
};
export type ImportWorker = typeof worker;

expose(worker);
