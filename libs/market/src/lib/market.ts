import { ValidTimeframe } from "./timeframe";

interface UserMarketAmount {
    amount: number;
    amountUSD: number;
}

interface UserMarketMinMax {
    min: UserMarketAmount;
    max: UserMarketAmount;
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

export const enum CandleType {
    loaded = "loaded",
    created = "created",
    previous = "previous",
    history = "history"
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

export interface ExchangeCandle {
    exchange: string;
    asset: string;
    currency: string;
    timeframe: ValidTimeframe;
    time: number;
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    type: CandleType;
}

export interface DBCandle {
    exchange: string;
    asset: string;
    currency: string;
    id?: string;
    time: number;
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    type: CandleType;
}

export interface Candle extends DBCandle {
    id: string;
    timeframe: number;
}

export interface CandleProps {
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
}

export const enum OrderType {
    stop = "stop",
    limit = "limit",
    market = "market",
    forceMarket = "forceMarket"
}

export const enum TradeAction {
    long = "long",
    short = "short",
    closeLong = "closeLong",
    closeShort = "closeShort"
}
