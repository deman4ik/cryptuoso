import { GenericObject } from "@cryptuoso/helpers";
import { TradeAction } from "@cryptuoso/market";
import { UserPositionOrderStatus, UserPositionStatus } from "@cryptuoso/user-robot-state";

export const enum UserRobotRunnerEvents {
    START = "in-user-robot-runner.start",
    STOP = "in-user-robot-runner.stop",
    PAUSE = "in-user-robot-runner.pause",
    RESUME = "in-user-robot-runner.resume"
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

interface UserRobotEventData extends GenericObject<any> {
    userRobotId: string;
}

export interface UserTradeEvent extends UserRobotEventData {
    id: string;
    code: string;
    exchange: string;
    asset: string;
    currency: string;
    userRobotId: string;
    userId: string;
    status: UserPositionStatus;
    entryAction?: TradeAction;
    entryStatus?: UserPositionOrderStatus;
    entrySignalPrice?: number;
    entryPrice?: number;
    entryDate?: string;
    entryCandleTimestamp?: string;
    entryExecuted?: number;
    exitAction?: TradeAction;
    exitStatus?: UserPositionOrderStatus;
    exitPrice?: number;
    exitDate?: string;
    exitCandleTimestamp?: string;
    exitExecuted?: number;
    reason?: string; //TODO ENUM
    profit?: number;
    barsHeld?: number;
}
