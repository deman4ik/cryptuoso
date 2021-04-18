import { FullStats } from "@cryptuoso/trade-stats";
import { PortfolioDB } from "@cryptuoso/portfolio-state";

export interface UserPortfolioSettings {
    initialBalance: number;
    tradingAmountType: "currencyFixed" | "balancePercent";
    tradingAmount: number;
}

export interface UserPorfolioDB {
    id: string;
    portfolioId: string;
    userId: string;
    userExAccId?: string;
    exchange: string;
    status: "signals" | "active" | "error";
    settings: UserPortfolioSettings;
}

export interface UserPorfolioState extends UserPorfolioDB {
    portfolio: PortfolioDB;
    stats?: FullStats;
}
