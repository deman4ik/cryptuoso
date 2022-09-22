import { ISO_DATE_REGEX, CANDLES_RECENT_AMOUNT } from "@cryptuoso/helpers";
import { Timeframe, ValidTimeframe } from "@cryptuoso/market";
import { Status, BacktesterSettings } from "@cryptuoso/backtester-state";
import { RobotSettings, RobotSettingsSchema, StrategySettings } from "@cryptuoso/robot-settings";

export const BACKTESTER_RUNNER_TOPIC = "in-backtester-runner";
export const IN_BACKTESTER_WORKER_TOPIC = "in-backtester-worker";
export const OUT_BACKTESTER_WORKER_TOPIC = "out-backtester-worker";

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
                    type: "enum",
                    values: Timeframe.validArray
                },
                strategy: {
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
                    default: false
                },
                populateHistory: {
                    type: "boolean",
                    default: false
                },
                saveSignals: {
                    type: "boolean",
                    default: true
                },
                savePositions: {
                    type: "boolean",
                    default: true
                },
                saveLogs: {
                    type: "boolean",
                    default: false
                }
            }
        },
        settingsRange: {
            type: "array",
            optional: true,
            items: {
                type: "object",
                props: {
                    context: { type: "enum", values: ["strategy", "robot"] },
                    prop: "string",
                    from: "number",
                    to: "number",
                    step: "number"
                }
            }
        },
        strategySettings: {
            type: "object",
            optional: true,
            props: {
                requiredHistoryMaxBars: { type: "number", integer: true, default: CANDLES_RECENT_AMOUNT }
            }
        },
        robotSettings: RobotSettingsSchema.map((s) => ({ ...s, optional: true }))
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
        strategy: string;
    };
    dateFrom?: string;
    dateTo?: string;
    settings: BacktesterSettings;
    settingsRange?: [{ context: "strategy" | "robot"; prop: string; from: number; to: number; step: number }];
    strategySettings?: StrategySettings;
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
