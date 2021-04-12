import { GenericObject } from "@cryptuoso/helpers";
import { BasePosition } from "@cryptuoso/market";

export type StatsPeriod = "month" | "quarter" | "year";

export type PerformanceVals = { x: number; y: number }[];

export interface Stats {
    initialBalance: number | null;
    currentBalance: number | null;
    tradesCount: number;
    tradesWinning: number;
    tradesLosing: number;
    winRate: number;
    lossRate: number;
    avgBarsHeld: number | null;
    avgBarsHeldWinning: number | null;
    avgBarsHeldLosing: number | null;
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
    currentWinSequence: number;
    currentLossSequence: number;
    maxConsecWins: number;
    maxConsecLosses: number;
    maxDrawdown: number;
    maxDrawdownDate: string | null;
    profitFactor: number | null;
    recoveryFactor: number | null;
    payoffRatio: number | null;
    rating: number | null;
    lastUpdatedAt: string | null;
    firstPosition: BasePosition | null;
    lastPosition: BasePosition | null;
    equity: PerformanceVals;
    equityAvg: PerformanceVals;
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
}

export interface PeriodStats {
    period: StatsPeriod;
    year: number;
    quarter?: number | null;
    month?: number | null;
    dateFrom: string;
    dateTo: string;
    stats: Stats;
}

export interface TradeStats {
    fullStats: FullStats;
    periodStats: {
        year: GenericObject<PeriodStats>;
        quarter: GenericObject<PeriodStats>;
        month: GenericObject<PeriodStats>;
    };
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
}

export interface TradeStatsRobot extends BaseTradeStatsJob {
    type: "robot";
    robotId: string;
}

export interface TradeStatsPortfolio extends BaseTradeStatsJob {
    type: "portfolio";
    portfolioId: string;
}

export interface TradeStatsUserSignal extends BaseTradeStatsJob {
    type: "userSignal";
    userSignalId: string;
}

export interface TradeStatsUserRobot extends BaseTradeStatsJob {
    type: "userRobot";
    userRobotId: string;
}

export interface TradeStatsUserPortfolio extends BaseTradeStatsJob {
    type: "userPortfolio";
    userPortfolioId: string;
}

export interface TradeStatsUserSignalsAggr extends BaseTradeStatsJob {
    type: "userSignalsAggr";
    userId: string;
    exchange?: string;
    asset?: string;
}

export interface TradeStatsUserRobotsAggr extends BaseTradeStatsJob {
    type: "userRobotsAggr";
    userId: string;
    exchange?: string;
    asset?: string;
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
    | TradeStatsUserSignal
    | TradeStatsUserRobot
    | TradeStatsUserPortfolio
    | TradeStatsUserSignalsAggr
    | TradeStatsUserRobotsAggr
    | TradeStatsAllRobotsAggr
    | TradeStatsAllUserRobotsAggr
    | TradeStatsAllPortfoliosAggr
    | TradeStatsAllUserPortfoliosAggr;

export type TradeStatsAggrJob =
    | TradeStatsUserSignalsAggr
    | TradeStatsUserRobotsAggr
    | TradeStatsAllRobotsAggr
    | TradeStatsAllUserRobotsAggr
    | TradeStatsAllPortfoliosAggr
    | TradeStatsAllUserPortfoliosAggr;

export interface StatsMeta {
    job: TradeStatsJob;
    userInitialBalance?: number;
}
