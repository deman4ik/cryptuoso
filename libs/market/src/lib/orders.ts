import { TradeAction } from "./market";

export const enum OrderType {
    stop = "stop",
    limit = "limit",
    market = "market",
    forceMarket = "forceMarket"
}

export const enum OrderDirection {
    buy = "buy",
    sell = "sell"
}

export const enum OrderStatus {
    new = "new",
    open = "open",
    closed = "closed",
    canceled = "canceled"
}

export const enum OrderJobType {
    create = "create",
    recreate = "recreate",
    cancel = "cancel",
    check = "check"
}

export interface OrderJob {
    type: OrderJobType;
    data?: {
        price: number;
    };
}

export interface OrderParams {
    orderTimeout: number;
    kraken?: {
        leverage?: number;
    };
    [key: string]: any;
}

export interface Order {
    id: string;
    userExAccId: string;
    userRobotId: string;
    positionId?: string;
    userPositionId: string;
    exchange: string;
    asset: string;
    currency: string;
    action: TradeAction;
    direction: OrderDirection;
    type: OrderType;
    signalPrice?: number;
    price?: number;
    volume: number;
    params: OrderParams;
    createdAt: string;
    status: OrderStatus;
    exId?: string;
    exTimestamp?: string;
    exLastTradeAt?: string;
    remaining?: number;
    executed?: number;
    fee?: number;
    lastCheckedAt?: string;
    error?: any;
    nextJob?: OrderJob;
}
