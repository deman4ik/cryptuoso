//TODO: DEPRECATE!
import { ISO_DATE_REGEX } from "@cryptuoso/helpers";
import { ValidTimeframe } from "@cryptuoso/market";

export const IN_EXWATCHER_TOPIC = "in-exwatcher";
export const OUT_EXWATCHER_TOPIC = "out-exwatcher";

export const enum ExwatcherEvents {
    SUBSCRIBE = "in-exwatcher.subscribe",
    SUBSCRIBE_ALL = "in-exwatcher.subscribe-all",
    UNSUBSCRIBE_ALL = "in-exwatcher.unsubscribe-all",
    IMPORTER_STATUS = "in-exwatcher.importer-status",
    ERROR = "out-exwatcher.error"
}

export const EXCHANGES = {
    binance_futures: "binance_futures",
    bitfinex: "bitfinex",
    huobipro: "huobipro",
    kraken: "kraken",
    kucoin: "kucoin"
};

export const getExwatcherSubscribeEventName = (exchange: string) => {
    if (!Object.values(EXCHANGES).includes(exchange)) throw new Error(`Exchange ${exchange} is not supported`);
    return `in-exwatcher-${exchange}.subscribe`;
};

export const getExwatcherSubscribeAllEventName = (exchange: string) => {
    if (!Object.values(EXCHANGES).includes(exchange)) throw new Error(`Exchange ${exchange} is not supported`);
    return `in-exwatcher-${exchange}.subscribe-all`;
};

export const getExwatcherUnsubscribeAllEventName = (exchange: string) => {
    if (!Object.values(EXCHANGES).includes(exchange)) throw new Error(`Exchange ${exchange} is not supported`);
    return `in-exwatcher-${exchange}.unsubscribe-all`;
};

export const getExwatcherImporterStatusEventName = (exchange: string) => {
    if (!Object.values(EXCHANGES).includes(exchange)) throw new Error(`Exchange ${exchange} is not supported`);
    return `in-exwatcher-${exchange}.importer-status`;
};

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
    timeframes: ValidTimeframe[];
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
    available?: number;
}

export interface ExwatcherErrorEvent {
    exchange: string;
    asset: string;
    currency: string;
    exwatcherId: string;
    timestamp: string;
    error: string;
}
