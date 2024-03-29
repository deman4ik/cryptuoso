import ccxt from "ccxt";

interface MinMax {
    min: number;
    max: number | undefined;
}

export interface TradeSettings {
    orderTimeout: number;
    useOrderBookPrice?: boolean;
    slippage?: {
        entry?: {
            stepPercent: number;
            count?: number;
        };
        exit?: {
            stepPercent: number;
            count?: number;
        };
    };
    deviation?: {
        entry?: number;
        exit?: number;
    };
}

export interface Market {
    exchange: string;
    asset: string;
    currency: string;
    precision: {
        amount: number | undefined;
        price: number | undefined;
    };
    limits: {
        amount?: MinMax;
        amountCurrency: MinMax;
        price?: MinMax;
        cost?: MinMax;
        leverage?: MinMax;
    };
    feeRate: number;
    loadFrom: string;
    info: ccxt.Market;
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
    precision: { price: number; amount: number };
    tradeSettings: TradeSettings;
    assetDynamicDelta: number;
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
