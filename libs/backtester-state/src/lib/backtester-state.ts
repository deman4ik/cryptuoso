import { RobotSettings, RobotStats, RobotEquity, Robot, StrategyCode } from "@cryptuoso/robot-state";
import { ValidTimeframe, Candle } from "@cryptuoso/market";
import dayjs from "@cryptuoso/dayjs";
import { round, defaultValue } from "@cryptuoso/helpers";
import logger from "@cryptuoso/logger";
import { IndicatorCode } from "@cryptuoso/robot-indicators";

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
    strategyName: string;
    dateFrom: string;
    dateTo: string;
    settings: BacktesterSettings;
    totalBars?: number;
    processedBars?: number;
    leftBars?: number;
    completedPercent?: number;
    status: Status;
    startedAt?: string;
    finishedAt?: string;
    statistics?: { [key: string]: RobotStats };
    equity?: { [key: string]: RobotEquity };
    robotSettings?: { [key: string]: RobotSettings };
    robotInstances?: { [key: string]: Robot };
    error?: string;
}

export class Backtester {
    #id: string;
    #robotId: string;
    #exchange: string;
    #asset: string;
    #currency: string;
    #timeframe: ValidTimeframe;
    #strategyName: string;
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
    #statistics?: { [key: string]: RobotStats };
    #equity?: { [key: string]: RobotEquity };
    #robotSettings?: { [key: string]: RobotSettings };
    #robotInstances?: { [key: string]: Robot } = {};
    #error?: string;

    constructor(state: BacktesterState) {
        this.#id = state.id;
        this.#robotId = state.robotId;
        this.#exchange = state.exchange;
        this.#asset = state.asset;
        this.#currency = state.currency;
        this.#timeframe = state.timeframe;
        this.#strategyName = state.strategyName;
        this.#dateFrom = state.dateFrom;
        this.#dateTo = state.dateTo;
        this.#settings = {
            local: defaultValue(state.settings.local, false),
            populateHistory: defaultValue(state.settings.populateHistory, false),
            savePositions: defaultValue(state.settings.savePositions, true),
            saveLogs: defaultValue(state.settings.saveLogs, false)
        };
        this.#robotSettings = state.robotSettings;
        this.#totalBars = defaultValue(state.totalBars, 0);
        this.#processedBars = defaultValue(state.processedBars, 0);
        this.#leftBars = defaultValue(state.leftBars, this.#totalBars);
        this.#completedPercent = defaultValue(state.completedPercent, 0);
        this.#status = state.status;
        this.#startedAt = state.startedAt || null;
        this.#finishedAt = state.finishedAt || null;
        this.#statistics = state.statistics;
        this.#equity = state.equity;
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
            strategyName: this.#strategyName,
            dateFrom: this.#dateFrom,
            dateTo: this.#dateTo,
            settings: this.#settings,
            robotSettings: this.#robotSettings,
            totalBars: this.#totalBars,
            processedBars: this.#processedBars,
            leftBars: this.#leftBars,
            completedPercent: this.#completedPercent,
            status: this.#status,
            startedAt: this.#startedAt,
            finishedAt: this.#finishedAt,
            statistics: this.#statistics,
            equity: this.#equity,
            error: this.#error
        };
    }

    get id() {
        return this.#id;
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

    get strategyName() {
        return this.#strategyName;
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

    start() {
        this.#status = Status.started;
        this.#startedAt = this.#startedAt ? this.#startedAt : dayjs.utc().toISOString();
    }

    set startedAt(date: string) {
        this.#startedAt = dayjs.utc(date).toISOString();
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
                `Importer #${this.#id} - Processed ${this.#processedBars}, left ${this.#leftBars} - ${
                    this.#completedPercent
                }%`
            );
        }
    }

    get settings() {
        return this.#settings;
    }

    get statistics() {
        return this.#statistics;
    }

    set statistics(statistics) {
        this.#statistics = statistics;
    }

    get equity() {
        return this.#equity;
    }

    set equity(equity) {
        this.#equity = equity;
    }

    get robotSettings() {
        return this.#robotSettings;
    }

    set robotSettings(robotSettings) {
        this.#robotSettings = robotSettings;
    }

    get robotIds() {
        return Object.keys(this.#robotInstances);
    }

    get robotInstances() {
        return this.#robotSettings;
    }

    get robotInstancesArray() {
        return Object.values(this.#robotInstances);
    }

    initRobots(strategyCode: StrategyCode) {
        for (const [id, settings] of Object.entries(this.#robotSettings)) {
            this.#robotInstances[id] = new Robot({
                id,
                exchange: this.#exchange,
                asset: this.#asset,
                currency: this.#currency,
                timeframe: this.#timeframe,
                strategyName: this.#strategyName,
                settings,
                backtest: true
            });
            this.#robotInstances[id].setStrategy(strategyCode);
            this.#robotInstances[id].initStrategy();
        }
    }

    initIndicators(indicatorsCode: { fileName: string; code: IndicatorCode }[]) {
        Object.keys(this.#robotInstances).forEach(([id]) => {
            this.#robotInstances[id].setBaseIndicatorsCode(indicatorsCode);
            this.#robotInstances[id].setIndicators();
            this.#robotInstances[id].initIndicators();
        });
    }

    handleHistoryCandles(candles: Candle[]) {
        Object.keys(this.#robotInstances).forEach(([id]) => {
            this.#robotInstances[id].handleHistoryCandles(candles);
        });
    }

    finish(cancel = false) {
        this.#finishedAt = dayjs.utc().toISOString();
        if (this.status === Status.failed) return;
        if (cancel) {
            this.#status = Status.canceled;
            return;
        }
        if (this.isProcessed) {
            this.#status = Status.finished;
        }
    }

    fail(error: string) {
        this.#status = Status.failed;
        this.#error = error;
    }
}
