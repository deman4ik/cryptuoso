import { Timeframe, ISO_DATE_REGEX, CANDLES_RECENT_AMOUNT, ValidTimeframe } from "@cryptuoso/helpers";
import { ImportType } from "@cryptuoso/importer-state";

export const enum InImporterRunnerEvents {
    START = "in-importer-runner.start",
    STOP = "in-importer-runner.stop"
}

export const enum InImporterWorkerEvents {
    PAUSE = "in-importer-worker.pause"
}

export const enum OutImporterWorkerEvents {
    FINISHED = "out-importer-worker.finished",
    FAILED = "out-importer-worker.failed"
}

export const ImporterRunnerSchema = {
    [InImporterRunnerEvents.START]: {
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
            optional: true,
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
            optional: true,
            default: CANDLES_RECENT_AMOUNT
        }
    },
    [InImporterRunnerEvents.STOP]: {
        id: {
            type: "uuid"
        }
    }
};

export const ImporterWorkerSchema = {
    [InImporterWorkerEvents.PAUSE]: {
        id: "uuid"
    },
    [OutImporterWorkerEvents.FINISHED]: {
        id: "uuid",
        type: {
            type: "enum",
            values: ["recent", "history"]
        },
        exchange: "string",
        asset: "string",
        currency: "string"
    },
    [OutImporterWorkerEvents.FAILED]: {
        id: "uuid",
        type: {
            type: "enum",
            values: ["recent", "history"]
        },
        exchange: "string",
        asset: "string",
        currency: "string",
        error: "string"
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

export interface ImporterWorkerPause {
    id: string;
}

export interface ImporterWorkerFinished {
    id: string;
    exchange: string;
    asset: string;
    currency: string;
    type: ImportType;
}

export interface ImporterWorkerFailed {
    id: string;
    exchange: string;
    asset: string;
    currency: string;
    type: ImportType;
    error: string;
}
