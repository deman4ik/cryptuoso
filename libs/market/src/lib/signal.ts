import { TradeAction } from "./market";
import { OrderType } from "./orders";
import { ValidTimeframe } from "./timeframe";

export const enum SignalType {
    alert = "alert",
    trade = "trade"
}

export interface TradeInfo {
    action: TradeAction;
    orderType: OrderType;
    price?: number;
}

export interface AlertInfo extends TradeInfo {
    candleTimestamp: string;
}

export interface SignalInfo extends AlertInfo {
    type: SignalType;
    positionId: string;
    positionPrefix: string;
    positionCode: string;
    positionParentId?: string;
    emulated?: boolean;
    margin?: number;
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

export interface ActiveAlert extends SignalEvent {
    activeFrom: string;
    activeTo: string;
}
