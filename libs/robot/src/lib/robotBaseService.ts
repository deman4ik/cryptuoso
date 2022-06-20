import { sleep, sortAsc } from "@cryptuoso/helpers";
import {
    ActiveAlert,
    CandleType,
    DBCandle,
    ExchangeCandle,
    ExchangePrice,
    OrderType,
    RobotPositionStatus,
    SignalEvent,
    SignalType,
    Timeframe,
    ValidTimeframe
} from "@cryptuoso/market";
import { sql } from "@cryptuoso/postgres";
import { v4 as uuid } from "uuid";
import retry from "async-retry";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { spawn, Pool, Worker as ThreadsWorker } from "threads";
import { RobotStateBuffer, RobotWorker } from "@cryptuoso/robot-thread";
import { Robot, RobotPosition } from "@cryptuoso/robot-state";
import { RobotPositionState, RobotState, RobotStatus } from "@cryptuoso/robot-types";
import { PublicConnector } from "@cryptuoso/ccxt-public";
import ccxtpro from "ccxt.pro";
import cron from "node-cron";
import dayjs from "@cryptuoso/dayjs";
import {
    TradeStatsRunnerEvents,
    TradeStatsRunnerPortfolioRobot,
    TradeStatsRunnerRobot
} from "@cryptuoso/trade-stats-events";
import { Exwatcher, ExwatcherStatus, Trade } from "./types";
import {
    getMarketsCheckEventName,
    getRobotsCheckEventName,
    getRobotStatusEventName,
    getRobotSubscribeEventName,
    RobotRunnerEvents,
    RobotRunnerSchema,
    RobotRunnerStatus,
    RobotServiceEvents,
    RobotServiceSchema,
    RobotWorkerError,
    RobotWorkerEvents,
    SignalEvents
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
import { DatabaseTransactionConnection } from "slonik";
import { BaseServiceError, BaseServiceEvents } from "@cryptuoso/events";
import { Tracer } from "@cryptuoso/logger";

export interface RobotBaseServiceConfig extends HTTPServiceConfig {
    exchange: string;
    userPortfolioId?: string;
}

export class RobotBaseService extends HTTPService {
    #exchange: string;
    #userPortfolioId: string;
    #pool: Pool<any>;
    #connector: any;
    #publicConnector: PublicConnector;
    #subscriptions: { [key: string]: Exwatcher } = {};
    #candlesCurrent: { [id: string]: { [timeframe: string]: ExchangeCandle } } = {};
    #candlesHistory: { [key: string]: { [timeframe: string]: DBCandle[] } } = {};
    #candlesToSave: Map<string, ExchangeCandle> = new Map();
    #candlesSaveTimer: NodeJS.Timer;
    #checkAlertsTimer: NodeJS.Timer;
    #checkSubsTimer: NodeJS.Timer;
    #watchTimer: NodeJS.Timer;
    #lastTick: { [key: string]: ExchangePrice } = {};
    #cronHandleChanges: cron.ScheduledTask;
    #cronRunRobots: cron.ScheduledTask = cron.schedule("0 */5 * * * *", this.runRobots.bind(this), {
        scheduled: false
    });
    #lastDate: number;
    #robotAlerts: {
        [key: string]: ActiveAlert;
    } = {};
    robots: {
        [id: string]: { robot: Robot; locked: boolean };
    } = {};
    #retryOptions = {
        retries: 10,
        minTimeout: 5000,
        maxTimeout: 30000,
        onRetry: (err: any, i: number) => {
            if (err) {
                this.log.warn(`Retry ${i} - ${err.message}`);
            }
        }
    };
    constructor(config: RobotBaseServiceConfig) {
        super(config);
        this.#exchange = config?.exchange || process.env.EXCHANGE;
        this.#userPortfolioId = config?.userPortfolioId || process.env.USER_PORTFOLIO_ID;
        this.#publicConnector = new PublicConnector();

        this.addOnStartHandler(this.onServiceStart);
        this.addOnStartedHandler(this.onServiceStarted);
        this.addOnStopHandler(this.onServiceStop);
    }

    // #region Start/Stop
    async onServiceStart() {
        if (!this.#userPortfolioId) {
            this.events.subscribe({
                [getRobotStatusEventName(this.#exchange)]: {
                    schema: RobotRunnerSchema[RobotRunnerEvents.STATUS],
                    handler: this.handleRobotStatus.bind(this)
                },
                [getRobotsCheckEventName(this.#exchange)]: {
                    handler: this.handleCheckSubscriptions.bind(this)
                },
                [getMarketsCheckEventName(this.#exchange)]: {
                    handler: this.resubscribe.bind(this)
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
                },
                [getRobotSubscribeEventName(this.#exchange)]: {
                    schema: RobotServiceSchema[RobotServiceEvents.SUBSCRIBE],
                    handler: this.addSubscription.bind(this)
                }
            });
        }
        this.#pool = await Pool(
            async () => await spawn<RobotWorker>(new ThreadsWorker("./worker"), { timeout: 60000 }),
            {
                name: "worker",
                concurrency: this.workerConcurrency,
                size: this.workerThreads
            }
        );
        await sleep(3000);
        await this.initConnector();
    }

    async onServiceStarted() {
        await this.startRobotService();
    }

    async startRobotService() {
        await this.resubscribe();
        this.#cronHandleChanges.start();
        await this.checkSubs();
        this.#cronRunRobots.start();
        await this.watch();
        if (this.isRobotService) this.#candlesSaveTimer = setTimeout(this.handleCandlesToSave.bind(this), 0);
        this.#checkAlertsTimer = setTimeout(this.checkRobotAlerts.bind(this), 0);
    }

    async onServiceStop() {
        try {
            this.#cronHandleChanges.stop();
            this.#cronRunRobots.stop();
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
        try {
            if ((status === "start" && !this.robots[robotId]) || status === "restart") {
                await this.subscribeRobot(robotId);
            } else if (status === "stop" && this.robots[robotId]) {
                while (this.robots[robotId].locked) {
                    await sleep(1000);
                }
                this.robots[robotId].locked = true;
                const alerts = Object.values(this.#robotAlerts)
                    .filter(({ robotId: alertRobotId }) => alertRobotId === robotId)
                    .map((a) => a.id);
                for (const id of alerts) {
                    delete this.#robotAlerts[id];
                }
                const robot = this.robots[robotId].robot;
                robot.stop();

                await this.db.pg.transaction(async (t) => {
                    await this.saveRobotState(t, robot.robotState);
                });

                await Promise.all(
                    robot.eventsToSend.map(async (event) => {
                        await this.events.emit(event);
                    })
                );

                robot.clearEvents();

                delete this.robots[robotId];
            }
        } catch (error) {
            this.log.error(`Failed to change robot's #${robotId} status - ${error.message}`);
            throw new error();
        }
    }

    async handleCheckSubscriptions() {
        await Promise.all(this.activeSubscriptions.map(async (sub) => this.subscribeRobots(sub)));
    }

    async handleImporterStatusEvent(event: ImporterWorkerFinished | ImporterWorkerFailed) {
        try {
            const { id: importerId, type, exchange, asset, currency, status } = event;
            if (exchange !== this.#exchange && type !== "recent") return;
            const subscription = Object.values(this.#subscriptions).find(
                (sub: Exwatcher) =>
                    sub.status !== ExwatcherStatus.subscribed &&
                    (sub.importerId === importerId || (sub.asset === asset && sub.currency === currency))
            );
            if (subscription && status === Status.finished) {
                this.log.info(`Importer ${importerId} ${asset}/${currency} finished!`);
                this.#subscriptions[subscription.id].status = ExwatcherStatus.imported;

                await this.saveSubscription(this.#subscriptions[subscription.id]);
            } else if (subscription && subscription.id && status === Status.failed) {
                const { error } = event as ImporterWorkerFailed;
                this.log.warn(`Importer ${importerId} ${asset}/${currency} failed!`, error);
                this.#subscriptions[subscription.id].status = ExwatcherStatus.failed;
                this.#subscriptions[subscription.id].importStartedAt = null;
                this.#subscriptions[subscription.id].error = error;
                await this.saveSubscription(this.#subscriptions[subscription.id]);
            } else {
                this.log.warn("Unknown Importer event", event);
            }
        } catch (err) {
            this.log.error(`Failed to handle importer status event ${err.message}`, event);
            this.log.error(err);
        }
    }
    // #endregion

    // #region getters and helpers

    get exchange() {
        return this.#exchange;
    }

    get userPortfolioId() {
        return this.#userPortfolioId;
    }

    get isRobotService() {
        return !this.#userPortfolioId;
    }

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
        return (
            Object.keys(this.#subscriptions).length &&
            this.activeSubscriptions.length === Object.keys(this.#subscriptions).length
        );
    }

    get candlesCurrent() {
        return this.#candlesCurrent;
    }

    // #endregion

    // #region exwatcher
    async initConnector() {
        if (this.#exchange === "binance_futures") {
            this.#connector = new ccxtpro.binance({
                enableRateLimit: true,
                newUpdates: false,
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
                newUpdates: false,
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
                newUpdates: false,
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
                newUpdates: false,
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
                newUpdates: false,
                //agent: createSocksProxyAgent(process.env.PROXY_ENDPOINT),
                options: { OHLCVLimit: 100, tradesLimit: 1000 }
            });
            if (!this.#cronHandleChanges)
                this.#cronHandleChanges = cron.schedule("* * * * * *", this.handleTrades.bind(this), {
                    scheduled: false
                });
        } else throw new Error("Unsupported exchange");
    }

    async checkSubs(): Promise<void> {
        try {
            const pendingSubscriptions = Object.values(this.#subscriptions).filter(
                ({ status, importStartedAt }) =>
                    [ExwatcherStatus.pending, ExwatcherStatus.unsubscribed, ExwatcherStatus.failed].includes(status) ||
                    (status === ExwatcherStatus.importing &&
                        importStartedAt &&
                        dayjs.utc().diff(dayjs.utc(importStartedAt), "minute") > 4)
            );
            this.log.debug(`Checking ${pendingSubscriptions.length} pending subscriptions`);
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
                                this.#subscriptions[subscription.id].status === ExwatcherStatus.imported;
                                await this.saveSubscription(subscription);
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

            const importedSubscriptions = Object.values(this.#subscriptions).filter(
                ({ status, importStartedAt }) =>
                    status === ExwatcherStatus.imported ||
                    (status === ExwatcherStatus.subscribing &&
                        importStartedAt &&
                        dayjs.utc().diff(dayjs.utc(importStartedAt), "minute") > 10)
            );
            this.log.debug(`Checking ${importedSubscriptions.length} imported subscriptions`);
            await Promise.all(
                importedSubscriptions.map(async (subscription: Exwatcher) => {
                    const exwatcherSubscribed = await this.subscribe(subscription);
                    if (exwatcherSubscribed) await this.subscribeRobots(subscription);
                })
            );
        } catch (e) {
            this.log.error(e);
        } finally {
            if (!this.lightship.isServerShuttingDown() && !this.allSubscriptionsIsActive) {
                this.#checkSubsTimer = setTimeout(this.checkSubs.bind(this), 5000);
            } else this.#checkSubsTimer = null;
        }
    }

    async watch(): Promise<void> {
        try {
            await Promise.all(
                this.activeSubscriptions.map(async ({ id, exchange, asset, currency }) => {
                    if (this.#subscriptions[id].locked) return;
                    this.#subscriptions[id].locked = true;
                    try {
                        const symbol = this.getSymbol(asset, currency);
                        if (this.#exchange === "binance_futures") {
                            await Promise.all(
                                Timeframe.validArray.map(async (timeframe) => {
                                    try {
                                        const call = async (bail: (e: Error) => void) => {
                                            try {
                                                return await this.#connector.watchOHLCV(
                                                    symbol,
                                                    Timeframe.timeframes[timeframe].str
                                                );
                                            } catch (e) {
                                                if (e instanceof ccxtpro.NetworkError) {
                                                    throw e;
                                                }
                                                bail(e);
                                            }
                                        };
                                        await retry(call, this.#retryOptions);
                                        await sleep(1000);
                                    } catch (e) {
                                        this.log.warn(e.message);
                                        if (
                                            !e.message?.includes("connection closed") &&
                                            !e.message.includes("timed out")
                                        )
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
                                        //  await this.initConnector();
                                    }
                                })
                            );
                        } else {
                            try {
                                const call = async (bail: (e: Error) => void) => {
                                    try {
                                        return await this.#connector.watchTrades(symbol);
                                    } catch (e) {
                                        if (e instanceof ccxtpro.NetworkError) {
                                            throw e;
                                        }
                                        bail(e);
                                    }
                                };
                                await retry(call, this.#retryOptions);
                                await sleep(1000);
                            } catch (e) {
                                this.log.warn(e.message);
                                if (!e.message?.includes("connection closed") && !e.message.includes("timed out"))
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
                                //  await this.initConnector();
                            }
                        }
                    } catch (e) {
                        this.log.error(e);
                    } finally {
                        this.#subscriptions[id].locked = false;
                    }
                })
            );
        } catch (e) {
            this.log.error(e);
        } finally {
            if (!this.lightship.isServerShuttingDown()) this.#watchTimer = setTimeout(this.watch.bind(this), 60000 * 5);
        }
    }

    async getExwatcherSubscriptions(): Promise<Exwatcher[]> {
        const subscriptions = await this.db.pg.any<Exwatcher>(
            sql`select * from exwatchers where exchange = ${this.#exchange}`
        );
        return [...subscriptions];
    }

    async resubscribe() {
        try {
            const subscriptions = await this.getExwatcherSubscriptions();

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

    async addSubscription({ asset, currency }: ExwatcherSubscribe): Promise<void> {
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
                    error: null,
                    locked: false
                };

                if (this.#subscriptions[id].status === ExwatcherStatus.pending && this.isRobotService) {
                    const importerId = await this.importRecentCandles(this.#subscriptions[id]);
                    if (importerId) {
                        this.#subscriptions[id].status = ExwatcherStatus.importing;
                        this.#subscriptions[id].importerId = importerId;
                        this.#subscriptions[id].importStartedAt = dayjs.utc().toISOString();
                        await this.saveSubscription(this.#subscriptions[id]);
                        if (!this.#checkSubsTimer) {
                            this.log.debug(`Starting checkSubs timer`);
                            this.#checkSubsTimer = setTimeout(this.checkSubs.bind(this), 5000);
                        }
                    }
                } else if (!this.isRobotService) {
                    const exwatcherSubscribed = await this.subscribe(this.#subscriptions[id]);
                    if (exwatcherSubscribed) {
                        this.#subscriptions[id].status = ExwatcherStatus.subscribed;
                        await this.subscribeRobots(this.#subscriptions[id]);
                    }
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
            this.log.error(`Failed to load history candles - ${asset}/${currency}/${timeframe}`, err);
            throw err;
        }
    }

    async initCandlesHistory(subscription: Exwatcher) {
        this.log.debug(`Initializing candles history for ${subscription.asset}/${subscription.currency}`);
        const { id, asset, currency } = subscription;
        this.#candlesHistory[id] = {};
        await Promise.all(
            Timeframe.validArray.map(async (timeframe) => {
                this.#candlesHistory[id][timeframe] = await this.loadCandlesHistory(asset, currency, timeframe, 300);
            })
        );
    }

    async subscribe(subscription: Exwatcher) {
        //this.log.debug(subscription);
        const { id, status } = subscription;
        try {
            if (this.#subscriptions[id].locked) return false;
            if (status === ExwatcherStatus.subscribed) return true;
            this.#subscriptions[id].locked = true;
            try {
                this.log.info(`Subscribing ${id}`);
                this.#subscriptions[id].status = ExwatcherStatus.subscribing;
                this.#candlesCurrent[id] = {};
                await this.subscribeCCXT(id);

                this.#subscriptions[id].status = ExwatcherStatus.subscribed;
                this.#subscriptions[id].importStartedAt = null;
                this.#subscriptions[id].error = null;

                await this.saveSubscription(this.#subscriptions[id]);

                await this.initCandlesHistory(this.#subscriptions[id]);
                this.log.info(
                    `Subscribed ${id} Total ${
                        Object.values(this.#subscriptions).filter(({ status }) => status === ExwatcherStatus.subscribed)
                            .length
                    }/${Object.keys(this.#subscriptions).length}`
                );
                return true;
            } catch (e) {
                // this.log.error(e);
                this.#subscriptions[id].status = ExwatcherStatus.failed;
                this.#subscriptions[id].importStartedAt = null;
                this.#subscriptions[id].error = e.message;
                await this.saveSubscription(this.#subscriptions[id]);
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
        } finally {
            this.#subscriptions[id].locked = false;
        }
        return false;
    }

    async subscribeCCXT(id: string) {
        // this.log.debug(id);

        try {
            const symbol = this.getSymbol(this.#subscriptions[id].asset, this.#subscriptions[id].currency);
            if (["binance_futures"].includes(this.#exchange)) {
                await Promise.all(
                    Timeframe.validArray.map(async (timeframe) => {
                        this.log.debug(`Watching OHLCV ${id}/${timeframe}`);
                        const call = async (bail: (e: Error) => void) => {
                            try {
                                return await this.#connector.watchOHLCV(symbol, Timeframe.timeframes[timeframe].str);
                            } catch (e) {
                                if (e instanceof ccxtpro.NetworkError) {
                                    throw e;
                                }
                                bail(e);
                            }
                        };
                        await retry(call, this.#retryOptions);
                        //await sleep(1000);
                        this.log.debug(`OHLCV watch started ${id}/${timeframe}`);
                    })
                );
            } else if (["bitfinex", "kraken", "kucoin", "huobipro"].includes(this.#exchange)) {
                const call = async (bail: (e: Error) => void) => {
                    try {
                        return await this.#connector.watchTrades(symbol);
                    } catch (e) {
                        if (e instanceof ccxtpro.NetworkError) {
                            throw e;
                        }
                        bail(e);
                    }
                };
                await retry(call, this.#retryOptions);
                await this.loadCurrentCandles(this.#subscriptions[id]);
            } else {
                throw new Error("Exchange is not supported");
            }
        } catch (err) {
            this.log.error(`CCXT Subscribe Error ${id} - ${err.message}`);
            /* if (err instanceof ccxtpro.NetworkError) {
                await this.initConnector();
            } */
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
                                        this.#connector.ohlcvs &&
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
                                                // this.log.debug("Closing", closedCandle);
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
                                        this.#connector.ohlcvs[symbol][Timeframe.get(timeframe).str]?.filter(
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
                            //  this.log.debug("Closing by current timeframe", candle);
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
                //this.log.debug(`Saving ${candles.length} candles`);
                try {
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

    lockRobot(robotId: string) {
        this.log.debug(`Locking robot #${robotId}`);
        if (this.robots[robotId]) {
            if (this.robots[robotId].locked) return false;
            this.robots[robotId].locked = true;
            return true;
        }
        return false;
    }

    unlockRobot(robotId: string) {
        this.log.debug(`Unlocking robot #${robotId}`);
        if (this.robots[robotId]) {
            if (!this.robots[robotId].locked) return false;
            this.robots[robotId].locked = false;
            return true;
        }
        return false;
    }

    async subscribeRobots(subscription: Exwatcher) {
        this.log.info(`Subscribing ${subscription.id} robots`);
        const existedRobotIds = Object.values(this.robots)
            .filter(
                ({ robot: { asset, currency } }) => asset === subscription.asset && currency === subscription.currency
            )
            .map(({ robot: { id } }) => id);
        const existedRobotsCondition = existedRobotIds.length
            ? sql`AND r.id not in (${sql.join(existedRobotIds, sql`, `)})`
            : sql``;
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
        WHERE rs.robot_id = r.id AND r.exchange = ${this.#exchange}
        AND r.asset = ${subscription.asset}
        AND r.currency = ${subscription.currency}
        AND r.status = 'started'
        ${existedRobotsCondition};`);

        if (robots && Array.isArray(robots) && robots.length) {
            await Promise.all(
                robots.map(async (robot) => {
                    if (!this.robots[robot.id]) {
                        await this.#subscribeRobot(robot);
                    }
                })
            );
        }
    }

    async subscribeRobot(robotId: string) {
        this.log.info(`Subscribing #${robotId} robot`);

        const robot = await this.db.pg.one<RobotState>(sql`
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
        WHERE rs.robot_id = r.id AND r.exchange = ${this.#exchange}
        AND r.id = ${robotId};`);

        if (!this.#subscriptions[this.createExwatcherId(robot.asset, robot.currency)])
            await this.addSubscription({ exchange: this.#exchange, asset: robot.asset, currency: robot.currency });

        await this.#subscribeRobot(robot);
    }

    #subscribeRobot = async (robot: RobotState) => {
        try {
            this.log.info(
                `Subscribing #${robot.id} ${robot.strategy}/${robot.asset}/${robot.currency}/${robot.timeframe} robot`
            );
            this.robots[robot.id] = {
                robot: new Robot(robot),
                locked: true
            };

            if (!this.robots[robot.id].robot.state.initialized) {
                this.robots[robot.id].robot.initStrategy();
                this.robots[robot.id].robot.initIndicators();
                await this.db.pg.query(sql`
                UPDATE robots 
                SET state = ${JSON.stringify(this.robots[robot.id].robot.state)}
                WHERE id = ${robot.id};
                `);
            }
            this.initActiveRobotAlerts(robot.id);
            if (this.robots[robot.id].robot.status !== RobotStatus.started) {
                this.robots[robot.id].robot.start();

                await Promise.all(
                    this.robots[robot.id].robot.eventsToSend.map(async (event) => {
                        await this.events.emit(event);
                    })
                );
                this.robots[robot.id].robot.clearEvents();
                await this.db.pg.query(sql`UPDATE robot SET status = 'started' WHERE id = ${robot.id}`);
            }
            this.robots[robot.id].locked = false;
            this.log.info(
                `Robot #${robot.id} is subscribed! Total started ${
                    Object.values(this.robots).filter(({ robot: { status } }) => status === RobotStatus.started).length
                }/${Object.keys(this.robots).length}`
            );
        } catch (err) {
            this.log.error(`Failed to subscribe #${robot.id} robot ${err.message}`);
            this.log.error(err);

            await this.events.emit<RobotWorkerError>({
                type: RobotWorkerEvents.ERROR,
                data: {
                    robotId: robot.id,
                    error: `Failed to subscribe #${robot.id} robot ${err.message}`
                }
            });
        }
    };

    async initActiveRobotAlerts(robotId: string) {
        const currentDate = dayjs.utc().valueOf();

        const robot = this.robots[robotId].robot;
        const { asset, currency, timeframe } = robot;
        const { amountInUnit, unit } = Timeframe.get(timeframe);
        const positions = robot.state.positions;

        //   this.log.info(`Cleaning robot's #${robotId} alerts`);
        const alerts = Object.values(this.#robotAlerts)
            .filter(({ robotId: alertRobotId }) => alertRobotId === robotId)
            .map((a) => a.id);
        for (const id of alerts) {
            delete this.#robotAlerts[id];
        }

        if (positions && Array.isArray(positions) && positions.length) {
            for (const pos of positions) {
                if (pos.alerts) {
                    for (const alert of Object.values(pos.alerts)) {
                        //  this.log.info(`Saving robot's #${robotId} alert`);
                        const activeFrom = dayjs.utc(alert.candleTimestamp).add(amountInUnit, unit);
                        const activeTo = dayjs
                            .utc(alert.candleTimestamp)
                            .add(amountInUnit * 2, unit)
                            .add(-1, "millisecond");
                        if (activeTo.valueOf() > currentDate) {
                            const id = uuid();
                            this.#robotAlerts[id] = {
                                ...alert,
                                id,
                                robotId: robot.id,
                                exchange: this.#exchange,
                                asset,
                                currency,
                                timeframe: +timeframe,
                                timestamp: dayjs.utc().toISOString(),
                                positionId: pos.id,
                                positionPrefix: pos.prefix,
                                positionCode: pos.code,
                                positionParentId: pos.parentId,
                                type: SignalType.alert,
                                activeFrom: activeFrom.toISOString(),
                                activeTo: activeTo.toISOString()
                            };
                        }
                    }
                }
            }
        }
    }

    get activeRobotAlerts() {
        const currentDate = dayjs.utc().valueOf();
        return Object.values(this.#robotAlerts).filter(
            ({ activeFrom, activeTo, robotId }) =>
                dayjs.utc(activeFrom).valueOf() < currentDate &&
                dayjs.utc(activeTo).valueOf() > currentDate &&
                this.robots[robotId] &&
                this.robots[robotId]?.robot?.status === RobotStatus.started
        );
    }

    cleanOutdatedAlerts() {
        const currentDate = dayjs.utc().valueOf();
        const alerts = Object.values(this.#robotAlerts)
            .filter(({ activeTo }) => dayjs.utc(activeTo).valueOf() < currentDate)
            .map((a) => a.id);
        for (const id of alerts) {
            delete this.#robotAlerts[id];
        }
    }

    async handleSignal(signal: SignalEvent) {
        return;
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

                                const locked = this.lockRobot(robotId);
                                if (!locked) return null;
                                if (this.robots[robotId].robot.status !== RobotStatus.started) return null;
                                const beacon = this.lightship.createBeacon();
                                //   this.log.debug(`Robot #${robotId} is LOCKED!`);
                                try {
                                    const robot = this.robots[robotId].robot;

                                    const { success, error } = robot.handleCurrentCandle({
                                        ...candle,
                                        timeframe: robot.timeframe
                                    });

                                    if (success) {
                                        robot.checkAlerts();
                                    } else {
                                        this.log.error(error);
                                    }

                                    if (this.isRobotService) {
                                        if (robot.eventsToSend.length)
                                            await Promise.all(
                                                robot.eventsToSend.map(async (event) => {
                                                    await this.events.emit(event);
                                                })
                                            );

                                        await this.db.pg.transaction(async (t) => {
                                            if (robot.positionsToSave.length)
                                                await this.#saveRobotPositions(t, robot.positionsToSave);

                                            if (robot.signalsToSave.length) {
                                                await this.#saveRobotSignals(
                                                    t,
                                                    robot.signalsToSave.map(({ data }) => data)
                                                );
                                            }

                                            await this.saveRobotState(t, robot.robotState);
                                        });

                                        if (robot.hasClosedPositions) {
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
                                    } else if (robot.hasTradesToSave) {
                                        await this.handleSignal(robot.tradesToSave[0]);
                                    }

                                    robot.clearEvents();
                                } catch (err) {
                                    const error = `Failed to check robot's #${robotId} alerts - ${err.message}`;
                                    this.log.error(error);
                                    await this.events.emit<RobotWorkerError>({
                                        type: RobotWorkerEvents.ERROR,
                                        data: {
                                            robotId,
                                            error
                                        }
                                    });
                                    return null;
                                } finally {
                                    this.unlockRobot(robotId);
                                    await beacon.die();
                                    // this.log.debug(`Robot #${robotId} is UNLOCKED!`);
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
                this.cleanOutdatedAlerts();
            }
        } catch (error) {
            this.log.error(`Failed to check robot alerts`, error);
            await this.events.emit<BaseServiceError>({
                type: BaseServiceEvents.ERROR,
                data: {
                    service: this.name,
                    error: `Failed to check robot alerts - ${error.message}`
                }
            });
        } finally {
            await beacon.die();
            if (!this.lightship.isServerShuttingDown()) {
                this.#checkAlertsTimer = setTimeout(this.checkRobotAlerts.bind(this), 1000);
            }
        }
    }

    async runRobots() {
        const beacon = this.lightship.createBeacon();
        const tracer = new Tracer();
        const trace = tracer.start("All jobs");
        try {
            const currentDate = dayjs.utc().startOf("minute").toISOString();
            const currentTimeframes = Timeframe.timeframesByDate(currentDate);

            if (currentTimeframes.length) {
                this.log.info(`Handling new ${currentTimeframes.join(", ")} candles`);
                const robotIds = Object.values(this.robots)
                    .filter(
                        ({ robot: { timeframe, status } }) =>
                            currentTimeframes.includes(timeframe) && status === RobotStatus.started
                    )
                    .map(({ robot: { id } }) => id);

                await Promise.all(
                    robotIds.map(async (robotId) => {
                        try {
                            while (this.robots[robotId].locked) {
                                await sleep(200);
                            }
                            this.lockRobot(robotId);

                            const robot = this.robots[robotId].robot;
                            const { asset, currency, timeframe } = robot;
                            const prevTime = Timeframe.getPrevSince(currentDate, timeframe);
                            const exwatcherId = this.createExwatcherId(asset, currency);

                            const robotState = await this.robotWorker({
                                state: robot.robotState,
                                candles: this.#candlesHistory[exwatcherId][timeframe].filter((c) => c.time <= prevTime)
                            });
                            const { state, positionsToSave, eventsToSend } = robotState;
                            this.robots[robotId].robot = new Robot(state);

                            if (this.isRobotService) {
                                if (eventsToSend && Array.isArray(eventsToSend) && eventsToSend.length) {
                                    await Promise.all(
                                        eventsToSend.map(async (event) => {
                                            await this.events.emit(event);
                                        })
                                    );
                                }
                            }
                            await this.db.pg.transaction(async (t) => {
                                if (this.isRobotService) {
                                    if (positionsToSave && Array.isArray(positionsToSave) && positionsToSave.length)
                                        await this.#saveRobotPositions(t, positionsToSave);

                                    const signals = eventsToSend?.filter(({ type }) =>
                                        [SignalEvents.ALERT, SignalEvents.TRADE].includes(type as SignalEvents)
                                    );
                                    if (signals && signals.length) {
                                        await this.#saveRobotSignals(
                                            t,
                                            signals.map(({ data }) => data)
                                        );
                                    }
                                }
                                await this.saveRobotState(t, state);
                            });

                            // this.log.info(`Cleaning robot's #${robotId} alerts`);
                            const alerts = Object.values(this.#robotAlerts)
                                .filter(({ robotId: alertRobotId }) => alertRobotId === robotId)
                                .map((a) => a.id);
                            for (const id of alerts) {
                                delete this.#robotAlerts[id];
                            }

                            const alertsToSave = eventsToSend?.filter(({ type }) => type === SignalEvents.ALERT);

                            const { amountInUnit, unit } = Timeframe.get(state.timeframe);
                            for (const { data } of alertsToSave as { data: SignalEvent }[]) {
                                //  this.log.info(`Saving robot's #${robotId} alert`);

                                this.#robotAlerts[data.id] = {
                                    ...data,
                                    activeFrom: dayjs.utc(data.candleTimestamp).add(amountInUnit, unit).toISOString(),
                                    activeTo: dayjs
                                        .utc(data.candleTimestamp)
                                        .add(amountInUnit * 2, unit)
                                        .add(-1, "millisecond")
                                        .toISOString()
                                };
                            }

                            if (
                                this.isRobotService &&
                                positionsToSave &&
                                Array.isArray(positionsToSave) &&
                                positionsToSave.filter(({ status }) => status === RobotPositionStatus.closed).length > 0
                            ) {
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
                            const error = `Failed to run robot's #${robotId} strategy - ${err.message}`;
                            this.log.error(error);
                            this.log.error(err);
                            await this.events.emit<RobotWorkerError>({
                                type: RobotWorkerEvents.ERROR,
                                data: {
                                    robotId,
                                    error
                                }
                            });
                        } finally {
                            this.unlockRobot(robotId);
                        }
                    })
                );
            }
        } catch (error) {
            this.log.error(error, "Failed to run robots");
            await this.events.emit<BaseServiceError>({
                type: BaseServiceEvents.ERROR,
                data: {
                    service: this.name,
                    error: `Failed to run robots - ${error.message}`
                }
            });
        } finally {
            await beacon.die();
            tracer.end(trace);
        }
    }

    async robotWorker(robotState: RobotStateBuffer): Promise<RobotStateBuffer> {
        return await this.#pool.queue(async (worker: RobotWorker) => worker.runStrategy(robotState));
    }

    #saveRobotPositions = async (transaction: DatabaseTransactionConnection, positions: RobotPositionState[]) => {
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

    #saveRobotSignals = async (transaction: DatabaseTransactionConnection, signals: SignalEvent[]) => {
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
    async saveRobotState(transaction: DatabaseTransactionConnection, state: RobotState) {
        transaction.query(sql`
    UPDATE robots 
    SET state = ${JSON.stringify(state.state)}, 
    last_candle = ${JSON.stringify(state.lastCandle)}, 
    has_alerts = ${state.hasAlerts}
    WHERE id = ${state.id};
    `);
    }
    // #endregion
}
