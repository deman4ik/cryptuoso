import { FullStats, TradeStats } from "@cryptuoso/trade-stats";

export interface PortfolioOptions {
    diversification: boolean;
    profit: boolean;
    risk: boolean;
    moneyManagement: boolean;
    winRate: boolean;
    recovery: boolean;
}

export interface PortfolioSettings {
    options: PortfolioOptions;
    minBalance: number;
}

export interface PortfolioDB {
    id: string;
    code: string;
    name?: string;
    exchange: string;
    available: number;
    settings: PortfolioSettings;
    stats?: FullStats;
}

export interface PortfolioRobot {
    robotId: string;
    active: boolean;
    share: number;
}

export interface PortfolioState extends PortfolioDB {
    tradeStats?: TradeStats;
    robots?: PortfolioRobot[];
}

export interface PortfolioBuilderJob {
    portfolioId: string;
}
