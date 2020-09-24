import { OrderType, TradeAction } from "./market";
import { ValidTimeframe } from "./timeframe";

export const enum PositionDirection {
    long = "long",
    short = "short"
}

export const enum RobotPositionStatus {
    new = "new",
    open = "open",
    closed = "closed"
}

export const enum RobotTradeStatus {
    new = "new",
    open = "open",
    closed = "closed"
}

export interface BasePosition {
    id?: string;
    timeframe?: ValidTimeframe;
    prefix?: string;
    code?: string;
    parentId?: string;
    direction?: PositionDirection;
    status?: RobotPositionStatus;
    entryStatus?: RobotTradeStatus;
    entryPrice?: number;
    entryDate?: string;
    entryOrderType?: OrderType;
    entryAction?: TradeAction;
    entryCandleTimestamp?: string;
    exitStatus?: RobotTradeStatus;
    exitPrice?: number;
    exitDate?: string;
    exitOrderType?: OrderType;
    exitAction?: TradeAction;
    exitCandleTimestamp?: string;
    profit?: number;
    barsHeld?: number;
    fee?: number;
    volume?: number;
}
