import { Timeframe, ValidTimeframe, TradeAction, OrderType, SignalInfo, SignalType } from "@cryptuoso/market";
import { CANDLES_RECENT_AMOUNT, ISO_DATE_REGEX } from "@cryptuoso/helpers";
import { RobotSettings, RobotSettingsSchema, StrategySettings } from "@cryptuoso/robot-settings";

export const enum RobotRunnerEvents {
    CREATE = "in-robot-runner.create",
    DELETE = "in-robot-runner.delete",
    START = "in-robot-runner.start",
    STOP = "in-robot-runner.stop",
    PAUSE = "in-robot-runner.pause"
}

export const enum RobotWorkerEvents {
    LOG = "out-robot-worker.log",
    STARTED = "out-robot-worker.started",
    STARTING = "out-robot-worker.starting",
    STOPPED = "out-robot-worker.stopped",
    PAUSED = "out-robot-worker.paused",
    ERROR = "out-robot-worker.error"
}

export const enum SignalEvents {
    ALERT = "signal.alert",
    TRADE = "signal.trade"
}

const SignalSchema = {
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

const StatusSchema = {
    robotId: "uuid"
};

const RunnerSchema = {
    robotId: "uuid"
};

export const RobotRunnerSchema = {
    [RobotRunnerEvents.CREATE]: {
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
        strategyName: {
            type: "string"
        },
        mod: {
            type: "string",
            optional: true
        },
        strategySettings: {
            type: "object",
            rops: {
                requiredHistoryMaxBars: { type: "number", integer: true, default: CANDLES_RECENT_AMOUNT }
            }
        },
        robotSettings: RobotSettingsSchema
    },
    [RobotRunnerEvents.DELETE]: RunnerSchema,
    [RobotRunnerEvents.START]: RunnerSchema,
    [RobotRunnerEvents.STOP]: RunnerSchema,
    [RobotRunnerEvents.PAUSE]: RunnerSchema
};

export const RobotWorkerSchema = {
    [RobotWorkerEvents.LOG]: {
        $$root: true,
        type: "object"
    },
    [SignalEvents.ALERT]: {
        ...SignalSchema,
        type: { type: "equal", value: SignalType.alert, strict: true }
    },
    [SignalEvents.TRADE]: {
        ...SignalSchema,
        type: { type: "equal", value: SignalType.trade, strict: true }
    },
    [RobotWorkerEvents.STARTED]: StatusSchema,
    [RobotWorkerEvents.STARTING]: StatusSchema,
    [RobotWorkerEvents.STOPPED]: StatusSchema,
    [RobotWorkerEvents.PAUSED]: StatusSchema,
    [RobotWorkerEvents.ERROR]: { ...StatusSchema, error: "string" }
};

export interface RobotRunnerCreate {
    exchange: string;
    asset: string;
    currency: string;
    timeframe: ValidTimeframe;
    strategyName: string;
    strategySettings: StrategySettings;
    robotSettings: RobotSettings;
}

export interface RobotRunnerDelete {
    id: "string";
}

export interface RobotRunnerStart {
    id: "string";
}

export interface RobotRunnerStop {
    id: "string";
}

export interface RobotRunnerPause {
    id: "string";
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
