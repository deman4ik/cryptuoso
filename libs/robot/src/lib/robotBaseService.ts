import { flattenArray, groupBy, round, sleep, sortAsc } from "@cryptuoso/helpers";
import {
    ActiveAlert,
    Candle,
    CandleType,
    DBCandle,
    ExchangeCandle,
    ExchangePrice,
    OrderType,
    Timeframe,
    ValidTimeframe
} from "@cryptuoso/market";
import { sql } from "@cryptuoso/postgres";
import { v4 as uuid } from "uuid";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { spawn, Pool, Worker as ThreadsWorker, Transfer, TransferDescriptor } from "threads";
import { RobotWorker } from "./worker";
import {
    Robot,
    RobotJobType,
    RobotPosition,
    RobotPositionState,
    RobotState,
    RobotStatus
} from "@cryptuoso/robot-state";
import { Tracer } from "@cryptuoso/logger";
import { PublicConnector } from "@cryptuoso/ccxt-public";
import { createObjectBuffer, getUnderlyingArrayBuffer, loadObjectBuffer } from "@bnaya/objectbuffer";
import sizeof from "object-sizeof";
import ccxtpro from "ccxt.pro";
import cron from "node-cron";
import dayjs from "@cryptuoso/dayjs";
import { StatsCalcRunnerEvents } from "@cryptuoso/stats-calc-events";
import {
    TradeStatsRunnerEvents,
    TradeStatsRunnerPortfolioRobot,
    TradeStatsRunnerRobot
} from "@cryptuoso/trade-stats-events";
import { Exwatcher, ExwatcherStatus, Trade } from "./types";
import {
    getRobotCheckEventName,
    getRobotStatusEventName,
    RobotRunnerEvents,
    RobotRunnerSchema,
    RobotRunnerStatus,
    Signal
} from "@cryptuoso/robot-events";
import {
    ImporterRunnerEvents,
    ImporterRunnerStart,
    ImporterWorkerFinished,
    ImporterWorkerFailed
} from "@cryptuoso/importer-events";
import {
    ExwatcherErrorEvent,
    ExwatcherEvents,
    ExwatcherSubscribe,
    getExwatcherImporterStatusEventName
} from "@cryptuoso/exwatcher-events";
import { ImporterState, Status } from "@cryptuoso/importer-state";
import { DatabaseTransactionConnectionType } from "slonik";

export interface RobotBaseServiceConfig extends HTTPServiceConfig {
    exchange: string;
}

interface RobotStateBuffer {
    robotState: {
        state: RobotState;
        candles?: {
            time: number;
            timestamp: string;
            open: number;
            high: number;
            low: number;
            close: number;
        }[];
    };
    buffer?: ArrayBuffer;
    locked: boolean;
}

export class RobotBaseService extends HTTPService {
    #exchange: string;
    #pool: Pool<any>;
    #connector: any;
    #publicConnector: PublicConnector;
    #subscriptions: { [key: string]: Exwatcher } = {};
    #candlesCurrent: { [id: string]: { [timeframe: string]: ExchangeCandle } } = {};
    #candlesHistory: { [key: string]: { [timeframe: string]: DBCandle[] } } = {};
    #candlesToSave: Map<string, ExchangeCandle> = new Map();
    #candlesSaveTimer: NodeJS.Timer;
    #checkAlertsTimer: NodeJS.Timer;
    #lastTick: { [key: string]: ExchangePrice } = {};
    #cronCheck: cron.ScheduledTask = cron.schedule("*/30 * * * * *", this.check.bind(this), {
        scheduled: false
    });
    #cronHandleChanges: cron.ScheduledTask;
    #cronRunRobots: cron.ScheduledTask = cron.schedule("0 */5 * * * *", this.runRobots.bind(this), {
        scheduled: false
    });
    #lastDate: number;
    #robotAlerts: {
        [key: string]: ActiveAlert;
    } = {};
    #robots: {
        [id: string]: RobotStateBuffer;
    } = {};

    constructor(config: RobotBaseServiceConfig) {
        super(config);
        this.#exchange = config.exchange;
        this.#publicConnector = new PublicConnector();

        this.events.subscribe({
            [getRobotStatusEventName(this.#exchange)]: {
                schema: RobotRunnerSchema[RobotRunnerEvents.STATUS],
                handler: this.handleRobotStatus.bind(this)
            },
            [getRobotCheckEventName(this.#exchange)]: {
                handler: this.handleCheckSubscriptions.bind(this)
            },
            [getExwatcherImporterStatusEventName(this.#exchange)]: {
                schema: {
                    id: "uuid",
                    type: {
                        type: "enum",
                        values: ["recent", "history"]
                    },
                    exchange: "string",
                    asset: "string",
                    currency: "string",
                    status: "string"
                },
                handler: this.handleImporterStatusEvent.bind(this)
            }
        });

        this.addOnStartHandler(this.onServiceStart);
        this.addOnStartedHandler(this.onServiceStarted);
        this.addOnStopHandler(this.onServiceStop);
    }

    // #region Start/Stop
    async onServiceStart() {
        this.#pool = Pool(() => spawn<RobotWorker>(new ThreadsWorker("./worker")), {
            name: "worker",
            concurrency: 10 || this.workerConcurrency
        });
        await this.initConnector();
    }

    async onServiceStarted() {
        this.initCache();
        await this.resubscribe();
        this.#cronHandleChanges.start();
        this.#cronCheck.start();
        this.#cronRunRobots.start();
        this.#candlesSaveTimer = setTimeout(this.handleCandlesToSave.bind(this), 0);
        this.#checkAlertsTimer = setTimeout(this.checkRobotAlerts.bind(this), 0);
    }

    async onServiceStop() {
        try {
            this.#cronRunRobots.stop();
            this.#cronHandleChanges.stop();
            this.#cronCheck.stop();
            await this.unsubscribeAll();
            await sleep(5000);
            await this.#pool.terminate();
            await this.#connector.close();
        } catch (e) {
            this.log.error(e);
        }
    }

    // #endregion

    // #region event handlers
    async handleRobotStatus({ robotId, status }: RobotRunnerStatus) {
        return; //TODO: implement
    }

    async handleCheckSubscriptions() {
        return; //TODO: implement
    }

    async handleImporterStatusEvent(event: ImporterWorkerFinished | ImporterWorkerFailed) {
        const { id: importerId, type, exchange, asset, currency, status } = event;
        if (exchange !== this.#exchange && type !== "recent") return;
        const subscription = Object.values(this.#subscriptions).find(
            (sub: Exwatcher) =>
                sub.status !== ExwatcherStatus.subscribed &&
                (sub.importerId === importerId || (sub.asset === asset && sub.currency === currency))
        );
        if (subscription && status === Status.finished) {
            this.log.info(`Importer ${importerId} finished!`);
            const exwatcherSubscribed = await this.subscribe(subscription); //TODO: subscribe robots
            if (exwatcherSubscribed) await this.subscribeRobots(subscription);
        } else if (subscription && subscription.id && status === Status.failed) {
            const { error } = event as ImporterWorkerFailed;
            this.log.warn(`Importer ${importerId} failed!`, error);
            this.#subscriptions[subscription.id].status = ExwatcherStatus.failed;
            this.#subscriptions[subscription.id].importStartedAt = null;
            this.#subscriptions[subscription.id].error = error;
            await this.saveSubscription(this.#subscriptions[subscription.id]);
        } else {
            this.log.warn("Unknown Importer event", event);
        }
    }
    // #endregion

    // #region getters and helpers

    createExwatcherId(asset: string, currency: string) {
        return `${this.#exchange}.${asset}.${currency}`;
    }

    getMarketKey(asset: string, currency: string) {
        return `${asset}.${currency}`;
    }

    getCandleMapKey(candle: ExchangeCandle): string {
        return `${this.#exchange}.${candle.asset}.${candle.currency}.${candle.timeframe}.${candle.time}`;
    }

    getSymbol(asset: string, currency: string): string {
        return `${asset}/${currency}`;
    }

    get activeSubscriptions() {
        return Object.values(this.#subscriptions).filter(({ status }) => status === ExwatcherStatus.subscribed);
    }

    get allSubscriptionsIsActive() {
        return this.activeSubscriptions.length === Object.keys(this.#subscriptions).length;
    }

    // #endregion

    // #region exwatcher
    async initConnector() {
        if (this.#exchange === "binance_futures") {
            this.#connector = new ccxtpro.binance({
                enableRateLimit: true,
                //agent: createSocksProxyAgent(process.env.PROXY_ENDPOINT),
                options: { defaultType: "future", OHLCVLimit: 100, tradesLimit: 1000 }
            });
            if (!this.#cronHandleChanges)
                this.#cronHandleChanges = cron.schedule("* * * * * *", this.handleCandles.bind(this), {
                    scheduled: false
                });
        } else if (this.#exchange === "bitfinex") {
            this.#connector = new ccxtpro.bitfinex({
                enableRateLimit: true,
                //agent: createSocksProxyAgent(process.env.PROXY_ENDPOINT),
                options: { OHLCVLimit: 100, tradesLimit: 1000 }
            });
            if (!this.#cronHandleChanges)
                this.#cronHandleChanges = cron.schedule("* * * * * *", this.handleTrades.bind(this), {
                    scheduled: false
                });
        } else if (this.#exchange === "kraken") {
            this.#connector = new ccxtpro.kraken({
                enableRateLimit: true,
                //agent: createSocksProxyAgent(process.env.PROXY_ENDPOINT),
                options: { OHLCVLimit: 100, tradesLimit: 1000 }
            });
            if (!this.#cronHandleChanges)
                this.#cronHandleChanges = cron.schedule("* * * * * *", this.handleTrades.bind(this), {
                    scheduled: false
                });
        } else if (this.#exchange === "kucoin") {
            this.#connector = new ccxtpro.kucoin({
                enableRateLimit: true,
                //agent: createSocksProxyAgent(process.env.PROXY_ENDPOINT),
                options: { OHLCVLimit: 100, tradesLimit: 1000 }
            });
            if (!this.#cronHandleChanges)
                this.#cronHandleChanges = cron.schedule("* * * * * *", this.handleTrades.bind(this), {
                    scheduled: false
                });
        } else if (this.#exchange === "huobipro") {
            this.#connector = new ccxtpro.huobipro({
                enableRateLimit: true,
                //agent: createSocksProxyAgent(process.env.PROXY_ENDPOINT),
                options: { OHLCVLimit: 100, tradesLimit: 1000 }
            });
            if (!this.#cronHandleChanges)
                this.#cronHandleChanges = cron.schedule("* * * * * *", this.handleTrades.bind(this), {
                    scheduled: false
                });
        } else throw new Error("Unsupported exchange");
    }

    async check(): Promise<void> {
        try {
            const pendingSubscriptions = Object.values(this.#subscriptions).filter(
                ({ status, importStartedAt }) =>
                    [ExwatcherStatus.pending, ExwatcherStatus.unsubscribed, ExwatcherStatus.failed].includes(status) ||
                    (status === ExwatcherStatus.importing &&
                        importStartedAt &&
                        dayjs.utc().diff(dayjs.utc(importStartedAt), "minute") > 4)
            );
            if (pendingSubscriptions.length > 0)
                await Promise.all(
                    pendingSubscriptions.map(async (subscription: Exwatcher) => {
                        const { asset, currency, importerId } = subscription;
                        if (importerId) {
                            const importer = await this.db.pg.maybeOne<{
                                status: ImporterState["status"];
                                startedAt: ImporterState["startedAt"];
                            }>(sql`SELECT status, started_at FROM importers WHERE id = ${importerId};`);
                            if (importer && importer?.status === Status.finished) {
                                await this.subscribe(subscription);
                                return;
                            } else if (
                                importer &&
                                importer?.startedAt &&
                                dayjs.utc().diff(dayjs.utc(importer.startedAt), "minute") < 5
                            ) {
                                return;
                            }
                        }
                        await this.addSubscription({ exchange: this.#exchange, asset, currency });
                    })
                );

            await this.watch();
        } catch (e) {
            this.log.error(e);
        }
    }

    async watch(): Promise<void> {
        await Promise.all(
            this.activeSubscriptions.map(async ({ id, exchange, asset, currency }: Exwatcher) => {
                const symbol = this.getSymbol(asset, currency);
                if (this.#exchange === "binance_futures") {
                    await Promise.all(
                        Timeframe.validArray.map(async (timeframe) => {
                            try {
                                await this.#connector.watchOHLCV(symbol, Timeframe.timeframes[timeframe].str);
                            } catch (e) {
                                this.log.warn(e, { symbol, timeframe });
                                if (!e.message.includes("connection closed") && !e.message.includes("timed out"))
                                    await this.events.emit<ExwatcherErrorEvent>({
                                        type: ExwatcherEvents.ERROR,
                                        data: {
                                            exchange,
                                            asset,
                                            currency,
                                            exwatcherId: id,
                                            timestamp: dayjs.utc().toISOString(),
                                            error: `${e.message}`
                                        }
                                    });
                                await this.initConnector();
                            }
                        })
                    );
                } else {
                    try {
                        await this.#connector.watchTrades(symbol);
                    } catch (e) {
                        this.log.warn(e, { symbol });
                        if (!e.message.includes("connection closed") && !e.message.includes("timed out"))
                            await this.events.emit<ExwatcherErrorEvent>({
                                type: ExwatcherEvents.ERROR,
                                data: {
                                    exchange,
                                    asset,
                                    currency,
                                    exwatcherId: id,
                                    timestamp: dayjs.utc().toISOString(),
                                    error: `${e.message}`
                                }
                            });
                        await this.initConnector();
                    }
                }
            })
        );
    }

    async resubscribe() {
        try {
            const subscriptions = await this.db.pg.any<Exwatcher>(
                sql`select * from exwatchers where exchange = ${this.#exchange}`
            );

            if (subscriptions && Array.isArray(subscriptions) && subscriptions.length > 0) {
                await Promise.all(
                    subscriptions.map(async ({ id, asset, currency }: Exwatcher) => {
                        if (
                            !this.#subscriptions[id] ||
                            (this.#subscriptions[id] &&
                                (this.#subscriptions[id].status !== ExwatcherStatus.subscribed ||
                                    this.#subscriptions[id].status !== ExwatcherStatus.importing))
                        ) {
                            await this.addSubscription({ exchange: this.#exchange, asset, currency });
                        }
                    })
                );
            } else this.log.warn(`No ${this.#exchange} subscriptions`);
        } catch (e) {
            this.log.error(e);
        }
    }

    async unsubscribeAll() {
        try {
            await Promise.all(
                Object.keys(this.#subscriptions).map(async (id) => {
                    this.#subscriptions[id].status = ExwatcherStatus.unsubscribed;
                    await this.saveSubscription(this.#subscriptions[id]);
                })
            );
        } catch (e) {
            this.log.error(e);
            throw e;
        }
    }

    async addSubscription({ exchange, asset, currency }: ExwatcherSubscribe): Promise<void> {
        if (exchange !== this.#exchange) return;
        const id = this.createExwatcherId(asset, currency);
        try {
            if (
                !this.#subscriptions[id] ||
                [ExwatcherStatus.pending, ExwatcherStatus.unsubscribed, ExwatcherStatus.failed].includes(
                    this.#subscriptions[id].status
                ) ||
                (this.#subscriptions[id].status === ExwatcherStatus.importing &&
                    this.#subscriptions[id].importStartedAt &&
                    dayjs.utc().diff(dayjs.utc(this.#subscriptions[id].importStartedAt), "minute") > 4)
            ) {
                this.log.info(`Adding ${id} subscription...`);
                this.#subscriptions[id] = {
                    id,
                    exchange: this.#exchange,
                    asset,
                    currency,
                    status: ExwatcherStatus.pending,
                    importerId: this.#subscriptions[id]?.importerId || null,
                    importStartedAt: null,
                    error: null
                };

                const importerId = await this.importRecentCandles(this.#subscriptions[id]);
                if (importerId) {
                    this.#subscriptions[id].status = ExwatcherStatus.importing;
                    this.#subscriptions[id].importerId = importerId;
                    this.#subscriptions[id].importStartedAt = dayjs.utc().toISOString();
                    await this.saveSubscription(this.#subscriptions[id]);
                }
            }
        } catch (e) {
            this.log.error(e);
            throw e;
        }
    }

    async removeSubscription(asset: string, currency: string): Promise<void> {
        const id = this.createExwatcherId(asset, currency);
        try {
            if (this.#subscriptions[id]) {
                //TODO unwatch when implemented in ccxt.pro
                await this.deleteSubscription(id);
                delete this.#subscriptions[id];
                if (this.#candlesCurrent[id]) delete this.#candlesCurrent[id];
            }
        } catch (e) {
            this.log.error(e);
            throw e;
        }
    }

    async loadCandlesHistory(
        asset: string,
        currency: string,
        timeframe: ValidTimeframe,
        limit: number
    ): Promise<DBCandle[]> {
        try {
            const requiredCandles = await this.db.pg.many<DBCandle>(sql`
        SELECT time, timestamp, open, high, low, close
        FROM candles
        WHERE exchange = ${this.#exchange}
          AND asset = ${asset}
          AND currency = ${currency}
          AND timeframe = ${timeframe}
          AND timestamp <= ${dayjs.utc(Timeframe.getPrevSince(dayjs.utc().toISOString(), timeframe)).toISOString()}
        ORDER BY timestamp DESC
        LIMIT ${limit};`);
            return [...requiredCandles]
                .map((c) => ({ ...c, asset, currency, timeframe }))
                .sort((a, b) => sortAsc(a.time, b.time));
        } catch (err) {
            this.log.error("Failed to load history candles", err);
            throw err;
        }
    }

    async initCandlesHistory(subscription: Exwatcher) {
        const { id, asset, currency } = subscription;
        this.#candlesHistory[id] = {};
        await Promise.all(
            Timeframe.validArray.map(async (timeframe) => {
                this.#candlesHistory[id][timeframe] = await this.loadCandlesHistory(asset, currency, timeframe, 300);
            })
        );
    }

    async subscribe(subscription: Exwatcher) {
        this.log.debug(subscription);
        try {
            if (subscription) {
                const { id, status } = subscription;
                if (status !== ExwatcherStatus.subscribed) {
                    try {
                        this.#candlesCurrent[id] = {};
                        await this.subscribeCCXT(id);

                        this.#subscriptions[id].status = ExwatcherStatus.subscribed;
                        this.#subscriptions[id].importStartedAt = null;
                        this.#subscriptions[id].error = null;
                        this.log.info(`Subscribed ${id}`);

                        await this.saveSubscription(this.#subscriptions[id]);

                        await this.initCandlesHistory(this.#subscriptions[id]);
                        return true;
                    } catch (e) {
                        this.log.error(e);
                        this.#subscriptions[id].status = ExwatcherStatus.failed;
                        this.#subscriptions[id].importStartedAt = null;
                        this.#subscriptions[id].error = e.message;
                        await this.saveSubscription(this.#subscriptions[id]);
                    }
                }
            }
        } catch (err) {
            this.log.error(`Failed to subscribe ${subscription.id}`, err);
            await this.events.emit<ExwatcherErrorEvent>({
                type: ExwatcherEvents.ERROR,
                data: {
                    exchange: subscription?.exchange,
                    asset: subscription?.asset,
                    currency: subscription?.currency,
                    exwatcherId: subscription?.id,
                    timestamp: dayjs.utc().toISOString(),
                    error: `Failed to subscribe ${subscription?.id} - ${err.message}`
                }
            });
        }
        return false;
    }

    async subscribeCCXT(id: string) {
        this.log.debug(id);
        try {
            const symbol = this.getSymbol(this.#subscriptions[id].asset, this.#subscriptions[id].currency);
            if (["binance_futures"].includes(this.#exchange)) {
                for (const timeframe of Timeframe.validArray) {
                    await this.#connector.watchOHLCV(symbol, Timeframe.timeframes[timeframe].str);
                }
            } else if (["bitfinex", "kraken", "kucoin", "huobipro"].includes(this.#exchange)) {
                await this.#connector.watchTrades(symbol);
                await this.loadCurrentCandles(this.#subscriptions[id]);
            } else {
                throw new Error("Exchange is not supported");
            }
        } catch (err) {
            this.log.error(`CCXT Subscribe Error ${id}`, err);
            if (err instanceof ccxtpro.NetworkError) {
                await this.initConnector();
            }
            throw err;
        }
    }

    async importRecentCandles(subscription: Exwatcher): Promise<string> {
        const { exchange, asset, currency } = subscription;
        const id = subscription.importerId || uuid();
        await this.events.emit<ImporterRunnerStart>({
            type: ImporterRunnerEvents.START,
            data: {
                id,
                exchange,
                asset,
                currency,
                type: "recent"
            }
        });

        return id;
    }

    async loadCurrentCandles(subscription: Exwatcher): Promise<void> {
        try {
            const { id, exchange, asset, currency } = subscription;
            this.log.info(`Loading current candles ${id}`);
            if (!this.#candlesCurrent[id]) this.#candlesCurrent[id] = {};

            await Promise.all(
                Timeframe.validArray.map(async (timeframe) => {
                    const candle: ExchangeCandle = await this.#publicConnector.getCurrentCandle(
                        exchange,
                        asset,
                        currency,
                        timeframe
                    );

                    this.#candlesCurrent[id][timeframe] = {
                        ...candle
                    };
                    this.saveCandles([this.#candlesCurrent[id][timeframe]]);
                })
            );
        } catch (err) {
            this.log.error(`Failed to load current candles ${subscription.id}`, err);
            throw err;
        }
    }

    async saveSubscription(subscription: Exwatcher): Promise<void> {
        const { id, exchange, asset, currency, status, importerId, importStartedAt, error } = subscription;
        await this.db.pg.query(sql`INSERT INTO exwatchers 
        ( id, 
            exchange,
            asset,
            currency,
            status,
            importer_id, 
            import_started_at,
            error
          )  VALUES
       (
        ${id},
        ${exchange},
        ${asset},
        ${currency},
        ${status},
        ${importerId || null},
        ${importStartedAt || null},
        ${error || null}
        )
        ON CONFLICT ON CONSTRAINT exwatchers_pkey 
        DO UPDATE SET updated_at = now(),
        status = excluded.status,
        importer_id = excluded.importer_id,
        import_started_at = excluded.import_started_at,
        error = excluded.error;`);
    }

    async deleteSubscription(id: string): Promise<void> {
        await this.db.pg.query(sql`DELETE FROM exwatchers WHERE id = ${id}`);
    }

    // #endregion

    // #region Market handlers
    async handleCandles(): Promise<void> {
        try {
            if (this.lightship.isServerShuttingDown()) return;
            // Текущие дата и время - минус одна секунда
            const date = dayjs.utc().add(-1, "second").startOf("second");
            // Есть ли подходящие по времени таймфреймы
            const currentTimeframes = Timeframe.timeframesByDate(date.toISOString());
            const closedCandles: Map<string, ExchangeCandle> = new Map();

            await Promise.all(
                this.activeSubscriptions.map(async ({ id, asset, currency }: Exwatcher) => {
                    try {
                        const symbol = this.getSymbol(asset, currency);
                        const currentCandles: ExchangeCandle[] = [];

                        Timeframe.validArray.map((timeframe) => {
                            try {
                                if (this.#candlesCurrent[id] && this.#candlesCurrent[id][timeframe]) {
                                    const candleTime = dayjs
                                        .utc(Timeframe.validTimeframeDatePrev(date.toISOString(), timeframe))
                                        .valueOf();

                                    if (
                                        this.#connector.ohlcvs[symbol] &&
                                        this.#connector.ohlcvs[symbol][Timeframe.get(timeframe).str]
                                    ) {
                                        const candle: [number, number, number, number, number, number] =
                                            this.#connector.ohlcvs[symbol][Timeframe.get(timeframe).str].find(
                                                (c: any) => c[0] === candleTime
                                            );
                                        if (candle) {
                                            if (this.#candlesCurrent[id][timeframe].time != candleTime) {
                                                const prevCandle: [number, number, number, number, number, number] =
                                                    this.#connector.ohlcvs[symbol][Timeframe.get(timeframe).str].find(
                                                        (c: any) => c[0] === this.#candlesCurrent[id][timeframe].time
                                                    );
                                                if (prevCandle) {
                                                    this.#candlesCurrent[id][timeframe].open = prevCandle[1];
                                                    this.#candlesCurrent[id][timeframe].high = prevCandle[2];
                                                    this.#candlesCurrent[id][timeframe].low = prevCandle[3];
                                                    this.#candlesCurrent[id][timeframe].close = prevCandle[4];
                                                    this.#candlesCurrent[id][timeframe].volume = prevCandle[5];
                                                    this.#candlesCurrent[id][timeframe].type =
                                                        this.#candlesCurrent[id][timeframe].volume === 0
                                                            ? CandleType.previous
                                                            : CandleType.loaded;
                                                }
                                                const closedCandle = { ...this.#candlesCurrent[id][timeframe] };
                                                this.log.debug("Closing", closedCandle);
                                                closedCandles.set(`${id}.${timeframe}`, closedCandle);
                                                this.#candlesCurrent[id][timeframe].time = candle[0];
                                                this.#candlesCurrent[id][timeframe].timestamp = dayjs
                                                    .utc(candle[0])
                                                    .toISOString();
                                            }

                                            this.#candlesCurrent[id][timeframe].open = candle[1];
                                            this.#candlesCurrent[id][timeframe].high = candle[2];
                                            this.#candlesCurrent[id][timeframe].low = candle[3];
                                            this.#candlesCurrent[id][timeframe].close = candle[4];
                                            this.#candlesCurrent[id][timeframe].volume = candle[5];
                                            this.#candlesCurrent[id][timeframe].type =
                                                this.#candlesCurrent[id][timeframe].volume === 0
                                                    ? CandleType.previous
                                                    : CandleType.loaded;
                                        }
                                    }
                                } else {
                                    if (!this.#candlesCurrent[id]) this.#candlesCurrent[id] = {};
                                    const candles: [number, number, number, number, number, number][] =
                                        this.#connector.ohlcvs[symbol][Timeframe.get(timeframe).str].filter(
                                            (c: any) => c[0] < date.valueOf()
                                        );
                                    const candle = candles[candles.length - 1];
                                    if (candle) {
                                        this.#candlesCurrent[id][timeframe] = {
                                            exchange: this.#exchange,
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
                                if (this.#candlesCurrent[id][timeframe])
                                    currentCandles.push({ ...this.#candlesCurrent[id][timeframe] });
                            } catch (error) {
                                this.log.error(error);
                            }
                        });

                        let tick: ExchangePrice;
                        if (
                            this.#candlesCurrent[id][1440] &&
                            this.#lastTick[id] &&
                            this.#candlesCurrent[id][1440].close !== this.#lastTick[id].price
                        ) {
                            const { time, timestamp, close } = this.#candlesCurrent[id][1440];
                            tick = {
                                exchange: this.#exchange,
                                asset,
                                currency,
                                time,
                                timestamp,
                                price: close
                            };
                            this.#lastTick[id] = tick;
                        } else if (!this.#lastTick[id]) {
                            if (this.#candlesCurrent[id][1440]) {
                                const { time, timestamp, close } = this.#candlesCurrent[id][1440];
                                tick = {
                                    exchange: this.#exchange,
                                    asset,
                                    currency,
                                    time,
                                    timestamp,
                                    price: close
                                };
                                this.#lastTick[id] = tick;
                            }
                        }
                        if (currentCandles.length > 0 && tick) {
                            this.saveCandles(currentCandles);
                        }
                        /*  if (tick) {
                            this.publishTick(tick);
                        }*/
                    } catch (err) {
                        this.log.error(err);
                    }
                })
            );

            if (currentTimeframes.length > 0) {
                // Сброс текущих свечей
                currentTimeframes.forEach((timeframe) => {
                    this.activeSubscriptions.forEach(({ id }: Exwatcher) => {
                        if (
                            this.#candlesCurrent[id] &&
                            this.#candlesCurrent[id][timeframe] &&
                            !closedCandles.has(`${id}.${timeframe}`)
                        ) {
                            const candle = { ...this.#candlesCurrent[id][timeframe] };
                            closedCandles.set(`${id}.${timeframe}`, candle);
                            this.log.debug("Closing by current timeframe", candle);
                            const { close } = candle;
                            this.#candlesCurrent[id][timeframe].time = date.startOf("minute").valueOf();
                            this.#candlesCurrent[id][timeframe].timestamp = date.startOf("minute").toISOString();
                            this.#candlesCurrent[id][timeframe].high = close;
                            this.#candlesCurrent[id][timeframe].low = close;
                            this.#candlesCurrent[id][timeframe].open = close;
                            this.#candlesCurrent[id][timeframe].volume = 0;
                            this.#candlesCurrent[id][timeframe].type = CandleType.previous;
                        }
                    });
                });
            }

            if (closedCandles.size > 0) {
                const candles = [...closedCandles.values()];
                this.log.info(
                    `New candles\n${candles
                        .map(
                            ({ exchange, asset, currency, timeframe, timestamp }) =>
                                `${exchange}.${asset}.${currency}.${timeframe}.${timestamp}`
                        )
                        .join("\n")} `
                );
                this.saveCandles(candles);

                /*  await Promise.all(
                    candles.map(async (candle) => {
                        await this.publishCandle(candle);
                    })
                ); */
            }

            this.#lastDate = date.valueOf();
        } catch (e) {
            this.log.error(e);
        }
    }

    async handleTrades(): Promise<void> {
        try {
            if (this.lightship.isServerShuttingDown()) return;
            // Текущие дата и время - минус одна секунда
            const date = dayjs.utc().add(-1, "second").startOf("second");

            // Есть ли подходящие по времени таймфреймы
            const currentTimeframes = Timeframe.timeframesByDate(date.toISOString());
            const closedCandles: Map<string, ExchangeCandle> = new Map();

            await Promise.all(
                this.activeSubscriptions.map(async ({ id, asset, currency }: Exwatcher) => {
                    const symbol = this.getSymbol(asset, currency);

                    if (this.#connector.trades[symbol]) {
                        // Запрашиваем все прошедшие трейды
                        const trades: Trade[] = this.#connector.trades[symbol].filter(
                            ({ timestamp }: Trade) =>
                                timestamp < date.valueOf() && (!this.#lastDate || timestamp >= this.#lastDate)
                        );

                        // Если были трейды
                        if (trades.length > 0) {
                            // Если было изменение цены
                            let tick: ExchangePrice;
                            if (this.#lastTick[id]) {
                                const prices = trades
                                    .filter(({ timestamp }: Trade) => timestamp > this.#lastTick[id].time)
                                    .map((t) => t.price);
                                if (prices.length > 0 && prices.some((d) => d !== this.#lastTick[id].price)) {
                                    const { timestamp, price } = trades[trades.length - 1];
                                    tick = {
                                        exchange: this.#exchange,
                                        asset,
                                        currency,
                                        time: timestamp,
                                        timestamp: dayjs.utc(timestamp).toISOString(),
                                        price
                                    };
                                    this.#lastTick[id] = tick;
                                }
                            } else {
                                const { timestamp, price } = trades[trades.length - 1];
                                tick = {
                                    exchange: this.#exchange,
                                    asset,
                                    currency,
                                    time: timestamp,
                                    timestamp: dayjs.utc(timestamp).toISOString(),
                                    price
                                };
                                this.#lastTick[id] = tick;
                            }
                            const currentCandles: ExchangeCandle[] = [];
                            Timeframe.validArray.forEach((timeframe) => {
                                if (trades.length > 0) {
                                    const candleTime = dayjs
                                        .utc(Timeframe.validTimeframeDatePrev(date.toISOString(), timeframe))
                                        .valueOf();
                                    if (this.#candlesCurrent[id][timeframe].time !== candleTime) {
                                        const candle = { ...this.#candlesCurrent[id][timeframe] };
                                        closedCandles.set(`${id}.${timeframe}`, candle);
                                        const { close } = candle;
                                        this.#candlesCurrent[id][timeframe].time = candleTime;
                                        this.#candlesCurrent[id][timeframe].timestamp = dayjs
                                            .utc(candleTime)
                                            .toISOString();
                                        this.#candlesCurrent[id][timeframe].high = close;
                                        this.#candlesCurrent[id][timeframe].low = close;
                                        this.#candlesCurrent[id][timeframe].open = close;
                                        this.#candlesCurrent[id][timeframe].volume = 0;
                                        this.#candlesCurrent[id][timeframe].type = CandleType.previous;
                                    }
                                    const prices = trades.map((t) => +t.price);
                                    if (this.#candlesCurrent[id][timeframe].volume === 0)
                                        this.#candlesCurrent[id][timeframe].open = +trades[0].price;
                                    this.#candlesCurrent[id][timeframe].high = Math.max(
                                        this.#candlesCurrent[id][timeframe].high,
                                        ...prices
                                    );
                                    this.#candlesCurrent[id][timeframe].low = Math.min(
                                        this.#candlesCurrent[id][timeframe].low,
                                        ...prices
                                    );
                                    this.#candlesCurrent[id][timeframe].close = +trades[trades.length - 1].price;
                                    this.#candlesCurrent[id][timeframe].volume =
                                        this.#candlesCurrent[id][timeframe].volume +
                                            +trades.map((t) => t.amount).reduce((a, b) => a + b, 0) ||
                                        this.#candlesCurrent[id][timeframe].volume + 0;
                                    this.#candlesCurrent[id][timeframe].type =
                                        this.#candlesCurrent[id][timeframe].volume === 0
                                            ? CandleType.previous
                                            : CandleType.created;
                                    currentCandles.push({ ...this.#candlesCurrent[id][timeframe] });
                                }
                            });

                            if (currentCandles.length > 0 && tick) {
                                this.saveCandles(currentCandles);
                            }

                            /*  if (tick) {
                                this.publishTick(tick);
                            } */
                        }
                    }
                })
            );

            if (currentTimeframes.length > 0) {
                // Сброс текущих свечей
                currentTimeframes.forEach((timeframe) => {
                    this.activeSubscriptions.forEach(({ id }: Exwatcher) => {
                        if (
                            this.#candlesCurrent[id] &&
                            this.#candlesCurrent[id][timeframe] &&
                            !closedCandles.has(`${id}.${timeframe}`)
                        ) {
                            const candle = { ...this.#candlesCurrent[id][timeframe] };
                            closedCandles.set(`${id}.${timeframe}`, candle);
                            const { close } = this.#candlesCurrent[id][timeframe];
                            this.#candlesCurrent[id][timeframe].time = date.startOf("minute").valueOf();
                            this.#candlesCurrent[id][timeframe].timestamp = date.startOf("minute").toISOString();
                            this.#candlesCurrent[id][timeframe].high = close;
                            this.#candlesCurrent[id][timeframe].low = close;
                            this.#candlesCurrent[id][timeframe].open = close;
                            this.#candlesCurrent[id][timeframe].volume = 0;
                            this.#candlesCurrent[id][timeframe].type = CandleType.previous;
                        }
                    });
                });
            }

            if (closedCandles.size > 0) {
                const candles = [...closedCandles.values()];
                this.log.info(
                    `New candles\n${candles
                        .map(
                            ({ exchange, asset, currency, timeframe, timestamp }) =>
                                `${exchange}.${asset}.${currency}.${timeframe}.${timestamp}\n`
                        )
                        .join("\n")} `
                );
                this.saveCandles(candles);

                /*  await Promise.all(
                    candles.map(async (candle) => {
                        await this.publishCandle(candle);
                    })
                ); */
            }

            this.#lastDate = date.valueOf();
        } catch (e) {
            this.log.error(e);
        }
    }

    saveCandles(candles: ExchangeCandle[]) {
        for (const { ...props } of candles) {
            this.#candlesToSave.set(this.getCandleMapKey({ ...props }), { ...props });
            this.saveCandlesHistory({ ...props });
        }
    }

    saveCandlesHistory(candle: ExchangeCandle) {
        const id = this.createExwatcherId(candle.asset, candle.currency);

        if (!this.#candlesHistory[id] || !this.#candlesHistory[id][candle.timeframe]) return;

        const otherCandles = this.#candlesHistory[id][candle.timeframe].filter(({ time }) => time !== candle.time);

        this.#candlesHistory[id][candle.timeframe] = [...otherCandles, candle].slice(-301);
    }

    async handleCandlesToSave() {
        try {
            if (this.#candlesToSave.size > 0) {
                const candles = [...this.#candlesToSave.values()];
                this.log.debug(`Saving ${candles.length} candles`);
                try {
                    //  await Promise.all(candles.map((candle) => this.saveCandlesHistory(candle)));

                    await this.db.pg.query(sql`
                    insert into candles
                    (exchange, asset, currency, timeframe, open, high, low, close, volume, time, timestamp, type)
                    SELECT *
                    FROM ${sql.unnest(
                        this.db.util.prepareUnnest(candles, [
                            "exchange",
                            "asset",
                            "currency",
                            "timeframe",
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
                            "int8",
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
                    ON CONFLICT (timestamp, exchange, asset, currency, timeframe)
                    DO UPDATE SET open = excluded.open,
                    high = excluded.high,
                    low = excluded.low,
                    close = excluded.close,
                    volume = excluded.volume,
                    type = excluded.type;`);

                    candles.forEach((candle) => {
                        this.#candlesToSave.delete(this.getCandleMapKey(candle));
                    });
                } catch (e) {
                    this.log.error(e);
                }
            }
        } catch (error) {
            this.log.error(`Failed to save candles`, error);
        } finally {
            if (!this.lightship.isServerShuttingDown()) {
                this.#candlesSaveTimer = setTimeout(this.handleCandlesToSave.bind(this), 1000);
            }
        }
    }

    // #endregion

    // #region Robot

    async subscribeRobots(subscription: Exwatcher) {
        const market = subscription.id;
        const robots = await this.db.pg.any<RobotState>(sql`
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
        WHERE rs.robot_id = r.id AND exchange = ${this.#exchange}
        AND asset = ${subscription.asset}
        AND currency = ${subscription.currency}
        ;`);

        for (const robot of robots) {
            this.#robots[robot.id] = {
                robotState: createObjectBuffer(100000, {
                    state: robot,
                    candles: this.#candlesHistory[market][robot.timeframe]
                }),
                locked: false
            };
            this.#robots[robot.id].buffer = getUnderlyingArrayBuffer(this.#robots[robot.id].robotState);
        }
    }

    async getActiveRobotAlerts() {
        const currentDate = dayjs.utc().valueOf();
        const alerts = [];

        for (const { robotState } of Object.values(this.#robots)) {
            const { asset, currency, timeframe } = robotState.state;
            const { amountInUnit, unit } = Timeframe.get(timeframe);
            const positions = robotState.state.state.positions;
            for (const pos of positions) {
                for (const alert of Object.values(pos.alerts)) {
                    const activeFrom = dayjs.utc(alert.candleTimestamp).add(amountInUnit, unit);
                    const activeTo = dayjs
                        .utc(alert.candleTimestamp)
                        .add(amountInUnit * 2, unit)
                        .add(-1, "millisecond");
                    if (activeTo.valueOf() > currentDate) {
                        alerts.push({
                            ...alert,
                            id: uuid(),
                            robotId: robotState.state.id,
                            asset,
                            currency,
                            timeframe: +timeframe,
                            activeFrom: activeFrom.toISOString(),
                            activeTo: activeTo.toISOString()
                        });
                    }
                }
            }
        }
        for (const alert of alerts) {
            this.#robotAlerts[alert.id] = alert;
        }
    }

    /*async handleSignalAlertEvents(signal: Signal) {
        if (signal.exchange !== this.exchange || this.robotAlerts[signal.id]) return;
        const { amountInUnit, unit } = Timeframe.get(signal.timeframe);
        const activeFrom = dayjs.utc(signal.candleTimestamp).add(amountInUnit, unit);
        const activeTo = dayjs
            .utc(signal.candleTimestamp)
            .add(amountInUnit * 2, unit)
            .add(-1, "millisecond");
        const currentDate = dayjs.utc().valueOf();
        if (activeTo.valueOf() < currentDate) return;
        this.robotAlerts[signal.id] = {
            ...signal,
            activeFrom: activeFrom.toISOString(),
            activeTo: activeTo.toISOString()
        };
    }*/ //TODO: handle new alers

    get activeRobotAlerts() {
        const currentDate = dayjs.utc().valueOf();
        return Object.values(this.#robotAlerts).filter(
            ({ activeFrom, activeTo }) =>
                dayjs.utc(activeFrom).valueOf() < currentDate && dayjs.utc(activeTo).valueOf() > currentDate
        );
    }

    cleanOutdatedSignals() {
        const currentDate = dayjs.utc().valueOf();
        const alerts = Object.values(this.#robotAlerts)
            .filter(({ activeTo }) => dayjs.utc(activeTo).valueOf() < currentDate)
            .map((a) => a.id);
        for (const id of alerts) {
            delete this.#robotAlerts[id];
        }
    }

    async checkRobotAlerts() {
        const beacon = this.lightship.createBeacon();
        try {
            const results = await Promise.all(
                this.activeRobotAlerts.map(async (alert) => {
                    const { id, asset, robotId, currency, timeframe, orderType, action, price, activeFrom } = alert;
                    const exwatcherId = this.createExwatcherId(asset, currency);
                    if (this.#candlesCurrent[exwatcherId]) {
                        const candle = this.#candlesCurrent[exwatcherId][timeframe];
                        if (candle && candle.time === dayjs.utc(activeFrom).valueOf()) {
                            let nextPrice = null;
                            switch (orderType) {
                                case OrderType.stop: {
                                    nextPrice = RobotPosition.checkStop(action, price, candle);
                                    break;
                                }
                                case OrderType.limit: {
                                    nextPrice = RobotPosition.checkLimit(action, price, candle);
                                    break;
                                }
                                case OrderType.market: {
                                    nextPrice = RobotPosition.checkMarket(action, price, candle);
                                    break;
                                }
                                default:
                                    throw new Error(`Unknown order type ${orderType}`);
                            }
                            if (nextPrice) {
                                this.log.debug(
                                    `Alert #${alert.id} (${action} ${orderType} ${price} ${asset}/${currency}) - Triggered!`
                                );

                                if (this.#robots[robotId].locked) return null;
                                this.#robots[robotId].locked = true;
                                try {
                                    const robot = new Robot(this.#robots[robotId].robotState.state);
                                    robot.setStrategyState();
                                    const { success, error } = robot.handleCurrentCandle({
                                        ...candle,
                                        timeframe: robot.timeframe
                                    });

                                    if (success) {
                                        robot.checkAlerts();
                                    } else {
                                        this.log.error(error);
                                    }
                                    this.#robots[robotId].robotState.state = { ...robot.robotState };
                                    await this.db.pg.transaction(async (t) => {
                                        if (robot.positionsToSave.length)
                                            await this.#saveRobotPositions(t, robot.positionsToSave);

                                        if (robot.signalsToSave.length) {
                                            await this.#saveRobotSignals(
                                                t,
                                                robot.signalsToSave.map(({ data }) => data)
                                            );
                                        }

                                        await this.#saveRobotState(t, robot.robotState);
                                    });

                                    if (robot.eventsToSend.length)
                                        await Promise.all(
                                            robot.eventsToSend.map(async (event) => {
                                                await this.events.emit(event);
                                            })
                                        );

                                    if (robot.hasClosedPositions) {
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
                                } catch (err) {
                                    this.log.error(`Failed to check robot's #${robotId} alerts - ${err.message}`);
                                    return null;
                                } finally {
                                    this.#robots[robotId].locked = false;
                                }

                                return id;
                            }
                        }
                    }
                    return null;
                })
            );

            const totalAlertsCount = Object.keys(this.#robotAlerts).length;

            for (const id of results.filter((processed) => processed)) {
                delete this.#robotAlerts[id];
            }

            if (results.length < totalAlertsCount) {
                this.cleanOutdatedSignals();
            }
        } catch (error) {
            this.log.error(`Failed to check robot alerts`, error);
        } finally {
            await beacon.die();
            if (!this.lightship.isServerShuttingDown()) {
                this.#checkAlertsTimer = setTimeout(this.checkRobotAlerts.bind(this), 1000);
            }
        }
    }

    async runRobots() {
        const beacon = this.lightship.createBeacon();
        try {
            const currentDate = dayjs.utc().startOf("minute").toISOString();
            const currentTimeframes = Timeframe.timeframesByDate(currentDate);

            if (currentTimeframes.length) {
                this.log.info(`Handling new ${currentTimeframes.join(", ")} candles`);
                const robotIds = Object.values(this.#robots)
                    .filter((r) => currentTimeframes.includes(r.robotState.state.timeframe))
                    .map((r) => r.robotState.state.id);

                await Promise.all(
                    robotIds.map(async (robotId) => {
                        try {
                            while (this.#robots[robotId].locked) {
                                await sleep(200);
                            }
                            this.#robots[robotId].locked = true;
                            const { asset, currency, timeframe } = this.#robots[robotId].robotState.state;
                            const prevTime = Timeframe.getPrevSince(currentDate, timeframe);
                            const exwatcherId = this.createExwatcherId(asset, currency);
                            this.#robots[robotId].robotState.candles = this.#candlesHistory[exwatcherId][
                                timeframe
                            ].filter((c) => c.time <= prevTime);
                            //TODO: positionsToSave, alertsToSave, eventsToSend
                            this.#robots[robotId].buffer = await this.robotWorker(this.#robots[robotId].buffer);
                            this.#robots[robotId].robotState = loadObjectBuffer(this.#robots[robotId].buffer);
                        } catch (error) {
                        } finally {
                            this.#robots[robotId].locked = false;
                        }
                    })
                );
            }
        } catch (error) {
        } finally {
            await beacon.die();
        }
    }

    /*async candleJob() {
        try {
            const robotState = await this.#getRobotState("df0f7f1a-5408-46f1-907d-fe493ced899d");

            let data: any = { state: robotState, candles: [] };
            const dataSize = sizeof(data) * 8;
            this.log.debug(dataSize);

            const dataOBuff = createObjectBuffer<{ state: RobotState; candles: DBCandle[] }>(dataSize, data);

            let dataABuff: ArrayBuffer = getUnderlyingArrayBuffer(dataOBuff);

            const tracer = new Tracer();

            const runJobTransfer = tracer.start("Transfer");

            dataABuff = await this.robotWorker(dataABuff);

            // data = loadObjectBuffer(dataABuff);
            // this.log.warn(data.state.status);
            //const robot = new Robot(data.state);
            //robot._status = RobotStatus.paused;

            //data.state = { ...data.state, ...robot.robotState };

            dataOBuff.state.status = RobotStatus.paused;

            dataABuff = await this.robotWorker(dataABuff);

            data = loadObjectBuffer(dataABuff);
            this.log.warn(data.state.status);

            tracer.end(runJobTransfer);

            this.log.info(tracer.state);
        } catch (err) {
            this.log.error("Main thread error");
            this.log.error(err);
        }
    }*/

    async robotWorker(stateABuf: ArrayBuffer): Promise<any> {
        return await this.#pool.queue(async (worker: RobotWorker) => worker.runStrategy(Transfer(stateABuf)));
    }

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
    #saveRobotState = async (transaction: DatabaseTransactionConnectionType, state: RobotState) =>
        transaction.query(sql`
    UPDATE robots 
    SET state = ${JSON.stringify(state.state)}, 
    last_candle = ${JSON.stringify(state.lastCandle)}, 
    has_alerts = ${state.hasAlerts}
    WHERE id = ${state.id};
    `);
    // #endregion
}
