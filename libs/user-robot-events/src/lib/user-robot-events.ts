import { ISO_DATE_REGEX } from "@cryptuoso/helpers";
import { TradeAction } from "@cryptuoso/market";
import { UserPositionOrderStatus, UserPositionStatus, UserRobotStatus } from "@cryptuoso/user-robot-state";

export const USER_ROBOT_RUNNER_TOPIC = "in-user-robot-runner";

export const enum UserRobotRunnerEvents {
    START = "in-user-robot-runner.start",
    STOP = "in-user-robot-runner.stop",
    PAUSE = "in-user-robot-runner.pause",
    RESUME = "in-user-robot-runner.resume"
}

export const USER_ROBOT_WORKER_TOPIC = "out-user-robot-worker";

export const enum UserRobotWorkerEvents {
    STARTED = "out-user-robot-worker.started",
    STOPPED = "out-user-robot-worker.stopped",
    PAUSED = "out-user-robot-worker.paused",
    ERROR = "out-user-robot-worker.error"
}

export const USER_TRADE_TOPIC = "user-trade";

export const enum UserTradeEvents {
    TRADE = "user-trade.trade"
}

const RunnerSchema = {
    userRobotId: "uuid",
    message: { type: "string", optional: true }
};

const RunnerPauseSchema = {
    userRobotId: { type: "uuid", optional: true },
    userExAccId: { type: "string", optional: true },
    message: { type: "string", optional: true }
};

export const UserRobotRunnerSchema = {
    [UserRobotRunnerEvents.START]: RunnerSchema,
    [UserRobotRunnerEvents.STOP]: RunnerSchema,
    [UserRobotRunnerEvents.PAUSE]: RunnerPauseSchema,
    [UserRobotRunnerEvents.RESUME]: RunnerPauseSchema
};

const StatusSchema = {
    userRobotId: "uuid",
    message: { type: "string", optional: true },
    status: { type: "enum", values: [UserRobotStatus.started, UserRobotStatus.stopped, UserRobotStatus.paused] }
};

export const UserRobotWorkerSchema = {
    [UserRobotWorkerEvents.STARTED]: StatusSchema,
    [UserRobotWorkerEvents.STOPPED]: StatusSchema,
    [UserRobotWorkerEvents.PAUSED]: StatusSchema
};

export const UserTradeSchema = {
    [UserTradeEvents.TRADE]: {
        id: "uuid",
        code: "string",
        exchange: "string",
        asset: "string",
        currency: "string",
        userRobotId: "uuid",
        userPositionId: "uuid",
        userId: "uuid",
        status: {
            type: "enum",
            values: [
                UserPositionStatus.new,
                UserPositionStatus.open,
                UserPositionStatus.closed,
                UserPositionStatus.canceled,
                UserPositionStatus.delayed,
                UserPositionStatus.closedAuto
            ]
        },
        entryAction: {
            type: "enum",
            values: [TradeAction.long, TradeAction.short, TradeAction.closeLong, TradeAction.closeShort],
            optional: true
        },
        entryStatus: {
            type: "enum",
            values: [
                UserPositionOrderStatus.new,
                UserPositionOrderStatus.open,
                UserPositionOrderStatus.closed,
                UserPositionOrderStatus.canceled,
                UserPositionOrderStatus.partial
            ],
            optional: true
        },
        entrySignalPrice: {
            type: "number",
            optional: true
        },
        entryPrice: {
            type: "number",
            optional: true
        },
        entryDate: {
            type: "string",
            pattern: ISO_DATE_REGEX,
            optional: true
        },
        entryCandleTimestamp: {
            type: "string",
            pattern: ISO_DATE_REGEX,
            optional: true
        },
        entryExecuted: {
            type: "number",
            optional: true
        },
        exitAction: {
            type: "enum",
            values: [TradeAction.long, TradeAction.short, TradeAction.closeLong, TradeAction.closeShort],
            optional: true
        },
        exitStatus: {
            type: "enum",
            values: [
                UserPositionOrderStatus.new,
                UserPositionOrderStatus.open,
                UserPositionOrderStatus.closed,
                UserPositionOrderStatus.canceled,
                UserPositionOrderStatus.partial
            ],
            optional: true
        },
        exitSignalPrice: {
            type: "number",
            optional: true
        },
        exitPrice: {
            type: "number",
            optional: true
        },
        exitDate: {
            type: "string",
            pattern: ISO_DATE_REGEX,
            optional: true
        },
        exitCandleTimestamp: {
            type: "string",
            pattern: ISO_DATE_REGEX,
            optional: true
        },
        exitExecuted: {
            type: "number",
            optional: true
        },
        reason: {
            type: "string",
            optional: true
        },
        profit: {
            type: "number",
            optional: true
        },
        barsHeld: {
            type: "number",
            optional: true
        }
    }
};
