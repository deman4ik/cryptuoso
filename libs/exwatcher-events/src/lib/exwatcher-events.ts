import { ISO_DATE_REGEX } from "@cryptuoso/helpers";

export const IN_EXWATCHER_TOPIC = "in-exwatcher";
export const OUT_EXWATCHER_TOPIC = "out-exwatcher";

export const enum ExwatcherEvents {
    SUBSCRIBE = "in-exwatcher.subscribe",
    SUBSCRIBE_ALL = "in-exwatcher.subscribe-all",
    UNSUBSCRIBE_ALL = "in-exwatcher.unsubscribe-all",
    ADD_MARKET = "in-exwatcher.add-market",
    ERROR = "out-exwatcher.error"
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
    [ExwatcherEvents.ERROR]: {
        exchange: "string",
        asset: "string",
        currency: "string",
        exwatcherId: "string",
        timestamp: { type: "string", pattern: ISO_DATE_REGEX },
        error: "string"
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

export interface ExwatcherErrorEvent {
    exchange: string;
    asset: string;
    currency: string;
    exwatcherId: string;
    timestamp: string;
    error: string;
}
