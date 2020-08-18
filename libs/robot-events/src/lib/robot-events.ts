import { Timeframe, ValidTimeframe, TradeAction, OrderType, SignalInfo, SignalType } from "@cryptuoso/market";
import { ISO_DATE_REGEX } from "@cryptuoso/helpers";

export const enum RobotWorkerEvents {
    LOG = "out-robot-worker.log",
    SIGNAL_ALERT = "out-robot-worker.signal-alert",
    SIGNAL_TRADE = "out-robot-worker.signal-trade",
    STARTED = "out-robot-worker.started",
    STARTING = "out-robot-worker.starting",
    STOPPED = "out-robot-worker.stopped",
    UPDATED = "out-robot-worker.updated",
    PAUSED = "out-robot-worker.paused",
    RESUMED = "out-robot-worker.resumed",
    FAILED = "out-robot-worker.failed",
    ERROR = "out-robot-worker.error"
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

export const RobotSchema = {
    [RobotWorkerEvents.LOG]: {
        $$root: true,
        type: "object"
    },
    [RobotWorkerEvents.SIGNAL_ALERT]: {
        ...SignalSchema,
        type: { type: "equal", value: SignalType.alert, strict: true }
    },
    [RobotWorkerEvents.SIGNAL_TRADE]: {
        ...SignalSchema,
        type: { type: "equal", value: SignalType.trade, strict: true },
        positionBarsHeld: { type: "number", optional: true }
    },
    [RobotWorkerEvents.STARTED]: StatusSchema,
    [RobotWorkerEvents.STARTING]: StatusSchema,
    [RobotWorkerEvents.STOPPED]: StatusSchema,
    [RobotWorkerEvents.UPDATED]: StatusSchema,
    [RobotWorkerEvents.PAUSED]: StatusSchema,
    [RobotWorkerEvents.RESUMED]: StatusSchema,
    [RobotWorkerEvents.FAILED]: { ...StatusSchema, error: "string" }
};

export interface Signal extends SignalInfo {
    id: string;
    robotId: string;
    exchange: string;
    asset: string;
    currency: string;
    timeframe: ValidTimeframe;
    timestamp: string;
}
