import { Robot, StrategyCode, RobotPositionState, StrategyProps, RobotStats } from "@cryptuoso/robot-state";
import { ValidTimeframe, Candle, SignalEvent, DBCandle, calcPositionProfit } from "@cryptuoso/market";
import dayjs from "@cryptuoso/dayjs";
import { round, defaultValue } from "@cryptuoso/helpers";
import logger from "@cryptuoso/logger";
import { IndicatorCode } from "@cryptuoso/robot-indicators";
import { calcStatistics } from "@cryptuoso/stats-calc";
import { getRobotPositionVolume, RobotSettings, StrategySettings, VolumeSettingsType } from "@cryptuoso/robot-settings";

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
    completedPercent?: number;
    status: Status;
    startedAt?: string;
    finishedAt?: string;
    robotState?: StrategyProps;
    strategySettings?: {
        [key: string]: StrategySettings;
    };
    robotSettings?: RobotSettings;
    robotInstances?: { [key: string]: Robot };
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

export interface BacktesterStats extends RobotStats {
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
    #averageFee: number;
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
    #strategySettings?: {
        [key: string]: StrategySettings;
    };
    #robotSettings?: RobotSettings;
    #robots?: {
        [key: string]: {
            instance: Robot;
            data: {
                logs: BacktesterLogs[];
                alerts: BacktesterSignals[];
                trades: BacktesterSignals[];
                positions: { [key: string]: BacktesterPositionState };
                settings: {
                    [key: string]: {
                        strategySettings: StrategySettings;
                        robotSettings: RobotSettings;
                        activeFrom: string;
                    };
                };
                stats: BacktesterStats;
            };
        };
    } = {};
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
            local: defaultValue(state.settings?.local, false),
            populateHistory: defaultValue(state.settings?.populateHistory, false),
            saveSignals: defaultValue(state.settings?.saveSignals, true),
            savePositions: defaultValue(state.settings?.savePositions, true),
            saveLogs: defaultValue(state.settings?.saveLogs, false)
        };
        this.#strategySettings = state.strategySettings;
        this.#robotSettings = state.robotSettings;
        this.#totalBars = defaultValue(state.totalBars, 0);
        this.#processedBars = defaultValue(state.processedBars, 0);
        this.#leftBars = defaultValue(state.leftBars, this.#totalBars);
        this.#completedPercent = defaultValue(state.completedPercent, 0);
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
            strategySettings: this.#strategySettings,
            robotSettings: this.#robotSettings,
            totalBars: this.#totalBars,
            processedBars: this.#processedBars,
            leftBars: this.#leftBars,
            completedPercent: this.#completedPercent,
            status: this.#status,
            startedAt: this.#startedAt,
            finishedAt: this.#finishedAt,
            robotState: this.#robotState,
            error: this.#error
        };
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

    set averageFee(averageFee: number) {
        this.#averageFee = averageFee;
    }

    start() {
        this.#status = Status.started;
        this.#startedAt = this.#startedAt || dayjs.utc().toISOString();
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
                `Backtester #${this.#id} - Processed ${this.#processedBars}, left ${this.#leftBars} - ${
                    this.#completedPercent
                }%`
            );
        }
    }

    get settings() {
        return this.#settings;
    }

    get robotState() {
        return this.#robotState;
    }

    get robotSettings() {
        return this.#robotSettings;
    }

    set robotSettings(robotSettings) {
        this.#robotSettings = robotSettings;
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

    initRobots(strategyCode: StrategyCode) {
        for (const [id, settings] of Object.entries(this.#strategySettings)) {
            try {
                this.#robots[id] = {
                    instance: new Robot({
                        id,
                        exchange: this.#exchange,
                        asset: this.#asset,
                        currency: this.#currency,
                        timeframe: this.#timeframe,
                        strategy: this.#strategy,
                        settings: {
                            strategySettings: settings,
                            robotSettings: this.#robotSettings,
                            activeFrom: this.#dateFrom
                        },
                        backtest: true
                    }),
                    data: {
                        logs: [],
                        alerts: [],
                        trades: [],
                        positions: {},
                        settings: {},
                        stats: null
                    }
                };
                this.#robots[id].instance.setStrategy(strategyCode);
                this.#robots[id].instance.initStrategy();
            } catch (err) {
                logger.error(`Backtester ${this.#id} - Failed to init robot ${id}`, err);
                throw err;
            }
        }
    }

    initIndicators(indicatorsCode: { fileName: string; code: IndicatorCode }[]) {
        Object.keys(this.#robots).forEach((id) => {
            try {
                this.#robots[id].instance.setBaseIndicatorsCode(indicatorsCode);
                this.#robots[id].instance.setIndicators();
                this.#robots[id].instance.initIndicators();
            } catch (err) {
                logger.error(`Backtester ${this.#id} - Failed to init robot's #${id} indicators`, err);
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
        if (this.#settings.savePositions || this.#settings.populateHistory) {
            const robot = this.#robots[id];
            robot.instance.positionsToSave.forEach((pos) => {
                const newPos = {
                    ...pos,
                    entryDate: pos.entryCandleTimestamp,
                    exitDate: pos.exitCandleTimestamp
                };
                robot.data.positions[pos.id] = { ...newPos, backtestId: this.#id };
            });
        }
    };

    #saveSettings = (id: string) => {
        const robot = this.#robots[id];
        if (!robot.data.settings[robot.instance.settingsActiveFrom])
            robot.data.settings[robot.instance.settingsActiveFrom] = robot.instance.settings;
    };

    #calcStats = (id: string) => {
        const robot = this.#robots[id];
        if (robot.instance.hasClosedPositions) {
            const positions = robot.instance.closedPositions.map((pos) => {
                const volume = getRobotPositionVolume(
                    robot.instance.settings.robotSettings,
                    pos.entryPrice,
                    robot.data.stats?.statistics?.netProfit?.all
                );
                const profit = calcPositionProfit(
                    pos.direction,
                    pos.entryPrice,
                    pos.exitPrice,
                    volume,
                    this.#averageFee
                );
                return { ...pos, volume, profit };
            });
            robot.data.stats = {
                ...calcStatistics(robot.data.stats, positions),
                robotId: id,
                backtestId: this.#id
            };
        }
    };

    #updateSettings = (id: string) => {
        const robot = this.#robots[id];
        if (robot.instance.hasClosedPositions) {
            if (robot.instance.robotSettings.volumeType === VolumeSettingsType.assetDynamicDelta) {
                const volume = getRobotPositionVolume(
                    robot.instance.settings.robotSettings,
                    null,
                    robot.data.stats.statistics.netProfit.all
                );

                if (volume !== robot.instance.robotSettings.volume)
                    robot.instance.settings = {
                        strategySettings: robot.instance.strategySettings,
                        robotSettings: { ...robot.instance.robotSettings, volume },
                        activeFrom: robot.instance.lastCandle.timestamp
                    };
            }
        }
    };

    async handleCandle(candle: Candle) {
        logger.info(`Backtester #${this.id} - Handling ${this.#processedBars + 1} bar of ${this.#totalBars}`);
        Object.keys(this.#robots).forEach(async (id) => {
            const robot = this.#robots[id];
            robot.instance.handleCandle(candle);
            robot.instance.clearEvents();
            robot.instance.checkAlerts();

            this.#saveLogs(id);
            this.#saveSignals(id);
            this.#savePositions(id);
            this.#calcStats(id);
            this.#updateSettings(id);
            this.#saveSettings(id);

            robot.instance.clearEvents();
            await robot.instance.calcIndicators();
            robot.instance.runStrategy();
            robot.instance.finalize();

            this.#saveLogs(id);
            this.#saveSignals(id);
            this.#savePositions(id);
            this.#calcStats(id);
            this.#updateSettings(id);
            this.#saveSettings(id);
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
            this.#robotState = this.#robots[this.#robotId].instance.state;
            this.#status = Status.finished;
        }
    }

    fail(error: string) {
        this.#status = Status.failed;
        this.#error = error;
    }
}
