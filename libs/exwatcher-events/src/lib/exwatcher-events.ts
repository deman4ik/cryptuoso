import { ExchangeCandle, ExchangePrice } from "@cryptuoso/market";

export const enum ExwatcherWorkerEvents {
    SUBSCRIBE = "in-exwatcher-worker.subscribe",
    SUBSCRIBE_ALL = "in-exwatcher-worker.subscribe-all",
    UNSUBSCRIBE_ALL = "in-exwatcher-worker.unsubscribe-all",
    TICK = "out-exwatcher-worker.tick",
    CANDLE = "out-exwatcher-worker.candle"
}

export const ExwatcherSchema = {
    [ExwatcherWorkerEvents.SUBSCRIBE]: {
        exchange: "string",
        asset: "string",
        currency: "string"
    },
    [ExwatcherWorkerEvents.SUBSCRIBE_ALL]: {
        exchange: "string"
    },
    [ExwatcherWorkerEvents.UNSUBSCRIBE_ALL]: {
        exchange: "string"
    },
    [ExwatcherWorkerEvents.TICK]: {
        exchange: "string",
        asset: "string",
        currency: "string",
        time: "number",
        timestamp: "string",
        price: "number"
    },
    [ExwatcherWorkerEvents.CANDLE]: {
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

export type ExwatcherTick = ExchangePrice;

export type ExwatcherCandle = ExchangeCandle;
