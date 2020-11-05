import { TradeAction, OrderType } from "@cryptuoso/market";
import { ValidTimeframe } from "./timeframe";

export const enum SignalType {
    alert = "alert",
    trade = "trade"
}

export interface AlertInfo {
    action: TradeAction;
    orderType: OrderType;
    price?: number;
    candleTimestamp: string;
}

export interface SignalInfo extends AlertInfo {
    type: SignalType;
    positionId: string;
    positionPrefix: string;
    positionCode: string;
    positionParentId?: string;
}

export interface SignalEvent extends SignalInfo {
    id: string;
    robotId: string;
    exchange: string;
    asset: string;
    currency: string;
    timeframe: ValidTimeframe;
    timestamp: string;
}
