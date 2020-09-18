import { round } from "@cryptuoso/helpers";
import { BasePosition } from "@cryptuoso/market";
import StatisticsCalculator from "./statistics-calculator";

/*export class PositionDataForStats {
    [index: string]: any;
    id = "";
    direction: PositionDirection = PositionDirection.short;
    exitDate = "";
    profit = 0;
    barsHeld = 0;
}

export function isPositionDataForStats(object: any): object is PositionDataForStats {
    const refObj = new PositionDataForStats();
    for (const key in refObj) {
        if (!(key in object)) return false;
        if (object[key] == null) return false;
    }
    return true;
}*/

export interface StatsVals<T> {
    all: T;
    long: T;
    short: T;
}

export type PerformanceVals = { x: number; y: number }[];

// Classes to eliminate manual object construction
export class StatsNumberValue implements StatsVals<number> {
    [index: string]: number;
    constructor(public all: number = 0, public long: number = 0, public short: number = 0) {}
}

export class StatsStringValue implements StatsVals<string> {
    [index: string]: string;
    constructor(public all: string = "", public long: string = "", public short: string = "") {}
}

export function roundToNumberOrNull(num: number, decimals = 0): number {
    if (!isFinite(num) || (!num && num != 0)) return null;

    return round(num, decimals);
}

export function roundRobotStatVals(vals: StatsNumberValue, decimals = 0): StatsNumberValue {
    const result = { ...vals };

    for (const key in result) {
        result[key] = roundToNumberOrNull(result[key], decimals);
    }

    return result;
}

export class Statistics {
    tradesCount = new StatsNumberValue();
    tradesWinning = new StatsNumberValue();
    tradesLosing = new StatsNumberValue();
    winRate = new StatsNumberValue(null, null, null);
    lossRate = new StatsNumberValue(null, null, null);
    avgBarsHeld = new StatsNumberValue(null, null, null);
    avgBarsHeldWinning = new StatsNumberValue(null, null, null);
    avgBarsHeldLosing = new StatsNumberValue(null, null, null);
    netProfit = new StatsNumberValue(null, null, null);
    localMax = new StatsNumberValue();
    avgNetProfit = new StatsNumberValue(null, null, null);
    grossProfit = new StatsNumberValue(null, null, null);
    avgProfit = new StatsNumberValue(null, null, null);
    avgProfitWinners = new StatsNumberValue(null, null, null);
    grossLoss = new StatsNumberValue(null, null, null);
    avgLoss = new StatsNumberValue(null, null, null);
    maxConsecWins = new StatsNumberValue();
    maxConsecLosses = new StatsNumberValue();
    currentWinSequence = new StatsNumberValue();
    currentLossSequence = new StatsNumberValue();
    maxDrawdown = new StatsNumberValue(null, null, null);
    maxDrawdownDate = new StatsStringValue();
    profitFactor? = new StatsNumberValue(null, null, null);
    recoveryFactor? = new StatsNumberValue(null, null, null);
    payoffRatio? = new StatsNumberValue(null, null, null);
    rating? = new StatsNumberValue(null, null, null);
}

export function isStatistics(object: any): object is Statistics {
    const refObj = new Statistics();
    for (const key in refObj) {
        if (!(key in object)) return false;
        if ((refObj as any)[key].all != null)
            if (object[key].all == null || object[key].long == null || object[key].short == null) return false;
    }
    return true;
}

export interface TradeStats {
    statistics: Statistics;
    lastPositionExitDate: string;
    lastUpdatedAt: string;
    equity: PerformanceVals;
    equityAvg: PerformanceVals;
}

export class TradeStatsClass implements TradeStats {
    statistics = new Statistics();
    lastPositionExitDate = "";
    lastUpdatedAt = "";
    equity: PerformanceVals = [];
    equityAvg: PerformanceVals = [];
}

export function isTradeStats(object: any, checkPropsCount = true): object is TradeStats {
    if (object == null) return true;
    const refObj = new TradeStatsClass();
    if (checkPropsCount && Object.keys(object).length != Object.keys(refObj).length) return false;
    for (const key in refObj) {
        if (!(key in object)) return false;
    }
    return true;
}

// It is now expected that every value is rounded after each cumulative calculatuion
export function calcStatistics(previousRobotStatistics: TradeStats, positions: BasePosition[]): TradeStats {
    if (!positions || positions.length < 1) return previousRobotStatistics;

    return new StatisticsCalculator(previousRobotStatistics, positions).getStats();
}
