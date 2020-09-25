import {
    makeValidateFunc,
    PositionForStatsSchema,
    PositionsForStatsSchema,
    StatisticsSchema,
    TradeStatsSchema
} from "./schemes";
import { BasePosition, PositionDirection } from "@cryptuoso/market";
import { round } from "@cryptuoso/helpers";

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

export interface Statistics {
    tradesCount: StatsNumberValue;
    tradesWinning: StatsNumberValue;
    tradesLosing: StatsNumberValue;
    winRate: StatsNumberValue;
    lossRate: StatsNumberValue;
    avgBarsHeld: StatsNumberValue;
    avgBarsHeldWinning: StatsNumberValue;
    avgBarsHeldLosing: StatsNumberValue;
    netProfit: StatsNumberValue;
    localMax: StatsNumberValue;
    avgNetProfit: StatsNumberValue;
    grossProfit: StatsNumberValue;
    avgProfit: StatsNumberValue;
    avgProfitWinners: StatsNumberValue;
    grossLoss: StatsNumberValue;
    avgLoss: StatsNumberValue;
    maxConsecWins: StatsNumberValue;
    maxConsecLosses: StatsNumberValue;
    currentWinSequence: StatsNumberValue;
    currentLossSequence: StatsNumberValue;
    maxDrawdown: StatsNumberValue;
    maxDrawdownDate: StatsStringValue;
    profitFactor: StatsNumberValue;
    recoveryFactor: StatsNumberValue;
    payoffRatio: StatsNumberValue;
    rating: StatsNumberValue;
}

export class StatisticsClass implements Statistics {
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
    profitFactor = new StatsNumberValue(null, null, null);
    recoveryFactor = new StatsNumberValue(null, null, null);
    payoffRatio = new StatsNumberValue(null, null, null);
    rating = new StatsNumberValue(null, null, null);
}

export interface TradeStats {
    statistics: Statistics;
    lastPositionExitDate: string;
    lastUpdatedAt: string;
    equity: PerformanceVals;
    equityAvg: PerformanceVals;
}

export class TradeStatsClass implements TradeStats {
    statistics = new StatisticsClass();
    lastPositionExitDate = "";
    lastUpdatedAt = "";
    equity: PerformanceVals = [];
    equityAvg: PerformanceVals = [];
}

export const isPositionForStats = makeValidateFunc<BasePosition>(PositionForStatsSchema);

export const isPositionsForStats = makeValidateFunc<BasePosition[]>(PositionsForStatsSchema);

export const isStatistics = makeValidateFunc<Statistics>(StatisticsSchema);

export const isTradeStats = makeValidateFunc<TradeStats>(TradeStatsSchema);
