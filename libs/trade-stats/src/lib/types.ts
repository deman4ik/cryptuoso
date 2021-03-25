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

export type StatsCalcType =
    | "robot"
    | "robotsAggr"
    | "userSignal"
    | "userSignalsAggr"
    | "userRobot"
    | "userRobotsAggr"
    | "userExAcс"
    | "portfolio"
    | "portfoliosAgrr"
    | "userAggr";

export interface StatsMeta {
    type: StatsCalcType;
    userId?: string;
    userInitialBalance?: number;
    robotId?: string;
    portfolioId?: string;
    userSignalId?: string;
    userRobotId?: string;
    userPosrtfolioId?: string;
    exchange?: string;
    asset?: string;
    currency?: string;
}
