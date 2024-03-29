import { ValidTimeframe } from "@cryptuoso/market";

export const enum ExwatcherStatus {
    pending = "pending",
    importing = "importing",
    imported = "imported",
    subscribing = "subscribing",
    subscribed = "subscribed",
    unsubscribed = "unsubscribed",
    failed = "failed"
}

export interface Exwatcher {
    id: string;
    exchange: string;
    asset: string;
    currency: string;
    status: ExwatcherStatus;
    timeframes: ValidTimeframe[];
    importerId: string;
    importStartedAt: string;
    error?: string;
    locked?: boolean;
}

export interface Trade {
    amount: number; // amount of base currency
    price: number; // float price in quote currency
    timestamp: number; // Unix timestamp in milliseconds
}
