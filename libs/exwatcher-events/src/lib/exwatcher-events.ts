export const enum ExwatcherWorkerEvents {
    SUBSCRIBE = "in-exwatcher-worker.subscribe",
    SUBSCRIBE_ALL = "in-exwatcher-worker.subscribe-all",
    UNSUBSCRIBE_ALL = "in-exwatcher-worker.unsubscribe-all"
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
