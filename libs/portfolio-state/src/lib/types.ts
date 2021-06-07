import { FullStats, PeriodStats } from "@cryptuoso/trade-stats";

export interface PortfolioOptions {
    diversification: boolean;
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
    maxRobotsCount?: number;
    minRobotsCount?: number;
}

export interface PortfolioDB {
    id: string;
    code: string;
    name?: string;
    exchange: string;
    available: number;
    settings: PortfolioSettings;
    fullStats?: FullStats;
    periodStats?: PeriodStats[];
}

export interface PortfolioRobotDB {
    robotId: string;
    active: boolean;
    share: number;
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
}

export interface PortfolioBuilderJob {
    portfolioId: string;
    type: "portfolio";
}

export interface UserPortfolioBuilderJob {
    userPortfolioId: string;
    type: "userPortfolio";
}

export interface UserPorfolioDB {
    id: string;
    userId: string;
    userExAccId?: string;
    exchange: string;
    type: "signals" | "trading";
    status: "pending" | "builded" | "active" | "stopped" | "error";
    fullStats?: FullStats;
    periodStats?: PeriodStats[];
}

export interface UserPortfolioState extends UserPorfolioDB {
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
    robots?: PortfolioRobot[];
}
