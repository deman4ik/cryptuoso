interface MinMax {
    min: number;
    max: number | undefined;
}

export interface Market {
    exchange: string;
    asset: string;
    currency: string;
    precision: { base: number; quote: number; amount: number; price: number };
    limits: { amount: MinMax; amountCurrency: MinMax; price: MinMax; cost?: MinMax };
    averageFee: number;
    loadFrom: string;
}

interface UserMarketAmount {
    amount: number;
    amountUSD: number;
}

interface UserMarketMinMax {
    min: UserMarketAmount;
    max?: UserMarketAmount | undefined;
}

export interface UserMarketState {
    exchange: string;
    asset: string;
    currency: string;
    currentPrice: number;
    userId: string;
    limits: {
        userSignal: UserMarketMinMax;
        userRobot: UserMarketMinMax;
    };
}

export interface ExchangePrice {
    exchange: string;
    asset: string;
    currency: string;
    time: number;
    timestamp: string;
    price: number;
}

export interface ExchangeTrade extends ExchangePrice {
    amount: number;
    side: string;
}

export const enum TradeAction {
    long = "long",
    short = "short",
    closeLong = "closeLong",
    closeShort = "closeShort"
}
