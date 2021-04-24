import { FullStats, TradeStats } from "@cryptuoso/trade-stats";

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
    initialBalance: number;
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
    amountInCurrency: number;
}

export interface PortfolioState extends PortfolioDB {
    tradeStats?: TradeStats;
    robots?: PortfolioRobot[];
}

export interface PortfolioBuilderJob {
    portfolioId: string;
}
