import { ISO_DATE_REGEX } from "@cryptuoso/helpers";
import { TradeAction } from "@cryptuoso/market";
import { UserPortfolioDB } from "@cryptuoso/portfolio-state";
import {
    UserPositionOrderStatus,
    UserPositionStatus,
    UserRobotJob,
    UserRobotStatus
} from "@cryptuoso/user-robot-state";

export const USER_ROBOT_RUNNER_TOPIC = "in-user-robot-runner";

export const enum UserRobotRunnerEvents {
    START = "in-user-robot-runner.start",
    STOP = "in-user-robot-runner.stop",
    PAUSE = "in-user-robot-runner.pause",
    RESUME = "in-user-robot-runner.resume",
    START_PORTFOLIO = "in-user-robot-runner.start-portfolio",
    STOP_PORTFOLIO = "in-user-robot-runner.stop-portfolio"
}

export const USER_ROBOT_WORKER_TOPIC = "out-user-robot-worker";

export const enum UserRobotWorkerEvents {
    STARTED = "out-user-robot-worker.started",
    STOPPED = "out-user-robot-worker.stopped",
    PAUSED = "out-user-robot-worker.paused",
    ERROR = "out-user-robot-worker.error",
    STARTED_PORTFOLIO = "out-user-robot-worker.started-portfolio",
    STOPPED_PORTFOLIO = "out-user-robot-worker.stopped-portfolio"
}

export const USER_TRADE_TOPIC = "user-trade";

export const enum UserTradeEvents {
    TRADE = "user-trade.trade"
}

const RunnerSchema = {
    id: "uuid",
    message: { type: "string", optional: true }
};

const RunnerPauseSchema = {
    id: { type: "uuid", optional: true },
    userExAccId: { type: "uuid", optional: true },
    exchange: { type: "string", optional: true },
    message: { type: "string", optional: true }
};

export const UserRobotRunnerSchema = {
    [UserRobotRunnerEvents.START]: RunnerSchema,
    [UserRobotRunnerEvents.STOP]: RunnerSchema,
    [UserRobotRunnerEvents.PAUSE]: RunnerPauseSchema,
    [UserRobotRunnerEvents.RESUME]: RunnerPauseSchema,
    [UserRobotRunnerEvents.START_PORTFOLIO]: RunnerSchema,
    [UserRobotRunnerEvents.STOP_PORTFOLIO]: RunnerSchema
};

export interface UserRobotRunnerStart {
    id: string;
    message?: string;
}

export interface UserRobotRunnerStop {
    id: string;
    message?: string;
}

export interface UserRobotRunnerPause {
    id?: string;
    userExAccId?: string;
    exchange?: string;
    message?: string;
}

export interface UserRobotRunnerResume {
    id: string;
    userExAccId?: string;
    exchange?: string;
    message?: string;
}

export interface UserRobotRunnerStartPortfolio {
    id: string;
    message?: string;
}

export interface UserRobotRunnerStopPortfolio {
    id: string;
    message?: string;
}

export const StatusSchema = {
    userRobotId: "uuid",
    timestamp: { type: "string", pattern: ISO_DATE_REGEX },
    message: { type: "string", optional: true },
    status: { type: "enum", values: [UserRobotStatus.started, UserRobotStatus.stopped, UserRobotStatus.paused] }
};

export const UserRobotWorkerSchema = {
    [UserRobotWorkerEvents.STARTED]: StatusSchema,
    [UserRobotWorkerEvents.STOPPED]: StatusSchema,
    [UserRobotWorkerEvents.PAUSED]: StatusSchema,
    [UserRobotWorkerEvents.ERROR]: {
        userRobotId: "uuid",
        timestamp: { type: "string", pattern: ISO_DATE_REGEX },
        error: "string",
        job: { type: "object", optional: true }
    }
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

export interface UserRobotWorkerError {
    [key: string]: any;
    userRobotId: string;
    userPortfolioId?: string;
    timestamp: string;
    error: string;
    job: UserRobotJob;
}

export interface UserRobotWorkerStatus {
    [key: string]: any;
    userRobotId: string;
    userPortfolioId?: string;
    timestamp: string;
    status: UserRobotStatus;
    message?: string;
}

export interface UserPortfolioStatus {
    [key: string]: any;
    userPortfolioId: string;
    timestamp: string;
    status: UserPortfolioDB["status"];
    message?: string;
}
