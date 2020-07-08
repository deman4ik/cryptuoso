import { ExchangePrice } from "@cryptuoso/market";

export const enum ExwatcherWorkerEvents {
    SUBSCRIBE = "in-exwatcher-worker.subscribe",
    SUBSCRIBE_ALL = "in-exwatcher-worker.subscribe-all",
    UNSUBSCRIBE_ALL = "in-exwatcher-worker.unsubscribe-all",
    TICK = "out-exwatcher-worker.tick"
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
