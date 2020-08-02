import { ISO_DATE_REGEX } from "@cryptuoso/helpers";
import { Timeframe, ValidTimeframe } from "@cryptuoso/market";
import { Status, BacktesterSettings } from "@cryptuoso/backtester-state";
import { RobotSettings } from "@cryptuoso/robot-state";

export const enum BacktesterRunnerEvents {
    START = "in-backtester-runner.start",
    STOP = "in-backtester-runner.stop"
}

export const enum BacktesterWorkerEvents {
    CANCEL = "in-backtester-worker.cancel",
    FINISHED = "out-backtester-worker.finished",
    FAILED = "out-backtester-worker.failed"
}

export const BacktesterRunnerSchema = {
    [BacktesterRunnerEvents.START]: {
        id: {
            type: "uuid",
            optional: true
        },
        robotId: {
            type: "uuid",
            optional: true
        },
        robotParams: {
            type: "object",
            optional: true,
            strict: true,
            props: {
                exchange: {
                    type: "string",
                    optional: true
                },
                asset: {
                    type: "string",
                    optional: true
                },
                currency: {
                    type: "string",
                    optional: true
                },
                timeframe: {
                    type: "number",
                    enum: Timeframe.validArray
                },
                strategyName: {
                    type: "string",
                    optional: true
                }
            }
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
        settings: {
            type: "object",
            optional: true,
            strict: true,
            props: {
                local: {
                    type: "boolean",
                    optional: true,
                    default: false
                },
                populateHistory: {
                    type: "boolean",
                    optional: true,
                    default: false
                },
                savePositions: {
                    type: "boolean",
                    optional: true,
                    default: true
                },
                saveLogs: {
                    type: "boolean",
                    optional: true,
                    default: false
                }
            }
        },
        robotSettings: {
            type: "object",
            optional: true,
            strict: true,
            props: {
                strategyParameters: "object",
                volume: { type: "number", integer: true },
                requiredHistoryMaxBars: { type: "number", integer: true }
            }
        }
    },
    [BacktesterRunnerEvents.STOP]: {
        id: {
            type: "uuid"
        }
    }
};

export const BacktesterWorkerSchema = {
    [BacktesterWorkerEvents.CANCEL]: {
        id: "uuid"
    },
    [BacktesterWorkerEvents.FINISHED]: {
        id: "uuid",
        robotId: "uuid",
        status: "string"
    },
    [BacktesterWorkerEvents.FAILED]: {
        id: "uuid",
        robotId: "uuid",
        status: "string",
        error: { type: "string", optional: true }
    }
};

export interface BacktesterRunnerStart {
    id?: string;
    robotId?: string;
    robotParams?: {
        exchange: string;
        asset: string;
        currency: string;
        timeframe: ValidTimeframe;
        strategyName: string;
    };
    dateFrom?: string;
    dateTo?: string;
    settings?: BacktesterSettings;
    robotSettings?: RobotSettings;
}

export interface BacktesterRunnerStop {
    id: string;
}

export interface BacktesterWorkerCancel {
    id: string;
}

export interface BacktesterWorkerFinished {
    id: string;
    robotId?: string;
    status: Status;
}

export interface BacktesterWorkerFailed {
    id: string;
    robotId?: string;
    error?: string;
}
