import StatisticsCalculator from "./statistics-calculator";
import { round } from "@cryptuoso/helpers";

export const enum PositionDirection {
    long = "long",
    short = "short"
}

export class PositionDataForStats {
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
}

export interface RobotStatVals<T> {
    all: T;
    long: T;
    short: T;
}

export type PerformanceVals = { x: number; y: number }[];

// Classes to eliminate manual object construction
export class RobotNumberValue implements RobotStatVals<number> {
    [index: string]: number;
    constructor(public all: number = 0, public long: number = 0, public short: number = 0) {}
}

export class RobotStringValue implements RobotStatVals<string> {
    [index: string]: string;
    constructor(public all: string = "", public long: string = "", public short: string = "") {}
}

export function roundToNumberOrNull(num: number, decimals = 0): number {
    if (!isFinite(num) || (!num && num != 0)) return null;

    return round(num, decimals);
}

export function roundRobotStatVals(vals: RobotNumberValue, decimals = 0): RobotNumberValue {
    const result = { ...vals };

    for (const key in result) {
        result[key] = roundToNumberOrNull(result[key], decimals);
    }

    return result;
}

export class Statistics {
    [index: string]: any;
    tradesCount = new RobotNumberValue();
    tradesWinning = new RobotNumberValue();
    tradesLosing = new RobotNumberValue();
    winRate = new RobotNumberValue(null, null, null);
    lossRate = new RobotNumberValue(null, null, null);
    avgBarsHeld = new RobotNumberValue(null, null, null);
    avgBarsHeldWinning = new RobotNumberValue(null, null, null);
    avgBarsHeldLosing = new RobotNumberValue(null, null, null);
    netProfit = new RobotNumberValue(null, null, null);
    localMax = new RobotNumberValue();
    avgNetProfit = new RobotNumberValue(null, null, null);
    grossProfit = new RobotNumberValue(null, null, null);
    avgProfit = new RobotNumberValue(null, null, null);
    grossLoss = new RobotNumberValue(null, null, null);
    avgLoss = new RobotNumberValue(null, null, null);
    maxConsecWins = new RobotNumberValue();
    maxConsecLosses = new RobotNumberValue();
    currentWinSequence = new RobotNumberValue();
    currentLossSequence = new RobotNumberValue();
    maxDrawdown = new RobotNumberValue(null, null, null);
    maxDrawdownDate = new RobotStringValue();
    profitFactor? = new RobotNumberValue(null, null, null);
    recoveryFactor? = new RobotNumberValue(null, null, null);
    payoffRatio? = new RobotNumberValue(null, null, null);
    rating? = new RobotNumberValue(null, null, null);
}

export function isStatistics(object: any): object is Statistics {
    const refObj = new Statistics();
    for (const key in refObj) {
        if (!(key in object)) return false;
        if (refObj[key].all != null)
            if (object[key].all == null || object[key].long == null || object[key].short == null) return false;
    }
    return true;
}

export class RobotStats {
    [index: string]: any;
    statistics = new Statistics();
    lastPositionExitDate = "";
    lastUpdatedAt = "";
    equity: PerformanceVals = [];
    equityAvg: PerformanceVals = [];
}

export function isRobotStats(object: any, checkPropsCount = true): object is RobotStats {
    if (object == null) return true;
    const refObj = new RobotStats();
    if (checkPropsCount && Object.keys(object).length != Object.keys(refObj).length) return false;
    for (const key in refObj) {
        if (!(key in object)) return false;
    }
    return true;
}

// It is now expected that every value is rounded after each cumulative calculatuion
export function calcStatisticsCumulatively(
    previousRobotStatistics: RobotStats,
    positions: PositionDataForStats[]
): RobotStats {
    if (!positions || positions.length < 1) return previousRobotStatistics;

    return new StatisticsCalculator(previousRobotStatistics, positions).getStats();
}
