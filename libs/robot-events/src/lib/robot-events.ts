import { Timeframe, ValidTimeframe, TradeAction, OrderType, SignalInfo, SignalType, Candle } from "@cryptuoso/market";
import { CANDLES_RECENT_AMOUNT, ISO_DATE_REGEX } from "@cryptuoso/helpers";
import { RobotSettings, RobotSettingsSchema, StrategySettings } from "@cryptuoso/robot-settings";

export const enum RobotRunnerEvents {
    CREATE = "in-robot-runner.create",
    START = "in-robot-runner.start",
    STOP = "in-robot-runner.stop",
    PAUSE = "in-robot-runner.pause"
}

export const ROBOT_WORKER_TOPIC = "out-robot-worker";

export const enum RobotWorkerEvents {
    LOG = "out-robot-worker.log",
    STARTED = "out-robot-worker.started",
    STARTING = "out-robot-worker.starting",
    STOPPED = "out-robot-worker.stopped",
    PAUSED = "out-robot-worker.paused",
    ERROR = "out-robot-worker.error"
}

export const SIGNAL_TOPIC = "signal";

export const enum SignalEvents {
    ALERT = "signal.alert",
    TRADE = "signal.trade"
}

const SignalsSchema = {
    id: "uuid",
    robotId: "uuid",
    exchange: "string",
    asset: "string",
    currency: "string",
    timeframe: { type: "number", enum: Timeframe.validArray },
    timestamp: {
        type: "string",
        pattern: ISO_DATE_REGEX,
        optional: true
    },
    action: {
        type: "string",
        enum: [TradeAction.long, TradeAction.short, TradeAction.closeLong, TradeAction.closeShort]
    },
    orderType: { type: "string", enum: [OrderType.stop, OrderType.limit, OrderType.market] },
    price: { type: "number" },
    candleTimestamp: {
        type: "string",
        pattern: ISO_DATE_REGEX,
        optional: true
    },
    positionId: "uuid",
    positionPrefix: "string",
    positionCode: "string",
    positionParentId: { type: "uuid", optional: true }
};

export const StatusSchema = {
    robotId: "uuid",
    status: "string"
};

const RunnerSchema = {
    robotId: "uuid"
};

export const RobotRunnerSchema = {
    [RobotRunnerEvents.CREATE]: {
        entities: {
            type: "array",
            items: {
                type: "object",
                props: {
                    exchange: {
                        type: "string"
                    },
                    asset: {
                        type: "string"
                    },
                    currency: {
                        type: "string"
                    },
                    timeframe: {
                        type: "number",
                        enum: Timeframe.validArray
                    },
                    strategy: {
                        type: "string"
                    },
                    mod: {
                        type: "string",
                        optional: true
                    },
                    available: { type: "number", integer: true, default: 5 },
                    signals: { type: "boolean", default: false },
                    trading: { type: "boolean", default: false },
                    strategySettings: {
                        type: "object",
                        props: {
                            requiredHistoryMaxBars: { type: "number", integer: true, default: CANDLES_RECENT_AMOUNT }
                        }
                    },
                    robotSettings: RobotSettingsSchema
                }
            }
        }
    },
    [RobotRunnerEvents.START]: {
        robotId: "uuid",
        dateFrom: {
            type: "string",
            pattern: ISO_DATE_REGEX,
            optional: true
        }
    },
    [RobotRunnerEvents.STOP]: RunnerSchema,
    [RobotRunnerEvents.PAUSE]: RunnerSchema
};

export const RobotWorkerSchema = {
    [RobotWorkerEvents.LOG]: {
        robotId: "uuid"
    },
    [RobotWorkerEvents.STARTED]: StatusSchema,
    [RobotWorkerEvents.STARTING]: StatusSchema,
    [RobotWorkerEvents.STOPPED]: StatusSchema,
    [RobotWorkerEvents.PAUSED]: StatusSchema,
    [RobotWorkerEvents.ERROR]: { robotId: "uuid", error: "string" }
};

export const SignalSchema = {
    [SignalEvents.ALERT]: {
        ...SignalsSchema,
        type: { type: "equal", value: SignalType.alert, strict: true }
    },
    [SignalEvents.TRADE]: {
        ...SignalsSchema,
        type: { type: "equal", value: SignalType.trade, strict: true }
    }
};

export interface RobotRunnerCreateProps {
    exchange: string;
    asset: string;
    currency: string;
    timeframe: ValidTimeframe;
    strategy: string;
    mod?: string;
    available: number;
    signals: boolean;
    trading: boolean;
    strategySettings: StrategySettings;
    robotSettings: RobotSettings;
}

export interface RobotRunnerCreate {
    entities: RobotRunnerCreateProps[];
}

export interface RobotRunnerDelete {
    robotId: string;
}

export interface RobotRunnerStart {
    robotId: string;
    dateFrom?: string;
}

export interface RobotRunnerStop {
    robotId: string;
}

export interface RobotRunnerPause {
    robotId: string;
}

export interface Signal extends SignalInfo {
    id: string;
    robotId: string;
    exchange: string;
    asset: string;
    currency: string;
    timeframe: ValidTimeframe;
    timestamp: string;
}

export interface RobotWorkerError {
    [key: string]: any;
    robotId: string;
    error: string;
}

export interface RobotWorkerLog {
    [key: string]: any;
    robotId: string;
    candle: Candle;
}

export interface RobotWorkerStatus {
    [key: string]: any;
    robotId: string;
    status: string;
}
