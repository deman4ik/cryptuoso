import { ISO_DATE_REGEX, CANDLES_RECENT_AMOUNT } from "@cryptuoso/helpers";
import { Timeframe, ValidTimeframe } from "@cryptuoso/market";
import { ImportType, Status } from "@cryptuoso/importer-state";

export const enum ImporterRunnerEvents {
    START = "in-importer-runner.start",
    STOP = "in-importer-runner.stop"
}

export const enum ImporterWorkerEvents {
    CANCEL = "in-importer-worker.cancel",
    FINISHED = "out-importer-worker.finished",
    FAILED = "out-importer-worker.failed"
}

export const ImporterRunnerSchema = {
    [ImporterRunnerEvents.START]: {
        id: {
            type: "uuid",
            optional: true
        },
        exchange: {
            type: "string"
        },
        asset: {
            type: "string"
        },
        currency: {
            type: "string"
        },
        type: {
            type: "enum",
            values: ["recent", "history"]
        },
        timeframes: {
            type: "array",
            enum: Timeframe.validArray,
            empty: false,
            default: Timeframe.validArray
        },
        dateFrom: {
            type: "string",
            pattern: ISO_DATE_REGEX,
            optional: true
        },
        dateTo: {
            type: "string",
            pattern: ISO_DATE_REGEX,
            optional: true
        },
        amount: {
            type: "number",
            integer: true,
            default: CANDLES_RECENT_AMOUNT
        }
    },
    [ImporterRunnerEvents.STOP]: {
        id: {
            type: "uuid"
        }
    }
};

export const ImporterWorkerSchema = {
    [ImporterWorkerEvents.CANCEL]: {
        id: "uuid"
    },
    [ImporterWorkerEvents.FINISHED]: {
        id: "uuid",
        type: {
            type: "enum",
            values: ["recent", "history"]
        },
        exchange: "string",
        asset: "string",
        currency: "string",
        status: "string"
    },
    [ImporterWorkerEvents.FAILED]: {
        id: "uuid",
        type: {
            type: "enum",
            values: ["recent", "history"]
        },
        exchange: "string",
        asset: "string",
        currency: "string",
        error: { type: "string", optional: true }
    }
};

export interface ImporterRunnerStart {
    id?: string;
    exchange: string;
    asset: string;
    currency: string;
    type: ImportType;
    timeframes?: ValidTimeframe[];
    dateFrom?: string;
    dateTo?: string;
    amount?: number;
}

export interface ImporterRunnerStop {
    id: string;
}

export interface ImporterWorkerCancel {
    id: string;
}

export interface ImporterWorkerFinished {
    id: string;
    exchange: string;
    asset: string;
    currency: string;
    type: ImportType;
    status: Status;
}

export interface ImporterWorkerFailed {
    id: string;
    exchange: string;
    asset: string;
    currency: string;
    type: ImportType;
    error?: string;
}
