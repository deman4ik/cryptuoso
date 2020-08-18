import { TradeAction, OrderType } from "@cryptuoso/market";

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
    positionBarsHeld?: number;
}
