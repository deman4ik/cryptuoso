import { ISO_DATE_REGEX, CANDLES_RECENT_AMOUNT } from "@cryptuoso/helpers";
import { Timeframe, ValidTimeframe } from "@cryptuoso/market";
import { Status, BacktesterSettings } from "@cryptuoso/backtester-state";
import { RobotSettings, StrategySettings } from "@cryptuoso/robot-state";

export const enum BacktesterRunnerEvents {
    START = "in-backtester-runner.start",
    START_MANY = "in-backtester-runner.start-many",
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
        strategySettings: {
            type: "object",
            optional: true
        },
        robotSettings: {
            type: "object",
            optional: true,
            strict: true,
            props: {
                volume: { type: "number", integer: true },
                requiredHistoryMaxBars: { type: "number", integer: true, default: CANDLES_RECENT_AMOUNT }
            }
        }
    },
    [BacktesterRunnerEvents.START_MANY]: {
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
        strategySettings: {
            type: "array",
            items: {
                type: "object"
            }
        },
        robotSettings: {
            type: "object",
            optional: true,
            items: {
                type: "object",
                strict: true,
                props: {
                    volume: { type: "number", integer: true },
                    requiredHistoryMaxBars: { type: "number", integer: true, default: CANDLES_RECENT_AMOUNT }
                }
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
    settings: BacktesterSettings;
    strategySettings?: StrategySettings;
    robotSettings?: RobotSettings;
}

export interface BacktesterRunnerStartMany {
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
    settings: BacktesterSettings;
    strategySettings?: StrategySettings[]; //TODO settings generator
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
