import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import ccxtpro from "ccxt.pro";
import cron from "node-cron";
import { v4 as uuid } from "uuid";
import retry from "async-retry";
import dayjs from "@cryptuoso/dayjs";
import { PublicConnector } from "@cryptuoso/ccxt-public";
import { Timeframe, CandleType, ExchangePrice, ExchangeCandle } from "@cryptuoso/market";
import { createSocksProxyAgent } from "@cryptuoso/ccxt-public";
import { uniqueElementsBy, sleep } from "@cryptuoso/helpers";
import {
    ImporterRunnerEvents,
    ImporterRunnerStart,
    ImporterWorkerSchema,
    ImporterWorkerEvents,
    ImporterWorkerFinished,
    ImporterWorkerFailed
} from "@cryptuoso/importer-events";
import {
    ExwatcherWorkerEvents,
    ExwatcherSchema,
    ExwatcherSubscribe,
    ExwatcherSubscribeAll,
    ExwatcherUnsubscribeAll,
    ExwatcherTick
} from "@cryptuoso/exwatcher-events";

// !FIXME: ccxt.pro typings

export interface ExwatcherBaseServiceConfig extends BaseServiceConfig {
    exchange: string;
}

export const enum ExwatcherStatus {
    pending = "pending",
    importing = "importing",
    subscribed = "subscribed",
    unsubscribed = "unsubscribed",
    failed = "failed"
}

export interface Exwatcher {
    id: string;
    exchange: string;
    asset: string;
    currency: string;
    status: ExwatcherStatus;
    importerId: string;
    error?: string;
}

interface Trade {
    amount: number; // amount of base currency
    price: number; // float price in quote currency
    timestamp: number; // Unix timestamp in milliseconds
}

export class ExwatcherBaseService extends BaseService {
    exchange: string;
    connector: any; //!FIXME ccxtpro.Exchange;
    publicConnector: PublicConnector;
    subscriptions: { [key: string]: Exwatcher } = {};
    candlesCurrent: { [key: string]: { [key: string]: ExchangeCandle } } = {};
    lastTick: { [key: string]: ExchangePrice } = {};
    cronCheck: cron.ScheduledTask = cron.schedule("*/30 * * * * *", this.check.bind(this), {
        scheduled: false
    });
    cronHandleChanges: cron.ScheduledTask;
    lastDate: number;

    constructor(config?: ExwatcherBaseServiceConfig) {
        super(config);
        this.exchange = config.exchange;
        this.publicConnector = new PublicConnector();
        this.events.subscribe({
            [ExwatcherWorkerEvents.SUBSCRIBE]: {
                schema: ExwatcherSchema[ExwatcherWorkerEvents.SUBSCRIBE],
                handler: this.addSubscription.bind(this)
            },
            [ExwatcherWorkerEvents.SUBSCRIBE_ALL]: {
                schema: ExwatcherSchema[ExwatcherWorkerEvents.SUBSCRIBE_ALL],
                handler: this.subscribeAll.bind(this)
            },
            [ExwatcherWorkerEvents.UNSUBSCRIBE_ALL]: {
                schema: ExwatcherSchema[ExwatcherWorkerEvents.UNSUBSCRIBE_ALL],
                handler: this.unsubscribeAll.bind(this)
            },
            [ImporterWorkerEvents.FAILED]: {
                schema: ImporterWorkerSchema[ImporterWorkerEvents.FAILED],
                handler: this.handleImporterFailedEvent.bind(this),
                unbalanced: true
            },
            [ImporterWorkerEvents.FINISHED]: {
                schema: ImporterWorkerSchema[ImporterWorkerEvents.FINISHED],
                handler: this.handleImporterFinishedEvent.bind(this),
                unbalanced: true
            }
        });
        this.addOnStartHandler(this.onStartService);
        this.addOnStopHandler(this.onStopService);
    }

    get activeSubscriptions() {
        return Object.values(this.subscriptions).filter(({ status }) => status === ExwatcherStatus.subscribed);
    }

    async onStartService() {
        if (this.exchange === "binance_futures") {
            this.connector = new ccxtpro.binance({
                enableRateLimit: true,
                agent: createSocksProxyAgent(process.env.PROXY_ENDPOINT),
                // !FIXME: ccxt.pro optional typings
                // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
                // @ts-ignore
                options: { defaultType: "future", OHLCVLimit: 100, tradesLimit: 1000 }
            });
            this.cronHandleChanges = cron.schedule("* * * * * *", this.handleCandles.bind(this), {
                scheduled: false
            });
        } else if (this.exchange === "bitfinex") {
            this.connector = new ccxtpro.bitfinex({
                enableRateLimit: true,
                agent: createSocksProxyAgent(process.env.PROXY_ENDPOINT),
                // !FIXME: ccxt.pro optional typings
                // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
                // @ts-ignore
                options: { OHLCVLimit: 100, tradesLimit: 1000 }
            });
            this.cronHandleChanges = cron.schedule("* * * * * *", this.handleTrades.bind(this), {
                scheduled: false
            });
        } else if (this.exchange === "kraken") {
            this.connector = new ccxtpro.kraken({
                enableRateLimit: true,
                agent: createSocksProxyAgent(process.env.PROXY_ENDPOINT),
                // !FIXME: ccxt.pro optional typings
                // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
                // @ts-ignore
                options: { OHLCVLimit: 100, tradesLimit: 1000 }
            });
            this.cronHandleChanges = cron.schedule("* * * * * *", this.handleTrades.bind(this), {
                scheduled: false
            });
        } else throw new Error("Unsupported exchange");

        await this.resubscribe();
        this.cronHandleChanges.start();
        this.cronCheck.start();
    }

    async onStopService() {
        try {
            this.cronHandleChanges.stop();
            this.cronCheck.stop();
            await this.unsubscribeAll({ exchange: this.exchange });
            await sleep(5000);
            await this.connector.close();
        } catch (e) {
            this.log.error(e);
        }
    }

    async handleImporterFinishedEvent(event: ImporterWorkerFinished) {
        const { id: importerId, type, exchange } = event;
        if (exchange !== this.exchange && type !== "recent") return;
        const subscription = Object.values(this.subscriptions).find((sub: Exwatcher) => sub.importerId === importerId);
        if (subscription) {
            this.log.info(`Importer ${importerId} finished!`);
            await this.subscribe(subscription);
        }
    }

    async handleImporterFailedEvent(event: ImporterWorkerFailed) {
        const { id: importerId, type, exchange, error } = event;
        if (exchange !== this.exchange && type !== "recent") return;
        const subscription = Object.values(this.subscriptions).find((sub: Exwatcher) => sub.importerId === importerId);

        if (subscription && subscription.id) {
            this.log.warn(`Importer ${importerId} failed!`, error);
            this.subscriptions[subscription.id].status = ExwatcherStatus.failed;
            this.subscriptions[subscription.id].error = error;
            await this.saveSubscription(this.subscriptions[subscription.id]);
        }
    }

    async check(): Promise<void> {
        try {
            const pendingSubscriptions = Object.values(this.subscriptions).filter(({ status }) =>
                [ExwatcherStatus.pending, ExwatcherStatus.unsubscribed, ExwatcherStatus.failed].includes(status)
            );
            if (pendingSubscriptions.length > 0)
                await Promise.all(
                    pendingSubscriptions.map(async ({ asset, currency }: Exwatcher) =>
                        this.addSubscription({ exchange: this.exchange, asset, currency })
                    )
                );

            await this.watch();
        } catch (e) {
            this.log.error(e);
        }
    }

    async watch(): Promise<void> {
        this.activeSubscriptions.map(async ({ asset, currency }: Exwatcher) => {
            const symbol = this.getSymbol(asset, currency);
            if (this.exchange === "binance_futures") {
                await Promise.all(
                    Timeframe.validArray.map(async (timeframe) => {
                        try {
                            await this.connector.watchOHLCV(symbol, Timeframe.timeframes[timeframe].str);
                        } catch (e) {
                            this.log.warn(symbol, timeframe, e);
                        }
                    })
                );
            } else {
                try {
                    await this.connector.watchTrades(symbol);
                } catch (e) {
                    this.log.warn(symbol, e);
                }
            }
        });
    }

    async resubscribe() {
        try {
            const subscriptions: Exwatcher[] = await this.db.pg.many(
                this.db.sql`select * from exwatchers where exchange = ${this.exchange}`
            );
            if (subscriptions && Array.isArray(subscriptions) && subscriptions.length > 0) {
                await Promise.all(
                    subscriptions.map(async ({ id, asset, currency }: Exwatcher) => {
                        if (
                            !this.subscriptions[id] ||
                            (this.subscriptions[id] &&
                                (this.subscriptions[id].status !== ExwatcherStatus.subscribed ||
                                    this.subscriptions[id].status !== ExwatcherStatus.importing))
                        ) {
                            await this.addSubscription({ exchange: this.exchange, asset, currency });
                        }
                    })
                );
            }
        } catch (e) {
            this.log.error(e);
        }
    }

    async subscribeAll({ exchange }: ExwatcherSubscribeAll) {
        try {
            if (exchange !== this.exchange) return;
            const markets: { asset: string; currency: string }[] = await this.db.pg.many(this.db.sql`
            SELECT asset, currency 
            FROM markets
            WHERE exchange = ${this.exchange} AND available > 0;
            `);

            for (const { asset, currency } of markets) {
                await this.addSubscription({ exchange: this.exchange, asset, currency });
            }
        } catch (e) {
            this.log.error(e);
            throw e;
        }
    }

    async unsubscribeAll({ exchange }: ExwatcherUnsubscribeAll) {
        try {
            if (exchange !== this.exchange) return;
            await Promise.all(
                Object.keys(this.subscriptions).map(async (id) => {
                    this.subscriptions[id].status = ExwatcherStatus.unsubscribed;
                    await this.saveSubscription(this.subscriptions[id]);
                })
            );
        } catch (e) {
            this.log.error(e);
            throw e;
        }
    }

    async addSubscription({ exchange, asset, currency }: ExwatcherSubscribe): Promise<void> {
        if (exchange !== this.exchange) return;
        const id = `${this.exchange}.${asset}.${currency}`;
        try {
            if (
                !this.subscriptions[id] ||
                [ExwatcherStatus.pending, ExwatcherStatus.unsubscribed, ExwatcherStatus.failed].includes(
                    this.subscriptions[id].status
                )
            ) {
                this.log.info(`Adding ${id} subscription...`);
                this.subscriptions[id] = {
                    id,
                    exchange: this.exchange,
                    asset,
                    currency,
                    status: ExwatcherStatus.pending,
                    importerId: null,
                    error: null
                };

                const importerId = await this.importRecentCandles(this.subscriptions[id]);
                if (importerId) {
                    this.subscriptions[id].status = ExwatcherStatus.importing;
                    this.subscriptions[id].importerId = importerId;
                    await this.saveSubscription(this.subscriptions[id]);
                }
            }
        } catch (e) {
            this.log.error(e);
            throw e;
        }
    }

    async removeSubscription(asset: string, currency: string): Promise<void> {
        const id = `${this.exchange}.${asset}.${currency}`;
        try {
            if (this.subscriptions[id]) {
                //TODO unwatch when implemented in ccxt.pro
                await this.deleteSubscription(id);
                delete this.subscriptions[id];
                if (this.candlesCurrent[id]) delete this.candlesCurrent[id];
            }
        } catch (e) {
            this.log.error(e);
            throw e;
        }
    }

    async subscribe(subscription: Exwatcher) {
        try {
            if (subscription) {
                const { id, status } = subscription;
                if (status !== ExwatcherStatus.subscribed) {
                    try {
                        this.candlesCurrent[id] = {};
                        await this.subscribeCCXT(id);

                        this.subscriptions[id].status = ExwatcherStatus.subscribed;
                        this.subscriptions[id].error = null;
                        this.log.info(`Subscribed ${id}`);

                        await this.saveSubscription(this.subscriptions[id]);
                    } catch (e) {
                        this.log.error(e);
                        this.subscriptions[id].status = ExwatcherStatus.failed;
                        this.subscriptions[id].error = e.message;
                        await this.saveSubscription(this.subscriptions[id]);
                    }
                }
            }
        } catch (err) {
            this.log.error(`Failed to subscribe ${subscription.id}`, err);
        }
    }

    getSymbol(asset: string, currency: string): string {
        return `${asset}/${currency}`;
    }

    async subscribeCCXT(id: string) {
        try {
            const symbol = this.getSymbol(this.subscriptions[id].asset, this.subscriptions[id].currency);
            if (this.exchange === "binance_futures") {
                for (const timeframe of Timeframe.validArray) {
                    await this.connector.watchOHLCV(symbol, Timeframe.timeframes[timeframe].str);
                }
            } else if (this.exchange === "bitfinex" || this.exchange === "kraken") {
                await this.connector.watchTrades(symbol);
                await this.loadCurrentCandles(this.subscriptions[id]);
            } else {
                throw new Error("Exchange is not supported");
            }
        } catch (err) {
            this.log.error(`CCXT Subscribe Error ${id}`, err);
            throw err;
        }
    }

    async importRecentCandles(subscription: Exwatcher): Promise<string> {
        const { exchange, asset, currency } = subscription;
        const id = uuid();
        await this.events.emit<ImporterRunnerStart>(ImporterRunnerEvents.START, {
            id,
            exchange,
            asset,
            currency,
            type: "recent"
        });

        return id;
    }

    async loadCurrentCandles(subscription: Exwatcher): Promise<void> {
        try {
            const { id, exchange, asset, currency } = subscription;
            this.log.info(`Loading current candles ${id}`);
            if (!this.candlesCurrent[id]) this.candlesCurrent[id] = {};
            await Promise.all(
                Timeframe.validArray.map(async (timeframe) => {
                    const candle: ExchangeCandle = await this.publicConnector.getCurrentCandle(
                        exchange,
                        asset,
                        currency,
                        timeframe
                    );

                    this.candlesCurrent[id][timeframe] = {
                        ...candle
                    };
                    await this.saveCandles([this.candlesCurrent[id][timeframe]]);
                })
            );
        } catch (err) {
            this.log.error(`Failed to load current candles ${subscription.id}`, err);
            throw err;
        }
    }

    async publishTick(tick: ExchangePrice): Promise<void> {
        try {
            await this.events.emit<ExwatcherTick>(ExwatcherWorkerEvents.TICK, tick);
        } catch (err) {
            this.log.error("Failed to publich tick", err);
        }
    }

    async saveSubscription(subscription: Exwatcher): Promise<void> {
        const { id, exchange, asset, currency, status, importerId, error } = subscription;
        await this.db.pg.query(this.db.sql`INSERT INTO exwatchers 
        ( id, 
            exchange,
            asset,
            currency,
            status,
            importer_id, 
            error
          )  VALUES
       (
        ${id},
        ${exchange},
        ${asset},
        ${currency},
        ${status},
        ${importerId || null},
        ${error || null}
        )
        ON CONFLICT ON CONSTRAINT exwatchers_pkey 
        DO UPDATE SET updated_at = now(),
        status = excluded.status,
        importer_id = excluded.importer_id,
        error = excluded.error;`);
    }

    async deleteSubscription(id: string): Promise<void> {
        await this.db.pg.query(this.db.sql`DELETE FROM exwatchers WHERE id = ${id}`);
    }

    async handleCandles(): Promise<void> {
        try {
            // Текущие дата и время - минус одна секунда
            const date = dayjs.utc().add(-1, "second").startOf("second");
            // Есть ли подходящие по времени таймфреймы
            const currentTimeframes = Timeframe.timeframesByDate(date.toISOString());
            const closedCandles: { [key: string]: ExchangeCandle[] } = {};

            await Promise.all(
                this.activeSubscriptions.map(async ({ id, asset, currency }: Exwatcher) => {
                    try {
                        const symbol = this.getSymbol(asset, currency);
                        const currentCandles: ExchangeCandle[] = [];
                        await Promise.all(
                            Timeframe.validArray.map(async (timeframe) => {
                                try {
                                    if (this.candlesCurrent[id][timeframe]) {
                                        const candleTime = dayjs
                                            .utc(Timeframe.validTimeframeDatePrev(date.toISOString(), timeframe))
                                            .valueOf();

                                        const candle: [
                                            number,
                                            number,
                                            number,
                                            number,
                                            number,
                                            number
                                        ] = this.connector.ohlcvs[symbol][Timeframe.get(timeframe).str].find(
                                            (c: any) => c[0] === candleTime
                                        );
                                        if (candle) {
                                            if (this.candlesCurrent[id][timeframe].time === candleTime) {
                                                this.candlesCurrent[id][timeframe].open = candle[1];
                                                this.candlesCurrent[id][timeframe].high = candle[2];
                                                this.candlesCurrent[id][timeframe].low = candle[3];
                                                this.candlesCurrent[id][timeframe].close = candle[4];
                                                this.candlesCurrent[id][timeframe].volume = candle[5];
                                                this.candlesCurrent[id][timeframe].type =
                                                    this.candlesCurrent[id][timeframe].volume === 0
                                                        ? CandleType.previous
                                                        : CandleType.loaded;
                                            } else {
                                                closedCandles[timeframe].push({
                                                    ...this.candlesCurrent[id][timeframe]
                                                });
                                                this.candlesCurrent[id][timeframe].time = candle[0];
                                                this.candlesCurrent[id][timeframe].timestamp = dayjs
                                                    .utc(candle[0])
                                                    .toISOString();
                                                this.candlesCurrent[id][timeframe].open = candle[1];
                                                this.candlesCurrent[id][timeframe].high = candle[2];
                                                this.candlesCurrent[id][timeframe].low = candle[3];
                                                this.candlesCurrent[id][timeframe].close = candle[4];
                                                this.candlesCurrent[id][timeframe].volume = candle[5];
                                                this.candlesCurrent[id][timeframe].type =
                                                    this.candlesCurrent[id][timeframe].volume === 0
                                                        ? CandleType.previous
                                                        : CandleType.loaded;
                                            }
                                        }
                                    } else {
                                        const candles: [
                                            number,
                                            number,
                                            number,
                                            number,
                                            number,
                                            number
                                        ][] = this.connector.ohlcvs[symbol][Timeframe.get(timeframe).str].filter(
                                            (c: any) => c[0] < date.valueOf()
                                        );
                                        const candle = candles[candles.length - 1];
                                        if (candle) {
                                            this.candlesCurrent[id][timeframe] = {
                                                exchange: this.exchange,
                                                asset,
                                                currency,
                                                timeframe,
                                                time: candle[0],
                                                timestamp: dayjs.utc(candle[0]).toISOString(),
                                                open: candle[1],
                                                high: candle[2],
                                                low: candle[3],
                                                close: candle[4],
                                                volume: candle[5],
                                                type: candle[5] === 0 ? CandleType.previous : CandleType.loaded
                                            };
                                        }
                                    }
                                    if (this.candlesCurrent[id][timeframe])
                                        currentCandles.push(this.candlesCurrent[id][timeframe]);
                                } catch (error) {
                                    this.log.error(error);
                                }
                            })
                        );

                        if (currentCandles.length > 0) {
                            await this.saveCandles(currentCandles);
                        }

                        let tick: ExchangePrice;
                        if (
                            this.candlesCurrent[id][1440] &&
                            this.lastTick[id] &&
                            this.candlesCurrent[id][1440].close !== this.lastTick[id].price
                        ) {
                            const { time, timestamp, close } = this.candlesCurrent[id][1440];
                            tick = {
                                exchange: this.exchange,
                                asset,
                                currency,
                                time,
                                timestamp,
                                price: close
                            };
                            this.lastTick[id] = tick;
                        } else {
                            if (this.candlesCurrent[id][1440]) {
                                const { time, timestamp, close } = this.candlesCurrent[id][1440];
                                tick = {
                                    exchange: this.exchange,
                                    asset,
                                    currency,
                                    time,
                                    timestamp,
                                    price: close
                                };
                                this.lastTick[id] = tick;
                            }
                        }

                        if (tick) {
                            await this.publishTick(tick);
                        }
                    } catch (err) {
                        this.log.error(err);
                    }
                })
            );

            if (currentTimeframes.length > 0) {
                // Сброс текущих свечей
                currentTimeframes.forEach((timeframe) => {
                    closedCandles[timeframe] = [];
                    this.activeSubscriptions.forEach(({ id, asset, currency }: Exwatcher) => {
                        const symbol = this.getSymbol(asset, currency);
                        if (this.candlesCurrent[id] && this.candlesCurrent[id][timeframe]) {
                            closedCandles[timeframe].push({
                                ...this.candlesCurrent[id][timeframe]
                            });
                            this.candlesCurrent[id][timeframe].time = date.startOf("minute").valueOf();
                            this.candlesCurrent[id][timeframe].timestamp = date.startOf("minute").toISOString();

                            const candle: [number, number, number, number, number, number] = this.connector.ohlcvs[
                                symbol
                            ][Timeframe.get(timeframe).str][
                                this.connector.ohlcvs[symbol][Timeframe.get(timeframe).str].length - 1
                            ];
                            if (candle[0] === date.valueOf()) {
                                this.candlesCurrent[id][timeframe].open = candle[1];
                                this.candlesCurrent[id][timeframe].high = candle[2];
                                this.candlesCurrent[id][timeframe].low = candle[3];
                                this.candlesCurrent[id][timeframe].close = candle[4];
                                this.candlesCurrent[id][timeframe].volume = candle[5];
                            } else {
                                this.candlesCurrent[id][timeframe].open = candle[4];
                                this.candlesCurrent[id][timeframe].high = candle[4];
                                this.candlesCurrent[id][timeframe].low = candle[4];
                                this.candlesCurrent[id][timeframe].close = candle[4];
                                this.candlesCurrent[id][timeframe].volume = 0;
                            }
                            this.candlesCurrent[id][timeframe].type =
                                this.candlesCurrent[id][timeframe].volume === 0
                                    ? CandleType.previous
                                    : CandleType.loaded;
                        }
                    });
                });
            }

            if (Object.keys(closedCandles).length > 0) {
                await Promise.all(
                    Object.keys(closedCandles).map(async (timeframe) => {
                        const candles = closedCandles[timeframe];
                        if (candles && Array.isArray(candles) && candles.length > 0) {
                            this.log.info(
                                `New ${uniqueElementsBy(
                                    candles,
                                    (a, b) =>
                                        a.exchange === b.exchange && a.asset === b.asset && a.currency === b.currency
                                ).map(
                                    ({ exchange, asset, currency }) => `${exchange}.${asset}.${currency}.${timeframe}`
                                )} candles`
                            );
                            await this.saveCandles(candles);
                        }
                    })
                );
            }

            this.lastDate = date.valueOf();
        } catch (e) {
            this.log.error(e);
        }
    }

    async handleTrades(): Promise<void> {
        try {
            // Текущие дата и время - минус одна секунда
            const date = dayjs.utc().add(-1, "second").startOf("second");

            // Есть ли подходящие по времени таймфреймы
            const currentTimeframes = Timeframe.timeframesByDate(date.toISOString());
            const closedCandles: { [key: string]: ExchangeCandle[] } = {};

            await Promise.all(
                this.activeSubscriptions.map(async ({ id, asset, currency }: Exwatcher) => {
                    const symbol = this.getSymbol(asset, currency);

                    if (this.connector.trades[symbol]) {
                        // Запрашиваем все прошедшие трейды
                        const trades: Trade[] = this.connector.trades[symbol].filter(
                            ({ timestamp }: Trade) =>
                                timestamp < date.valueOf() && (!this.lastDate || timestamp >= this.lastDate)
                        );

                        // Если были трейды
                        if (trades.length > 0) {
                            // Если было изменение цены
                            let tick: ExchangePrice;
                            if (this.lastTick[id]) {
                                const prices = trades
                                    .filter(({ timestamp }: Trade) => timestamp > this.lastTick[id].time)
                                    .map((t) => t.price);
                                if (prices.length > 0 && prices.some((d) => d !== this.lastTick[id].price)) {
                                    const { timestamp, price } = trades[trades.length - 1];
                                    tick = {
                                        exchange: this.exchange,
                                        asset,
                                        currency,
                                        time: timestamp,
                                        timestamp: dayjs.utc(timestamp).toISOString(),
                                        price
                                    };
                                    this.lastTick[id] = tick;
                                }
                            } else {
                                const { timestamp, price } = trades[trades.length - 1];
                                tick = {
                                    exchange: this.exchange,
                                    asset,
                                    currency,
                                    time: timestamp,
                                    timestamp: dayjs.utc(timestamp).toISOString(),
                                    price
                                };
                                this.lastTick[id] = tick;
                            }
                            const currentCandles: ExchangeCandle[] = [];
                            Timeframe.validArray.forEach(async (timeframe) => {
                                if (trades.length > 0) {
                                    const candleTime = dayjs
                                        .utc(Timeframe.validTimeframeDatePrev(date.toISOString(), timeframe))
                                        .valueOf();
                                    if (this.candlesCurrent[id][timeframe].time !== candleTime) {
                                        currentCandles.push(this.candlesCurrent[id][timeframe]);
                                        const { close } = this.candlesCurrent[id][timeframe];
                                        this.candlesCurrent[id][timeframe].time = candleTime;
                                        this.candlesCurrent[id][timeframe].timestamp = dayjs
                                            .utc(candleTime)
                                            .toISOString();
                                        this.candlesCurrent[id][timeframe].high = close;
                                        this.candlesCurrent[id][timeframe].low = close;
                                        this.candlesCurrent[id][timeframe].open = close;
                                        this.candlesCurrent[id][timeframe].volume = 0;
                                        this.candlesCurrent[id][timeframe].type = CandleType.previous;
                                    }
                                    const prices = trades.map((t) => +t.price);
                                    if (this.candlesCurrent[id][timeframe].volume === 0)
                                        this.candlesCurrent[id][timeframe].open = +trades[0].price;
                                    this.candlesCurrent[id][timeframe].high = Math.max(
                                        this.candlesCurrent[id][timeframe].high,
                                        ...prices
                                    );
                                    this.candlesCurrent[id][timeframe].low = Math.min(
                                        this.candlesCurrent[id][timeframe].low,
                                        ...prices
                                    );
                                    this.candlesCurrent[id][timeframe].close = +trades[trades.length - 1].price;
                                    this.candlesCurrent[id][timeframe].volume =
                                        this.candlesCurrent[id][timeframe].volume +
                                            +trades.map((t) => t.amount).reduce((a, b) => a + b, 0) ||
                                        this.candlesCurrent[id][timeframe].volume + 0;
                                    this.candlesCurrent[id][timeframe].type =
                                        this.candlesCurrent[id][timeframe].volume === 0
                                            ? CandleType.previous
                                            : CandleType.created;
                                    currentCandles.push(this.candlesCurrent[id][timeframe]);
                                }
                            });

                            if (currentCandles.length > 0) {
                                await this.saveCandles(currentCandles);
                            }

                            if (tick) {
                                await this.publishTick(tick);
                            }
                        }
                    }
                })
            );

            if (currentTimeframes.length > 0) {
                // Сброс текущих свечей
                currentTimeframes.forEach((timeframe) => {
                    closedCandles[timeframe] = [];
                    this.activeSubscriptions.forEach(({ id }: Exwatcher) => {
                        if (this.candlesCurrent[id] && this.candlesCurrent[id][timeframe]) {
                            closedCandles[timeframe].push({
                                ...this.candlesCurrent[id][timeframe]
                            });
                            const { close } = this.candlesCurrent[id][timeframe];
                            this.candlesCurrent[id][timeframe].time = date.startOf("minute").valueOf();
                            this.candlesCurrent[id][timeframe].timestamp = date.startOf("minute").toISOString();
                            this.candlesCurrent[id][timeframe].high = close;
                            this.candlesCurrent[id][timeframe].low = close;
                            this.candlesCurrent[id][timeframe].open = close;
                            this.candlesCurrent[id][timeframe].volume = 0;
                            this.candlesCurrent[id][timeframe].type = CandleType.previous;
                        }
                    });
                });
            }

            if (Object.keys(closedCandles).length > 0) {
                await Promise.all(
                    Object.keys(closedCandles).map(async (timeframe) => {
                        const candles = closedCandles[timeframe];
                        if (candles && Array.isArray(candles) && candles.length > 0) {
                            this.log.info(
                                `New ${uniqueElementsBy(
                                    candles,
                                    (a, b) =>
                                        a.exchange === b.exchange && a.asset === b.asset && a.currency === b.currency
                                ).map(
                                    ({ exchange, asset, currency }) => `${exchange}.${asset}.${currency}.${timeframe}`
                                )} candles`
                            );
                            await this.saveCandles(candles);
                        }
                    })
                );
            }

            this.lastDate = date.valueOf();
        } catch (e) {
            this.log.error(e);
        }
    }

    async saveCandles(candles: ExchangeCandle[]): Promise<void> {
        try {
            for (const candle of candles) {
                try {
                    const call = async (bail: (e: Error) => void) => {
                        try {
                            await this.db.pg.query(this.db.sql`
                            insert into ${this.db.sql.identifier([`candles${candle.timeframe}`])} 
                (exchange, asset, currency, open, high, low, close, volume, time, timestamp, type)
                values (
                    ${candle.exchange},
                    ${candle.asset},
                    ${candle.currency},
                    ${candle.open},
                    ${candle.high},
                    ${candle.low},
                    ${candle.close},
                    ${candle.volume},
                    ${candle.time},
                    ${candle.timestamp},
                    ${candle.type}
                )
                ON CONFLICT ON CONSTRAINT ${this.db.sql.identifier([
                    `candles${candle.timeframe}_time_exchange_asset_currency_key`
                ])}
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
                } catch (e) {
                    this.log.error(e);
                }
            }
        } catch (e) {
            this.log.error(e);
        }
    }
}
