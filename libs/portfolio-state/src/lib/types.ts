import { BasePosition } from "@cryptuoso/market";
import { BaseStats, FullStats, PeriodStats } from "@cryptuoso/trade-stats";

export interface PortfolioOptions {
    // diversification: boolean;
    profit: boolean;
    risk: boolean;
    moneyManagement: boolean;
    winRate: boolean;
    efficiency: boolean;
}

export interface PortfolioSettings {
    options: PortfolioOptions;
    tradingAmountType: "currencyFixed" | "balancePercent";
    balancePercent?: number;
    tradingAmountCurrency?: number;
    initialBalance: number;
    leverage: number;
    feeRate?: number;
    maxRobotsCount?: number;
    minRobotsCount?: number;
    includeTimeframes?: number[];
    excludeTimeframes?: number[];
    includeAssets?: string[];
    excludeAssets?: string[];
    includeRobots?: string[];
    excludeRobots?: string[];
    custom?: boolean;
    robotsShare?: {
        [key: string]: number;
    };
    dateFrom?: string;
    dateTo?: string;
}

export interface PortfolioDB {
    id: string;
    code: string;
    name?: string;
    exchange: string;
    available: number;
    status: "started" | "stopped";
    settings: PortfolioSettings;
    fullStats?: FullStats;
    periodStats?: PeriodStats<BaseStats>[];
    base: boolean;
}

export interface PortfolioRobotDB {
    robotId: string;
    active: boolean;
    share: number;
    priority: number;
}
export interface PortfolioRobot extends PortfolioRobotDB {
    amountInCurrency?: number;
}

export interface PortfolioContext {
    minTradeAmount: number;
    feeRate: number;
    currentBalance: number;
}

export interface PortfolioState extends PortfolioDB {
    context: PortfolioContext;
    variables?: {
        portfolioBalance: number;
        minBalance: number;
        maxRobotsCount: number;
        minRobotsCount: number;
    };
    robots?: PortfolioRobot[];
    positions?: BasePosition[];
}

export interface PortfolioBuilderJob {
    portfolioId: string;
    type: "portfolio";
}

export interface UserPortfolioBuilderJob {
    userPortfolioId: string;
    type: "userPortfolio";
}

export interface UserPortfolioDB {
    id: string;
    userId: string;
    userExAccId?: string;
    exchange: string;
    type: "signals" | "trading";
    status: "starting" | "started" | "stopping" | "stopped" | "paused";
    startedAt?: string;
    stoppedAt?: string;
    message?: string;
    fullStats?: FullStats;
    periodStats?: PeriodStats<BaseStats>[];
}

export interface UserPortfolioState extends UserPortfolioDB {
    userPortfolioSettingsId?: string;
    userPortfolioSettingsActiveFrom?: string;
    settings: PortfolioSettings;
    context: PortfolioContext;
    variables?: {
        portfolioBalance: number;
        minBalance: number;
        maxRobotsCount: number;
        minRobotsCount: number;
    };
    robots?: PortfolioRobotDB[];
}
