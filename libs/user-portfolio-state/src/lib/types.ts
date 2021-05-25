import { FullStats } from "@cryptuoso/trade-stats";

export interface UserPortfolioSettings {
    initialBalance: number;
    tradingAmountType: "currencyFixed" | "balancePercent";
    balancePercent?: number;
    tradingAmountCurrency?: number;
    leverage: number;
    minBalance: number;
}

export interface UserPorfolioDB {
    id: string;
    portfolioId: string;
    userId: string;
    userExAccId?: string;
    exchange: string;
    status: "signals" | "active" | "error";
    settings: UserPortfolioSettings;
    stats?: FullStats;
}
