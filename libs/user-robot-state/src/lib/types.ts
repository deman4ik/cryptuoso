import { GenericObject } from "@cryptuoso/helpers";
import { Order, PositionDirection, SignalEvent, TradeAction, TradeSettings, ValidTimeframe } from "@cryptuoso/market";
import { UserRobotSettings } from "@cryptuoso/robot-settings";
import { UserMarketState } from "@cryptuoso/market";
import { OrdersStatusEvent } from "@cryptuoso/connector-events";
import { UserPortfolioDB, UserPortfolioState } from "@cryptuoso/portfolio-state";
import { RobotState } from "@cryptuoso/robot-types";

export const enum UserPositionStatus {
    delayed = "delayed",
    new = "new",
    open = "open",
    canceled = "canceled",
    closed = "closed",
    closedAuto = "closedAuto"
}

export const enum UserPositionOrderStatus {
    new = "new",
    open = "open",
    partial = "partial",
    closed = "closed",
    canceled = "canceled"
}

export const enum UserPositionJob {
    open = "open",
    cancel = "cancel",
    close = "close"
}

export interface UserPositionInternalState {
    entrySlippageCount: number;
    exitSlippageCount: number;
    delayedSignal?: SignalEvent;
}

export interface UserPositionDB {
    id: string;
    prefix: string;
    code: string;
    positionCode: string;
    positionId: string;
    userRobotId: string;
    userPortfolioId: string;
    userId: string;
    exchange: string;
    asset: string;
    currency: string;
    status: UserPositionStatus;
    parentId?: string;
    direction: PositionDirection;
    entryAction?: TradeAction;
    entryStatus?: UserPositionOrderStatus;
    entrySignalPrice?: number;
    entryPrice?: number;
    entryDate?: string;
    entryCandleTimestamp?: string;
    entryVolume?: number;
    entryExecuted?: number;
    entryRemaining?: number;
    exitAction?: TradeAction;
    exitStatus?: UserPositionOrderStatus;
    exitSignalPrice?: number;
    exitPrice?: number;
    exitDate?: string;
    exitCandleTimestamp?: string;
    exitVolume?: number;
    exitExecuted?: number;
    exitRemaining?: number;
    internalState: UserPositionInternalState;
    reason?: string; //TODO ENUM
    profit?: number;
    barsHeld?: number;
    nextJobAt?: string;
    nextJob?: UserPositionJob;
    meta?: {
        currentBalance?: number;
    };
}

export interface UserPositionState extends UserPositionDB {
    timeframe: ValidTimeframe;
    userExAccId: string;
    tradeSettings: TradeSettings;
    entryOrders?: Order[];
    exitOrders?: Order[];
    settings?: UserRobotDB["settings"];
}

export interface UserRobotInternalState {
    latestSignal?: SignalEvent;
    posLastNumb?: GenericObject<number>;
}

export const enum UserRobotStatus {
    starting = "starting",
    started = "started",
    stopping = "stopping",
    stopped = "stopped",
    paused = "paused"
}

export interface UserRobotDB {
    id: string;
    userExAccId?: string;
    userId: string;
    robotId: string;
    userPortfolioId?: string;
    internalState: UserRobotInternalState;
    robotState?: RobotState;
    status: UserRobotStatus;
    allocation: "shared" | "dedicated";
    startedAt?: string;
    stoppedAt?: string;
    message?: string;
    settings: {
        volume: number;
        active?: boolean;
        share?: number;
    };
}

export interface UserRobotState extends UserRobotDB {
    exchange: string;
    asset: string;
    currency: string;
    timeframe: ValidTimeframe;
    tradeSettings: TradeSettings;
    positions: UserPositionState[];
    userPortfolio?: {
        status?: UserPortfolioDB["status"];
        settings?: UserPortfolioState["settings"];
    };
    currentPrice?: number;
    limits?: UserMarketState["limits"]["userRobot"];
    precision?: { amount: number; price: number };
}

export interface UserRobotStateExt extends UserRobotState {
    totalBalanceUsd: number;
    userRobotSettings?: UserRobotSettings; //TODO: deprecate
}

export const enum UserRobotJobType {
    stop = "stop",
    pause = "pause",
    signal = "signal",
    order = "order",
    disable = "disable"
}

export interface UserRobotJob {
    id?: string;
    userRobotId: string;
    type: UserRobotJobType;
    data?: SignalEvent | OrdersStatusEvent | { message?: string };
    allocation: "shared" | "dedicated";
    retries?: number;
    error?: string;
}

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
    positionId?: string;
    userPositionId: string;
    userPortfolioId?: string;
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

export const enum Queues {
    userRobot = "user-robot",
    userRobotRunner = "user-robot-runner"
}

export const enum UserRobotRunnerJobType {
    idleUserOrders = "idleUserOrders",
    idleUserRobotJobs = "idleUserRobotJobs",
    checkUserPortfolioRobots = "checkUserPortfolioRobots"
}
