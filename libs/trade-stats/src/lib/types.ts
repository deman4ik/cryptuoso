import { GenericObject } from "@cryptuoso/helpers";
import { BasePosition } from "@cryptuoso/market";

export type StatsPeriod = "month" | "quarter" | "year";

export type PerformanceVals = { x: number; y: number }[];

export interface BaseStats {
    initialBalance: number | null;
    currentBalance: number | null;
    tradesCount: number;
    tradesWinning: number;
    tradesLosing: number;
    winRate: number;
    lossRate: number;
    netProfit: number;
    avgNetProfit: number | null;
    percentNetProfit: number | null;
    localMax: number;
    grossProfit: number;
    grossLoss: number;
    avgGrossProfit: number | null;
    avgGrossLoss: number | null;
    percentGrossProfit: number | null;
    percentGrossLoss: number | null;
    maxDrawdown: number;
    percentMaxDrawdown: number | null;
    percentMaxDrawdownDate: string | null;
    maxDrawdownDate: string | null;
    profitFactor: number | null;
    recoveryFactor: number | null;
    payoffRatio: number | null;
    lastUpdatedAt: string | null;
    firstPosition: BasePosition | null;
    lastPosition: BasePosition | null;
}

export interface BasePeriodStats {
    initialBalance: BaseStats["initialBalance"];
    currentBalance: BaseStats["currentBalance"];
    tradesCount: BaseStats["tradesCount"];
    percentNetProfit: BaseStats["percentNetProfit"];
    percentGrossProfit: BaseStats["percentGrossProfit"];
    percentGrossLoss: BaseStats["percentGrossLoss"];
}

export interface Stats extends BaseStats {
    initialBalance: number | null;
    currentBalance: number | null;
    tradesCount: number;
    tradesWinning: number;
    tradesLosing: number;
    winRate: number;
    lossRate: number;
    sumBarsHeld: number | null;
    avgBarsHeld: number | null;
    sumBarsHeldWinning: number | null;
    avgBarsHeldWinning: number | null;
    sumBarsHeldLosing: number | null;
    avgBarsHeldLosing: number | null;
    netProfit: number;
    avgNetProfit: number | null;
    // positionsProfitPercents: number[];
    percentNetProfit: number | null;
    // sumPercentNetProfit: number | null;
    // avgPercentNetProfit: number | null;
    // sumPercentNetProfitSqDiff: number | null;
    netProfitsSMA: number[];
    netProfitSMA: number | null;
    stdDevPercentNetProfit: number | null;
    localMax: number;
    grossProfit: number;
    grossLoss: number;
    avgGrossProfit: number | null;
    avgGrossLoss: number | null;
    percentGrossProfit: number | null;
    percentGrossLoss: number | null;
    currentWinSequence: number;
    currentLossSequence: number;
    maxConsecWins: number;
    maxConsecLosses: number;
    maxDrawdown: number;
    percentMaxDrawdown: number | null;
    percentMaxDrawdownDate: string | null;
    amountProportion: number | null;
    maxDrawdownDate: string | null;
    profitFactor: number | null;
    recoveryFactor: number | null;
    payoffRatio: number | null;
    sharpeRatio: number | null;
    rating: number | null;
    lastUpdatedAt: string | null;
    firstPosition: BasePosition | null;
    lastPosition: BasePosition | null;
    equity: PerformanceVals;
    equityAvg: PerformanceVals;
    seriesCount: number;
    currentSeries: number | null;
}

export interface FullStats extends Stats {
    avgTradesCountYears: number | null;
    avgTradesCountQuarters: number | null;
    avgTradesCountMonths: number | null;
    avgPercentNetProfitYears: number | null;
    avgPercentNetProfitQuarters: number | null;
    avgPercentNetProfitMonths: number | null;
    avgPercentGrossProfitYears: number | null;
    avgPercentGrossProfitQuarters: number | null;
    avgPercentGrossProfitMonths: number | null;
    avgPercentGrossLossYears: number | null;
    avgPercentGrossLossQuarters: number | null;
    avgPercentGrossLossMonths: number | null;
    avgPercentNetProfitYearly: number | null;
    emulateNextPosition: boolean | null;
    marginNextPosition: number | null;
    zScore: number | null;
    maxLeverage: number | null;
    periodStats: {
        year: GenericObject<PeriodStats<BasePeriodStats>>;
        quarter: GenericObject<PeriodStats<BasePeriodStats>>;
        month: GenericObject<PeriodStats<BasePeriodStats>>;
    };
}

export interface PeriodStats<T> {
    period: StatsPeriod;
    year: number;
    quarter?: number | null;
    month?: number | null;
    dateFrom: string;
    dateTo: string;
    stats: T;
}

export interface TradeStatsDB {
    fullStats: FullStats;
    periodStats: PeriodStats<BaseStats>[];
}
export interface TradeStats {
    fullStats: FullStats;
    periodStats: {
        year: GenericObject<PeriodStats<BaseStats>>;
        quarter: GenericObject<PeriodStats<BaseStats>>;
        month: GenericObject<PeriodStats<BaseStats>>;
    };
    positions?: BasePosition[];
}

export type TradeStatsType =
    | "robot"
    | "portfolio"
    | "userSignal"
    | "userRobot"
    | "userPortfolio"
    | "userSignalsAggr"
    | "userRobotsAggr"
    | "allRobotsAggr"
    | "allUserRobotsAggr"
    | "allPortfoliosAggr"
    | "allUserPortfoliosAggr";

interface BaseTradeStatsJob {
    type: TradeStatsType;
    recalc: boolean;
    round?: boolean;
    savePositions?: boolean;
}

export interface TradeStatsRobot extends BaseTradeStatsJob {
    type: "robot";
    robotId: string;
    SMAWindow?: number;
    margin?: number;
}

export interface TradeStatsPortfolio extends BaseTradeStatsJob {
    type: "portfolio";
    portfolioId: string;
    feeRate?: number;
}

export interface TradeStatsUserRobot extends BaseTradeStatsJob {
    type: "userRobot";
    userRobotId: string;
}

export interface TradeStatsUserPortfolio extends BaseTradeStatsJob {
    type: "userPortfolio";
    userPortfolioId: string;
}

export interface TradeStatsAllRobotsAggr extends BaseTradeStatsJob {
    type: "allRobotsAggr";
    exchange?: string;
    asset?: string;
}

export interface TradeStatsAllUserRobotsAggr extends BaseTradeStatsJob {
    type: "allUserRobotsAggr";
    exchange?: string;
    asset?: string;
}

export interface TradeStatsAllPortfoliosAggr extends BaseTradeStatsJob {
    type: "allPortfoliosAggr";
    exchange?: string;
}

export interface TradeStatsAllUserPortfoliosAggr extends BaseTradeStatsJob {
    type: "allUserPortfoliosAggr";
    exchange?: string;
}

export type TradeStatsJob =
    | TradeStatsRobot
    | TradeStatsPortfolio
    | TradeStatsUserRobot
    | TradeStatsUserPortfolio
    | TradeStatsAllRobotsAggr
    | TradeStatsAllUserRobotsAggr
    | TradeStatsAllPortfoliosAggr
    | TradeStatsAllUserPortfoliosAggr;

export type TradeStatsAggrJob =
    | TradeStatsAllRobotsAggr
    | TradeStatsAllUserRobotsAggr
    | TradeStatsAllPortfoliosAggr
    | TradeStatsAllUserPortfoliosAggr;

export interface StatsMeta {
    job: TradeStatsJob;
    initialBalance?: number;
    leverage?: number;
}
