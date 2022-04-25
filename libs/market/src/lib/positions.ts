import { percentBetween, round } from "@cryptuoso/helpers";
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
    amountInCurrency?: number;
    volume?: number;
    worstProfit?: number;
    maxPrice?: number;
    profit?: number;
    barsHeld?: number;
    fee?: number;
    margin?: number;
    emulated?: boolean;
    meta?: {
        portfolioShare?: number;
        currentBalance?: number;
        prevBalance?: number;
    };
    minAmountCurrency?: number;
}

export const calcPositionProfit = (
    direction: PositionDirection,
    entryPrice: number,
    exitPrice: number,
    volume: number,
    feeRate = 0
): number => {
    let profit: number;
    const entryBalance = entryPrice * volume;
    const entryFee = entryPrice * volume * feeRate;
    const exitBalance = exitPrice * volume - exitPrice * volume * feeRate;
    const exitFee = exitPrice * volume * feeRate;
    const fee = entryFee + exitFee;
    if (direction === "long") {
        profit = exitBalance - entryBalance;
    } else {
        profit = entryBalance - exitBalance;
    }
    profit = round(profit - fee, 6);

    return profit;
};

export const calcPositionProfitPercent = (
    direction: PositionDirection,
    entryPrice: number,
    exitPrice: number,
    volume: number,
    feeRate = 0
): number => {
    let profit: number;
    const entryBalance = entryPrice * volume;
    const entryFee = entryPrice * volume * feeRate;
    const exitBalance = exitPrice * volume - exitPrice * volume * feeRate;
    const exitFee = exitPrice * volume * feeRate;

    profit = percentBetween(entryBalance - entryFee, exitBalance - exitFee);

    if (direction === "short") {
        profit = -profit;
    }

    return round(profit, 2);
};
