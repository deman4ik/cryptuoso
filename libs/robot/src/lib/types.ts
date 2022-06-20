export const enum ExwatcherStatus {
    pending = "pending",
    importing = "importing",
    imported = "imported",
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
