import ccxt from "ccxt";
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
    retries?: number;
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
    userPortfolioId?: string;
    prevOrderId?: string;
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
    info?: ccxt.Order;
    meta?: { currentBalance?: number };
}

export interface UnknownOrder {
    exchange: string;
    asset: string;
    currency: string;
    direction: OrderDirection;
    type: OrderType;
    price?: number;
    volume: number;
    status: OrderStatus;
    exId?: string;
    exTimestamp?: string;
    exLastTradeAt?: string;
    remaining?: number;
    executed?: number;
    lastCheckedAt?: string;
    info?: ccxt.Order;
}

export interface UnknownUserOrder extends UnknownOrder {
    userExAccId: string;
    createdAt?: string;
    updatedAt?: string;
    note?: string;
}
