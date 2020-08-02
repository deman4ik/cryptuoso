import { RobotSettings, RobotStats, RobotEquity, StrategyProps } from "@cryptuoso/robot-state";
import { ValidTimeframe } from "@cryptuoso/market";
import { IndicatorState } from "@cryptuoso/robot-indicators";
import dayjs from "@cryptuoso/dayjs";
import { round, defaultValue } from "@cryptuoso/helpers";
import logger from "@cryptuoso/logger";

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
    robotSettings: RobotSettings;
    totalBars?: number;
    processedBars?: number;
    leftBars?: number;
    completedPercent?: number;
    status: Status;
    startedAt?: string;
    finishedAt?: string;
    statistics?: RobotStats;
    equity?: RobotEquity;
    robotState?: StrategyProps;
    robotIndicators?: { [key: string]: IndicatorState };
    error?: string;
}

export class Backtester {
    _id: string;
    _robotId: string;
    _exchange: string;
    _asset: string;
    _currency: string;
    _timeframe: ValidTimeframe;
    _strategyName: string;
    _dateFrom: string;
    _dateTo: string;
    _settings?: BacktesterSettings;
    _robotSettings?: RobotSettings;
    _totalBars?: number;
    _processedBars?: number;
    _leftBars?: number;
    _completedPercent?: number;
    _prevPercent = 0;
    _status: Status;
    _startedAt?: string;
    _finishedAt?: string;
    _statistics?: RobotStats;
    _equity?: RobotEquity;
    _robotState?: StrategyProps;
    _robotIndicators?: { [key: string]: IndicatorState };
    _error?: string;

    constructor(state: BacktesterState) {
        this._id = state.id;
        this._exchange = state.exchange;
        this._asset = state.asset;
        this._currency = state.currency;
        this._timeframe = state.timeframe;
        this._dateFrom = state.dateFrom;
        this._dateTo = state.dateTo;
        this._settings = {
            local: defaultValue(state.settings.local, false),
            populateHistory: defaultValue(state.settings.populateHistory, false),
            savePositions: defaultValue(state.settings.savePositions, true),
            saveLogs: defaultValue(state.settings.saveLogs, false)
        };
        this._robotSettings = state.robotSettings;
        this._totalBars = state.totalBars;
        this._processedBars = state.processedBars || 0;
        this._leftBars = state.leftBars || state.totalBars;
        this._completedPercent = state.completedPercent || 0;
        this._status = state.status;
        this._startedAt = state.startedAt;
        this._finishedAt = state.finishedAt;
        this._statistics = state.statistics;
        this._equity = state.equity;
        this._robotState = state.robotState;
        this._robotIndicators = state.robotIndicators;
        this._error = state.error;
    }

    get state(): BacktesterState {
        return {
            id: this._id,
            robotId: this._robotId,
            exchange: this._exchange,
            asset: this._asset,
            currency: this._currency,
            timeframe: this._timeframe,
            strategyName: this._strategyName,
            dateFrom: this._dateFrom,
            dateTo: this._dateTo,
            settings: this._settings,
            robotSettings: this._robotSettings,
            totalBars: this._totalBars,
            processedBars: this._processedBars,
            leftBars: this._leftBars,
            completedPercent: this._completedPercent,
            status: this._status,
            startedAt: this._startedAt,
            finishedAt: this._finishedAt,
            statistics: this._statistics,
            equity: this._equity,
            robotState: this._robotState,
            robotIndicators: this._robotIndicators,
            error: this._error
        };
    }

    get id() {
        return this._id;
    }

    get status() {
        return this._status;
    }

    set status(status: Status) {
        this._status = status;
    }

    get isStarted() {
        return this._status === Status.started;
    }

    start() {
        this._status = Status.started;
        this._startedAt = this._startedAt ? this._startedAt : dayjs.utc().toISOString();
    }

    set startedAt(date: string) {
        this._startedAt = dayjs.utc(date).toISOString();
    }

    set finishedAt(date: string) {
        this._finishedAt = dayjs.utc(date).toISOString();
    }

    get isFailed() {
        return this._status === Status.failed;
    }

    get isFinished() {
        return this._status === Status.finished || this._status === Status.canceled;
    }

    get error() {
        return this._error;
    }

    set error(message: string) {
        this._error = message;
    }

    get isProcessed() {
        return this._processedBars === this._totalBars;
    }

    get progress() {
        return this._processedBars;
    }

    init(totalBars: number) {
        this._totalBars = totalBars;
        this._leftBars = totalBars;
        this._processedBars = 0;
        this._completedPercent = 0;
    }

    incrementProgress() {
        this._processedBars += 1;
        this._leftBars = this._totalBars - this._processedBars;
        this._completedPercent = round((this._processedBars / this._totalBars) * 100);
        if (this._completedPercent > this._prevPercent) {
            this._prevPercent = this._completedPercent;
            logger.info(
                `Importer #${this._id} - Processed ${this._processedBars}, left ${this._leftBars} - ${this._completedPercent}%`
            );
        }
    }

    get statistics() {
        return this._statistics;
    }

    set statistics(statistics) {
        this._statistics = statistics;
    }

    get equity() {
        return this._equity;
    }

    set equity(equity) {
        this._equity = equity;
    }

    get robotState() {
        return this._robotState;
    }

    set robotState(robotState) {
        this._robotState = robotState;
    }

    get robotIndicators() {
        return this._robotIndicators;
    }

    set robotIndicators(robotIndicators) {
        this._robotIndicators = robotIndicators;
    }

    finish(cancel = false) {
        this._finishedAt = dayjs.utc().toISOString();
        if (this.status === Status.failed) return;
        if (cancel) {
            this._status = Status.canceled;
            return;
        }
        if (this.isProcessed) {
            this._status = Status.finished;
        }
    }

    fail(error: string) {
        this._status = Status.failed;
        this._error = error;
    }
}
