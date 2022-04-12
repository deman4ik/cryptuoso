import { Robot } from "@cryptuoso/robot-state";
import { ValidTimeframe, Candle, SignalEvent, DBCandle } from "@cryptuoso/market";
import dayjs from "@cryptuoso/dayjs";
import { round, nvl } from "@cryptuoso/helpers";
import logger from "@cryptuoso/logger";

import { RobotSettings, StrategySettings } from "@cryptuoso/robot-settings";
import { TradeStatsCalc } from "@cryptuoso/trade-stats";
import { RobotPositionState, StrategyProps } from "@cryptuoso/robot-types";

export const enum Status {
    queued = "queued",
    started = "started",
    finished = "finished",
    failed = "failed",
    stopping = "stopping",
    canceled = "canceled"
}

export interface BacktesterSettings {
    local?: boolean;
    populateHistory?: boolean;
    saveSignals?: boolean;
    savePositions?: boolean;
    saveLogs?: boolean;
}

export interface BacktesterState {
    id: string;
    robotId: string;
    exchange: string;
    asset: string;
    currency: string;
    timeframe: ValidTimeframe;
    strategy: string;
    dateFrom: string;
    dateTo: string;
    settings: BacktesterSettings;
    totalBars?: number;
    processedBars?: number;
    leftBars?: number;
    prevPercent?: number;
    completedPercent?: number;
    status: Status;
    startedAt?: string;
    finishedAt?: string;
    robotState?: StrategyProps;
    robots?: {
        [key: string]: {
            instance?: Robot;
            strategySettings: StrategySettings;
            robotSettings: RobotSettings;
            data?: {
                logs: BacktesterLogs[];
                alerts: BacktesterSignals[];
                trades: BacktesterSignals[];
                positions: { [key: string]: BacktesterPositionState };
            };
        };
    };
    error?: string;
}

export interface BacktesterSignals extends SignalEvent {
    backtestId: string;
}

export interface BacktesterPositionState extends RobotPositionState {
    backtestId: string;
}

export interface BacktesterLogs {
    [key: string]: any;
    candle: DBCandle;
    robotId: string;
    backtestId: string;
}

export class Backtester {
    #id: string;
    #robotId: string;
    #exchange: string;
    #asset: string;
    #currency: string;
    #timeframe: ValidTimeframe;
    #strategy: string;
    #feeRate: number;
    #dateFrom: string;
    #dateTo: string;
    #settings?: BacktesterSettings;
    #totalBars?: number;
    #processedBars?: number;
    #leftBars?: number;
    #completedPercent?: number;
    #prevPercent = 0;
    #status: Status;
    #startedAt?: string;
    #finishedAt?: string;
    #robotState?: StrategyProps;
    #robots: BacktesterState["robots"] = {};
    #error?: string;

    constructor(state: BacktesterState) {
        this.#id = state.id;
        this.#robotId = state.robotId;
        this.#exchange = state.exchange;
        this.#asset = state.asset;
        this.#currency = state.currency;
        this.#timeframe = state.timeframe;
        this.#strategy = state.strategy;
        this.#dateFrom = state.dateFrom;
        this.#dateTo = state.dateTo;
        this.#settings = {
            local: nvl(state.settings?.local, false),
            populateHistory: nvl(state.settings?.populateHistory, false),
            saveSignals: nvl(state.settings?.saveSignals, true),
            savePositions: nvl(state.settings?.savePositions, true),
            saveLogs: nvl(state.settings?.saveLogs, false)
        };
        this.#robots = state.robots;
        this.#totalBars = nvl(state.totalBars, 0);
        this.#processedBars = nvl(state.processedBars, 0);
        this.#leftBars = nvl(state.leftBars, this.#totalBars);
        this.#completedPercent = nvl(state.completedPercent, 0);
        this.#status = state.status;
        this.#startedAt = state.startedAt || null;
        this.#finishedAt = state.finishedAt || null;
        this.#robotState = state.robotState || null;
        this.#error = state.error || null;
    }

    get state(): BacktesterState {
        return {
            id: this.#id,
            robotId: this.#robotId,
            exchange: this.#exchange,
            asset: this.#asset,
            currency: this.#currency,
            timeframe: this.#timeframe,
            strategy: this.#strategy,
            dateFrom: this.#dateFrom,
            dateTo: this.#dateTo,
            settings: this.#settings,
            totalBars: this.#totalBars || 0,
            processedBars: this.#processedBars || 0,
            leftBars: this.#leftBars || 0,
            prevPercent: this.#prevPercent || 0,
            completedPercent: this.#completedPercent || 0,
            robots: this.allRobotsSettings,
            status: this.#status,
            startedAt: this.#startedAt,
            finishedAt: this.#finishedAt,
            robotState: this.#robotState,
            error: this.#error
        };
    }

    get completedPercent() {
        return this.#completedPercent;
    }

    get allRobotsSettings() {
        const robots: BacktesterState["robots"] = {};
        for (const [id, { robotSettings, strategySettings }] of Object.entries(this.#robots)) {
            robots[id] = { robotSettings, strategySettings };
        }

        return robots;
    }

    get id() {
        return this.#id;
    }

    get robotId() {
        return this.#robotId;
    }

    get exchange() {
        return this.#exchange;
    }

    get asset() {
        return this.#asset;
    }

    get currency() {
        return this.#currency;
    }

    get timeframe() {
        return this.#timeframe;
    }

    get strategy() {
        return this.#strategy;
    }

    get dateFrom() {
        return this.#dateFrom;
    }

    get dateTo() {
        return this.#dateTo;
    }

    get status() {
        return this.#status;
    }

    set status(status: Status) {
        this.#status = status;
    }

    get isStarted() {
        return this.#status === Status.started;
    }

    set feeRate(feeRate: number) {
        this.#feeRate = feeRate;
    }

    start() {
        this.#status = Status.started;
        this.#startedAt = this.#startedAt || dayjs.utc().toISOString();
    }

    get startedAt() {
        return this.#startedAt;
    }

    set startedAt(date: string) {
        this.#startedAt = dayjs.utc(date).toISOString();
    }

    get finishedAt() {
        return this.#finishedAt;
    }

    set finishedAt(date: string) {
        this.#finishedAt = dayjs.utc(date).toISOString();
    }

    get isFailed() {
        return this.#status === Status.failed;
    }

    get isFinished() {
        return this.#status === Status.finished || this.#status === Status.canceled;
    }

    get error() {
        return this.#error;
    }

    set error(message: string) {
        this.#error = message;
    }

    get isProcessed() {
        return this.#processedBars === this.#totalBars;
    }

    get progress() {
        return this.#processedBars;
    }

    init(totalBars: number) {
        this.#totalBars = totalBars;
        this.#leftBars = totalBars;
        this.#processedBars = 0;
        this.#completedPercent = 0;
    }

    incrementProgress() {
        this.#processedBars += 1;
        this.#leftBars = this.#totalBars - this.#processedBars;
        this.#completedPercent = round((this.#processedBars / this.#totalBars) * 100);
        if (this.#completedPercent > this.#prevPercent) {
            this.#prevPercent = this.#completedPercent;
            logger.info(
                `Backtester #${this.#id} - Processed ${this.#processedBars}, left ${this.#leftBars} - ${
                    this.#completedPercent
                }%`
            );
            return true;
        }
        return false;
    }

    get settings() {
        return this.#settings;
    }

    get robotState() {
        return this.#robotState;
    }

    get robotIds() {
        return Object.keys(this.#robots);
    }

    get robots() {
        return this.#robots;
    }

    get robotInstancesArray() {
        return Object.values(this.#robots).map(({ instance }) => instance);
    }

    initRobots() {
        for (const [id, robot] of Object.entries(this.#robots)) {
            try {
                logger.debug(`Backtester #${this.#id} - Initializing robot #${id}`);
                this.#robots[id].instance = new Robot({
                    id,
                    exchange: this.#exchange,
                    asset: this.#asset,
                    currency: this.#currency,
                    timeframe: this.#timeframe,
                    strategy: this.#strategy,
                    settings: {
                        strategySettings: robot.strategySettings,
                        robotSettings: robot.robotSettings,
                        activeFrom: this.#dateFrom,
                        feeRate: this.#feeRate
                    },
                    backtest: true
                });
                this.#robots[id].data = {
                    logs: [],
                    alerts: [],
                    trades: [],
                    positions: {}
                };
                this.#robots[id].instance.initStrategy();
            } catch (err) {
                logger.error(`Backtester #${this.#id} - Failed to init robot #${id}`, err);
                throw err;
            }
        }
    }

    initIndicators() {
        Object.keys(this.#robots).forEach((id) => {
            try {
                logger.debug(`Backtester #${this.#id} - Initializing robot's #${id} indicators`);

                this.#robots[id].instance.initIndicators();
            } catch (err) {
                logger.error(`Backtester #${this.#id} - Failed to init robot's #${id} indicators`, err);
                throw err;
            }
        });
    }

    handleHistoryCandles(candles: Candle[]) {
        Object.keys(this.#robots).forEach((id) => {
            this.#robots[id].instance.handleHistoryCandles(candles);
        });
    }

    #saveLogs = (id: string) => {
        if (this.#settings.saveLogs) {
            const robot = this.#robots[id];
            robot.data.logs = [
                ...robot.data.logs,
                ...robot.instance.logEventsToSend.map(({ data }) => ({
                    ...data,
                    backtestId: this.#id
                }))
            ];
        }
    };

    #saveSignals = (id: string) => {
        if (this.#settings.saveSignals || this.#settings.populateHistory) {
            const robot = this.#robots[id];
            robot.data.alerts = [
                ...robot.data.alerts,
                ...robot.instance.alertEventsToSend.map(({ data }) => ({
                    ...data,
                    robotId: id,
                    backtestId: this.#id
                }))
            ];
            robot.data.trades = [
                ...robot.data.trades,
                ...robot.instance.tradeEventsToSend.map(({ data }) => ({
                    ...data,
                    robotId: id,
                    backtestId: this.#id
                }))
            ];
        }
    };

    #savePositions = (id: string) => {
        const robot = this.#robots[id];
        robot.instance.positionsToSave.forEach((pos) => {
            robot.data.positions[pos.id] = { ...pos, backtestId: this.#id };
        });
    };

    async handleCandle(candle: Candle) {
        logger.info(`Backtester #${this.id} - Handling ${this.#processedBars + 1} bar of ${this.#totalBars}`);

        const robots = Object.keys(this.#robots);
        for (const id of robots) {
            const robot = this.#robots[id];
            robot.instance.handleCandle(candle);

            robot.instance.clearEvents();
            robot.instance.checkAlerts();
            //await robot.instance.calcStats();
            this.#saveLogs(id);
            this.#saveSignals(id);
            this.#savePositions(id);
            robot.instance.clearEvents();
            await robot.instance.calcIndicators();
            robot.instance.runStrategy();
            robot.instance.finalize();
            //await robot.instance.calcStats();
            this.#saveLogs(id);
            this.#saveSignals(id);
            this.#savePositions(id);
        }
    }

    async calcStats() {
        logger.info(`Backtester #${this.id} - Calculating stats`);
        const robots = Object.keys(this.#robots);
        for (const id of robots) {
            const robot = this.#robots[id];
            if (robot.data.positions.length) {
                const tradeStatsCalc = new TradeStatsCalc(
                    Object.values(robot.data.positions).filter(({ status }) => status === "closed"),
                    {
                        job: {
                            type: "robot",
                            robotId: id,
                            recalc: false,
                            SMAWindow: robot.instance._settings.robotSettings.SMAWindow,
                            margin: robot.instance._settings.robotSettings.margin
                        },
                        initialBalance: robot.instance._settings.robotSettings.initialBalance
                    }
                );
                robot.instance._emulatedStats = await tradeStatsCalc.calculate();
                robot.instance._stats = robot.instance._emulatedStats;
            }
        }
    }

    finish(cancel = false) {
        this.#finishedAt = dayjs.utc().toISOString();
        if (this.status === Status.failed) return;
        if (cancel) {
            this.#status = Status.canceled;
            return;
        }
        if (this.isProcessed) {
            if (this.settings.populateHistory) this.#robotState = this.#robots[this.#robotId]?.instance?.state;
            this.#status = Status.finished;
        }
    }

    fail(error: string) {
        this.#status = Status.failed;
        this.#error = error;
    }
}
