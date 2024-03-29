import { SignalSubscriptionPosition } from "@cryptuoso/portfolio-state";
import fetch from "node-fetch";
import logger from "@cryptuoso/logger";
import { OrderType } from "@cryptuoso/market";

interface ZignalySignal {
    key: string;
    exchange: "binance";
    exchangeAccountType: "futures";
    type: "entry" | "exit";
    pair: string;
    side?: "long" | "short";
    orderType: "limit" | "market";
    positionSizePercentage?: string;
    signalId: string;
    price?: string;
    leverage?: string;
}

interface ZignalyStart {
    key: string;
    exchange: "binance";
    exchangeAccountType: "futures";
    type: "start";
}

interface ZignalyStop {
    key: string;
    exchange: "binance";
    exchangeAccountType: "futures";
    type: "stop";
}

async function fetchZignaly(url: string, data: ZignalySignal | ZignalyStart | ZignalyStop) {
    logger.debug(`Fetch Zignaly ${url}`, data);
    const response = await fetch(url, {
        method: "post",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });
    logger.debug(await response.text());
    if (response.ok) return;
    else throw new Error(`Failed to send signal to Zignaly ${JSON.stringify(await response.text())}`);
}

export async function openZignalyPosition(
    url: string,
    token: string,
    position: SignalSubscriptionPosition
): Promise<SignalSubscriptionPosition> {
    const signal: ZignalySignal = {
        key: token,
        exchange: "binance", //ONLY binance supported
        exchangeAccountType: "futures",
        type: "entry",
        pair: `${position.asset}${position.currency}`.toLowerCase(),
        side: position.direction,
        orderType: position.entryOrderType === OrderType.limit ? "limit" : "market",
        positionSizePercentage: `${position.share}`,
        signalId: `${position.id}`,
        leverage: `${position.leverage}`
    };

    if (signal.orderType === "limit") {
        signal.price = `${position.entryPrice}`;
    }
    let error;
    try {
        await fetchZignaly(url, signal);
    } catch (err) {
        logger.error(err);
        error = err.message;
    }
    return { ...position, error, status: error ? "canceled" : "open" };
}

export async function closeZignalyPosition(
    url: string,
    token: string,
    position: SignalSubscriptionPosition,
    force = false
): Promise<SignalSubscriptionPosition> {
    const signal: ZignalySignal = {
        key: token,
        exchange: "binance", //ONLY binance supported
        exchangeAccountType: "futures",
        type: "exit",
        pair: `${position.asset}${position.currency}`.toLowerCase(),
        orderType: position.exitOrderType === OrderType.limit ? "limit" : "market",
        signalId: `${position.id}`
    };

    if (signal.orderType === "limit") {
        signal.price = `${position.exitPrice}`;
    }
    let error;
    try {
        await fetchZignaly(url, signal);
    } catch (err) {
        logger.error(err);
        error = err.message;
    }
    return { ...position, error, status: error ? "open" : force ? "closedAuto" : "closed" };
}

export async function startZignaly(url: string, token: string) {
    const data: ZignalyStart = {
        key: token,
        exchange: "binance", //ONLY binance supported
        exchangeAccountType: "futures",
        type: "start"
    };
    await fetchZignaly(url, data);
}

export async function stopZignaly(url: string, token: string) {
    const data: ZignalyStop = {
        key: token,
        exchange: "binance", //ONLY binance supported
        exchangeAccountType: "futures",
        type: "stop"
    };
    await fetchZignaly(url, data);
}
