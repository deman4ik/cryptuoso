import StatisticsCalculator from "./statistics-calculator";
import EquityCalculator from "./equity-calculator";
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

export class RobotStats {
    [index: string]: any;
    lastUpdatedAt = "";
    lastPositionExitDate = "";
    performance: PerformanceVals = [];
    tradesCount = new RobotNumberValue();
    tradesWinning = new RobotNumberValue();
    tradesLosing = new RobotNumberValue();
    winRate = new RobotNumberValue();
    lossRate = new RobotNumberValue();
    avgBarsHeld = new RobotNumberValue();
    avgBarsHeldWinning = new RobotNumberValue();
    avgBarsHeldLosing = new RobotNumberValue();
    netProfit = new RobotNumberValue();
    localMax = new RobotNumberValue();
    avgNetProfit = new RobotNumberValue();
    grossProfit = new RobotNumberValue();
    avgProfit = new RobotNumberValue();
    grossLoss = new RobotNumberValue();
    avgLoss = new RobotNumberValue();
    maxConsecWins = new RobotNumberValue();
    maxConsecLosses = new RobotNumberValue();
    currentWinSequence = new RobotNumberValue();
    currentLossSequence = new RobotNumberValue();
    maxDrawdown = new RobotNumberValue();
    maxDrawdownDate = new RobotStringValue();
    profitFactor? = new RobotNumberValue(null, null, null);
    recoveryFactor? = new RobotNumberValue(null, null, null);
    payoffRatio? = new RobotNumberValue(null, null, null);
}

export function isRobotStats(object: any): object is RobotStats {
    const refObj = new RobotStats();
    for (const key in refObj) {
        if (!(key in object)) return false;
        if (refObj[key].all != null)
            if (object[key].all == null || object[key].long == null || object[key].short == null) return false;
    }
    return true;
}

export class RobotEquity {
    [index: string]: any;
    profit = 0;
    lastProfit = 0;
    tradesCount = 0;
    winRate = 0;
    maxDrawdown = 0;
    changes: PerformanceVals = [];
}

export function isRobotEquity(object: any): object is RobotEquity {
    const refObj = new RobotEquity();
    if (Object.keys(object).length != Object.keys(refObj).length) return false;
    for (const key in object) {
        if (!(key in refObj)) return false;
    }
    return true;
}

export class CommonStats {
    constructor(public statistics: RobotStats, public equity: RobotEquity) {}
}

// It is now expected that every value is rounded after each cumulative calculatuion
export function calcStatisticsCumulatively(
    previousPositionsStatistics: CommonStats,
    positions: PositionDataForStats[]
): CommonStats {
    if (!positions || positions.length < 1) return previousPositionsStatistics;

    const prevStatistics = previousPositionsStatistics.statistics;
    const lastPosition = positions[positions.length - 1];

    const statistics = new StatisticsCalculator(prevStatistics, positions).getStats();

    const equity: RobotEquity = new EquityCalculator(statistics, lastPosition).getEquity();

    return new CommonStats(statistics, equity);
}
