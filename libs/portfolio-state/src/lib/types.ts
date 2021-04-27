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
    minBalance: number;
    minTradeAmount: number;
    feeRate: number;
    initialBalance: number;
    leverage: number;
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

export interface PortfolioState extends PortfolioDB {
    robots?: PortfolioRobot[];
}

export interface PortfolioBuilderJob {
    portfolioId: string;
}
