import { ExchangeCandle, ExchangePrice } from "@cryptuoso/market";

export const enum ExwatcherEvents {
    SUBSCRIBE = "in-exwatcher.subscribe",
    SUBSCRIBE_ALL = "in-exwatcher.subscribe-all",
    UNSUBSCRIBE_ALL = "in-exwatcher.unsubscribe-all",
    ADD_MARKET = "in-exwatcher.add-market"
}

export const enum MarketEvents {
    TICK = "market.tick",
    CANDLE = "market.candle"
}

export const ExwatcherSchema = {
    [ExwatcherEvents.SUBSCRIBE]: {
        exchange: "string",
        asset: "string",
        currency: "string"
    },
    [ExwatcherEvents.SUBSCRIBE_ALL]: {
        exchange: "string"
    },
    [ExwatcherEvents.UNSUBSCRIBE_ALL]: {
        exchange: "string"
    },
    [ExwatcherEvents.ADD_MARKET]: {
        exchange: "string",
        asset: "string",
        currency: "string"
    },
    [MarketEvents.TICK]: {
        exchange: "string",
        asset: "string",
        currency: "string",
        time: "number",
        timestamp: "string",
        price: "number"
    },
    [MarketEvents.CANDLE]: {
        exchange: "string",
        asset: "string",
        currency: "string",
        timeframe: "number",
        time: "number",
        timestamp: "string",
        open: "number",
        high: "number",
        low: "number",
        close: "number",
        volume: "number",
        type: "string"
    }
};

export interface ExwatcherSubscribe {
    exchange: string;
    asset: string;
    currency: string;
}

export interface ExwatcherSubscribeAll {
    exchange: string;
}

export interface ExwatcherUnsubscribeAll {
    exchange: string;
}

export interface ExwatcherAddMarket {
    exchange: string;
    asset: string;
    currency: string;
}

export type ExwatcherTick = ExchangePrice;

export type ExwatcherCandle = ExchangeCandle;
