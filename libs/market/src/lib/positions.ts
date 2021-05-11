import { round } from "@cryptuoso/helpers";
import { TradeAction } from "./market";
import { OrderType } from "./orders";
import { ValidTimeframe } from "./timeframe";

export type PositionDirection = "long" | "short";

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
    robotId?: string;
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
    volume?: number;
    worstProfit?: number;
    maxPrice?: number;
    profit?: number;
    barsHeld?: number;
    fee?: number;
    margin?: number;
}

export const calcPositionProfit = (
    direction: PositionDirection,
    entryPrice: number,
    exitPrice: number,
    volume: number,
    feeRate = 0
): number => {
    let profit: number;
    const entryBalance = entryPrice * volume - entryPrice * volume * feeRate;
    const exitBalance = exitPrice * volume - exitPrice * volume * feeRate;
    if (direction === "long") {
        profit = exitBalance - entryBalance;
    } else {
        profit = entryBalance - exitBalance;
    }
    profit = round(profit, 6);

    return profit;
};
