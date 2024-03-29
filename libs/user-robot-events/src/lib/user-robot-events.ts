import { ISO_DATE_REGEX } from "@cryptuoso/helpers";
import { SignalEvent, TradeAction } from "@cryptuoso/market";
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
    CONFIRM_TRADE = "in-user-robot-runner.confirm-trade",
    START_PORTFOLIO = "in-user-robot-runner.start-portfolio",
    STOP_PORTFOLIO = "in-user-robot-runner.stop-portfolio",
    SYNC_PORTFOLIO_ROBOTS = "in-user-robot-runner.sync-portfolio-robots",
    SYNC_SIGNAL_PORTFOLIO_ROBOTS = "in-user-robot-runner.sync-signal-portfolio-robots", //TODO: replace
    SYNC_USER_PORTFOLIO_ROBOTS = "in-user-robot-runner.sync-user-portfolio-robots",
    SYNC_SIGNAL_SUBSCRIPTION_ROBOTS = "in-user-robot-runner.sync-signal-subscription-robots", //TODO: replace
    SYNC_USER_PORTFOLIO_DEDICATED_ROBOTS = "in-user-robot-runner.sync-user-portfolio-d-robots",
    STOP_USER_PORTFOLIO_DEDICATED_ROBOTS = "in-user-robot-runner.stop-user-portfolio-d-robots"
}

export const USER_ROBOT_WORKER_TOPIC = "out-user-robot-worker";

export const enum UserRobotWorkerEvents {
    STARTED = "out-user-robot-worker.started",
    STARTING = "out-user-robot-worker.starting",
    STOPPED = "out-user-robot-worker.stopped",
    PAUSED = "out-user-robot-worker.paused",
    ERROR = "out-user-robot-worker.error",
    STARTED_PORTFOLIO = "out-user-robot-worker.started-portfolio",
    STOPPED_PORTFOLIO = "out-user-robot-worker.stopped-portfolio",
    ERROR_PORTFOLIO = "out-user-robot-worker.error-portfolio"
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
    [UserRobotRunnerEvents.CONFIRM_TRADE]: {
        userPositionId: "uuid",
        cancel: { type: "boolean", optional: true, default: false }
    },
    [UserRobotRunnerEvents.START_PORTFOLIO]: RunnerSchema,
    [UserRobotRunnerEvents.STOP_PORTFOLIO]: RunnerSchema,
    [UserRobotRunnerEvents.SYNC_PORTFOLIO_ROBOTS]: {
        exchange: { type: "string", optional: true }
    },
    [UserRobotRunnerEvents.SYNC_SIGNAL_PORTFOLIO_ROBOTS]: {
        //TODO: replace
        exchange: { type: "string", optional: true }
    },
    [UserRobotRunnerEvents.SYNC_USER_PORTFOLIO_ROBOTS]: {
        userPortfolioId: "uuid"
    },
    [UserRobotRunnerEvents.SYNC_SIGNAL_SUBSCRIPTION_ROBOTS]: {
        //TODO: replace
        signalSubscriptionId: "uuid"
    },
    [UserRobotRunnerEvents.STOP_USER_PORTFOLIO_DEDICATED_ROBOTS]: {
        userPortfolioId: "uuid"
    },
    [UserRobotRunnerEvents.SYNC_USER_PORTFOLIO_DEDICATED_ROBOTS]: {
        userPortfolioId: "uuid"
    }
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
    id?: string;
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

export interface UserRobotRunnerSyncUserPortfolioDedicatedRobots {
    userPortfolioId: string;
}

export interface UserRobotRunnerStopUserPortfolioDedicatedRobots {
    userPortfolioId: string;
}

export const StatusSchema = {
    userRobotId: "uuid",
    timestamp: { type: "string", pattern: ISO_DATE_REGEX },
    message: { type: "string", optional: true },
    status: { type: "enum", values: [UserRobotStatus.started, UserRobotStatus.stopped, UserRobotStatus.paused] }
};

export const PortfolioStatusSchema = {
    userPortfolioId: "uuid",
    timestamp: { type: "string", pattern: ISO_DATE_REGEX },
    message: { type: "string", optional: true },
    status: { type: "string" }
};

export const UserRobotWorkerSchema = {
    [UserRobotWorkerEvents.STARTED]: StatusSchema,
    [UserRobotWorkerEvents.STARTING]: StatusSchema,
    [UserRobotWorkerEvents.STOPPED]: StatusSchema,
    [UserRobotWorkerEvents.PAUSED]: StatusSchema,
    [UserRobotWorkerEvents.ERROR]: {
        userRobotId: "uuid",
        timestamp: { type: "string", pattern: ISO_DATE_REGEX },
        error: "string",
        job: { type: "object", optional: true }
    },
    [UserRobotWorkerEvents.STARTED_PORTFOLIO]: PortfolioStatusSchema,
    [UserRobotWorkerEvents.STOPPED_PORTFOLIO]: PortfolioStatusSchema,
    [UserRobotWorkerEvents.ERROR_PORTFOLIO]: PortfolioStatusSchema
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
    job?: UserRobotJob;
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
