import ccxt, { Exchange } from "ccxt";
import retry from "async-retry";
import dayjs from "@cryptuoso/dayjs";
import logger, { Logger } from "@cryptuoso/logger";
import { GenericObject, round, sortAsc, valuesString } from "@cryptuoso/helpers";
import { createSocksProxyAgent } from "@cryptuoso/ccxt-public";
import { BaseError } from "@cryptuoso/errors";
import { ExchangePrice, Market, Order, OrderDirection, OrderJobType, OrderStatus, OrderType } from "@cryptuoso/market";
import { pg, sql } from "@cryptuoso/postgres";
import { UserExchangeAccBalances, UserExchangeAccount } from "@cryptuoso/user-state";
import { Priority } from "@cryptuoso/connector-state";

export class PrivateConnector {
    exchange: string;
    log: Logger;
    #orderCheckTimeout = 5;
    connector: Exchange;
    retryOptions = {
        retries: 100,
        minTimeout: 0,
        maxTimeout: 100,
        onRetry: (err: any, i: number) => {
            if (err) {
                this.log.warn(`Retry ${i} - ${err.message}`);
            }
        }
    };
    agent = process.env.PROXY_ENDPOINT && createSocksProxyAgent(process.env.PROXY_ENDPOINT);

    constructor() {
        this.log = logger;
    }

    getSymbol(asset: string, currency: string): string {
        return `${asset}/${currency}`;
    }

    get ordersCache() {
        return this.connector.orders;
    }

    getOrderParams(exchange: string, id: string, params: GenericObject<any>, type: OrderType) {
        if (exchange === "kraken") {
            const { kraken } = params;
            return {
                leverage: (kraken && kraken.leverage) || 3,
                trading_agreement: "agree"
                // clientOrderId: id
            };
        }
        if (exchange === "bitfinex") {
            if (type === OrderType.market || type === OrderType.forceMarket)
                return {
                    type: OrderType.market
                };
            return {
                type: "limit"
            };
        }
        /*if (exchange === "binance_futures" && id) {
          return {
            clientOrderId: id
          };
        }*/
        return {};
    }

    static getErrorMessage(error: Error) {
        let message = error.message;
        if (error instanceof ccxt.BaseError) {
            try {
                message = valuesString(JSON.parse(message.substring(message.indexOf("{"))));
                if (!message) message = error.message;
            } catch (e) {
                message = error.message;
            }
        } else {
            message = error.message;
        }
        return message;
    }

    getCloseOrderDate(exchange: string, orderResponse: ccxt.Order) {
        if (exchange === "kraken") {
            return (
                orderResponse &&
                orderResponse.info &&
                orderResponse.info.closetm &&
                dayjs.utc(parseInt(orderResponse.info.closetm, 10) * 1000).toISOString()
            );
        }

        return (
            orderResponse &&
            orderResponse.lastTradeTimestamp &&
            dayjs.utc(orderResponse.lastTradeTimestamp).toISOString()
        );
    }

    async getCurrentPrice(
        connector: ccxt.Exchange,
        exchange: string,
        asset: string,
        currency: string
    ): Promise<ExchangePrice> {
        try {
            const call = async (bail: (e: Error) => void) => {
                try {
                    return await connector.fetchTicker(this.getSymbol(asset, currency));
                } catch (e) {
                    if (e instanceof ccxt.NetworkError) throw e;
                    bail(e);
                }
            };
            const response: ccxt.Ticker = await retry(call, this.retryOptions);
            if (!response || !response.timestamp) return null;
            const time = dayjs.utc(response.timestamp);
            return {
                exchange,
                asset,
                currency,
                time: time.valueOf(),
                timestamp: time.toISOString(),
                price: round(response.close, 6)
            };
        } catch (e) {
            if (e instanceof ccxt.ExchangeNotAvailable) throw new Error("ExchangeNotAvailable");
            if (e instanceof ccxt.NetworkError) throw new Error("NetworkError");
            throw e;
        }
    }
    async checkAPIKeys(params: { exchange: string; key: string; secret: string; pass?: string }) {
        try {
            const { exchange, key, secret, pass } = params;
            const config: { [key: string]: any } = {
                apiKey: key,
                secret,
                password: pass,
                agent: this.agent,
                options: {
                    enableRateLimit: true
                }
            };
            let connector: ccxt.Exchange;
            if (exchange === "bitfinex" || exchange === "kraken") {
                connector = new ccxt[exchange](config);
            } else if (exchange === "binance_futures") {
                config.options.defaultType = "future";
                config.options.adjustForTimeDifference = true;

                connector = new ccxt.binance(config);
            } else throw new Error("Unsupported exchange");

            const balances = await this.getBalances(connector, exchange);
            const asset = "BTC";
            const currency = exchange === "binance_futures" ? "USDT" : "USD";
            const market = await pg.one<{ limits: Market["limits"] }>(sql`SELECT limits 
            FROM markets 
            WHERE exchange = ${exchange} 
              AND asset =  ${asset}
              AND currency = ${currency};`);

            let price = market.limits.price.min;
            if (exchange === "binance_futures") {
                const { price: currentPrice } = await this.getCurrentPrice(connector, exchange, asset, currency);

                price = currentPrice - 1500;
            }
            const type = OrderType.limit;
            const orderParams = this.getOrderParams(exchange, null, {}, type);

            const createOrderCall = async (bail: (e: Error) => void) => {
                try {
                    return await connector.createOrder(
                        this.getSymbol(asset, currency),
                        type,
                        OrderDirection.buy,
                        market.limits.amount.min,
                        price,
                        orderParams
                    );
                } catch (e) {
                    if (e instanceof ccxt.NetworkError && !(e instanceof ccxt.InvalidNonce)) throw e;
                    bail(e);
                }
            };
            let order: ccxt.Order;
            try {
                order = await retry(createOrderCall, this.retryOptions);
                //  this.logger.info("Created order", order);
                if (!order)
                    throw new BaseError(
                        "Wrong response from exchange while creating test order",
                        order,
                        "WRONG_RESPONSE"
                    );
            } catch (err) {
                this.log.warn(err);
                throw Error(`Failed to create test order. ${PrivateConnector.getErrorMessage(err)}`);
            }

            const cancelOrderCall = async (bail: (e: Error) => void) => {
                try {
                    return await connector.cancelOrder(order.id, this.getSymbol(asset, currency));
                } catch (e) {
                    if (e instanceof ccxt.NetworkError && !(e instanceof ccxt.InvalidNonce)) throw e;
                    bail(e);
                }
            };
            try {
                const canceled = await retry(cancelOrderCall, this.retryOptions);

                //  this.logger.info("Canceled order", canceled);
                if (!canceled)
                    throw new BaseError(
                        "Wrong response from exchange while canceling test order",
                        order,
                        "WRONG_RESPONSE"
                    );
            } catch (err) {
                this.log.warn(err);
                throw Error(
                    `Failed to cancel test order. ${PrivateConnector.getErrorMessage(err)} Please cancel ${
                        order.id
                    } order manualy.`
                );
            }
            return { success: true, balances };
        } catch (err) {
            this.log.warn(err);

            return { success: false, error: PrivateConnector.getErrorMessage(err) };
        }
    }

    async initConnector({
        exchange,
        keys,
        ordersCache
    }: {
        exchange: UserExchangeAccount["exchange"];
        keys: {
            apiKey: string;
            secret: string;
            password?: string;
        };
        ordersCache: UserExchangeAccount["ordersCache"];
    }): Promise<void> {
        const { apiKey, secret, password } = keys;

        const config: { [key: string]: any } = {
            apiKey,
            secret,
            password,
            orders: ordersCache,
            enableRateLimit: true,
            agent: this.agent,
            timeout: 30000,
            nonce() {
                return this.milliseconds();
            }
        };
        this.exchange = exchange;
        if (exchange === "kraken") {
            this.connector = new ccxt.kraken(config);
        } else if (exchange === "bitfinex") {
            this.connector = new ccxt.bitfinex2(config);
        } else if (exchange === "binance_futures") {
            config.options = {
                defaultType: "future",
                adjustForTimeDifference: true,
                recvWindow: 10000000
            };
            this.connector = new ccxt.binance(config);
        } else if (exchange === "binance_spot") {
            config.options = {
                adjustForTimeDifference: true,
                recvWindow: 10000000
            };
            this.connector = new ccxt.binance(config);
        } else throw new Error("Unsupported exchange");
    }

    async calcTotalBalance(connector: Exchange, exchange: string, balances: any): Promise<UserExchangeAccBalances> {
        if (exchange === "binance_futures") {
            return {
                info: balances,
                totalUSD: balances.info.totalWalletBalance || 0,
                updatedAt: dayjs.utc().toISOString()
            };
        } else if (exchange === "kraken" || exchange === "bitfinex") {
            let USD = balances.total["USD"] || 0;

            let priceBTC;
            for (const [c, v] of Object.entries(balances.total as { [key: string]: number }).filter(
                ([c, v]) => c !== "USD" && v
            )) {
                if (connector.markets[`${c}/USD`]) {
                    const { price } = await this.getCurrentPrice(connector, exchange, c, "USD");
                    USD += price * v;
                } else if (connector.markets[`BTC/${c}`]) {
                    const { price } = await this.getCurrentPrice(connector, exchange, "BTC", c);
                    if (!priceBTC)
                        ({ price: priceBTC } = await this.getCurrentPrice(connector, exchange, "BTC", "USD"));
                    USD += (priceBTC / price) * v;
                }
            }
            return {
                info: balances,
                totalUSD: USD || 0,
                updatedAt: dayjs.utc().toISOString()
            };
        }
    }

    async getBalances(
        connector: Exchange = this.connector,
        exchange: string = this.exchange
    ): Promise<UserExchangeAccBalances> {
        const call = async (bail: (e: Error) => void) => {
            try {
                return connector.loadMarkets();
            } catch (e) {
                if (e instanceof ccxt.NetworkError) throw e;
                bail(e);
            }
        };
        await retry(call, this.retryOptions);
        let params = {};
        if (exchange === "bitfinex") params = { type: "margin" };
        const getBalanceCall = async (bail: (e: Error) => void) => {
            try {
                return await connector.fetchBalance(params);
            } catch (e) {
                if (e instanceof ccxt.NetworkError && !(e instanceof ccxt.InvalidNonce)) throw e;
                bail(e);
            }
        };
        try {
            const balances: ccxt.Balances = await retry(getBalanceCall, this.retryOptions);
            if (!balances && !balances.info)
                throw new BaseError("Wrong response from exchange while checking balance", balances, "WRONG_RESPONSE");
            return this.calcTotalBalance(connector, exchange, balances);
        } catch (err) {
            throw Error(`Failed to check balance. ${PrivateConnector.getErrorMessage(err)}`);
        }
    }

    async createOrder(
        order: Order
    ): Promise<{
        order: Order;
        nextJob?: {
            type: OrderJobType;
            priority: Priority;
            nextJobAt: string;
        };
    }> {
        const creationDate = dayjs.utc().valueOf();
        try {
            const { exchange, asset, currency, direction } = order;

            const type =
                (order.type === OrderType.market || order.type === OrderType.forceMarket) &&
                this.connector.has.createMarketOrder
                    ? OrderType.market
                    : OrderType.limit;

            let signalPrice: number;

            if (order.price && order.price > 0) {
                signalPrice = order.price;
            } else if (order.signalPrice && order.signalPrice > 0) {
                signalPrice = order.signalPrice;
            } else {
                const currentPrice: ExchangePrice = await this.getCurrentPrice(
                    this.connector,
                    exchange,
                    asset,
                    currency
                );

                signalPrice = currentPrice.price;
            }

            const orderParams = this.getOrderParams(<string>exchange, order.id, order.params, type);
            let response: ccxt.Order;
            if (order.error && order.exTimestamp) {
                const existedOrder = await this.checkIfOrderExists(order, dayjs.utc(order.exTimestamp).valueOf());
                if (existedOrder) response = existedOrder;
            }
            if (!response) {
                try {
                    response = await this.connector.createOrder(
                        this.getSymbol(asset, currency),
                        type,
                        direction,
                        order.volume,
                        type === OrderType.market ? undefined : signalPrice,
                        orderParams
                    );
                } catch (err) {
                    this.log.error(err, order);
                    if (
                        err instanceof ccxt.AuthenticationError ||
                        err instanceof ccxt.InsufficientFunds ||
                        err instanceof ccxt.InvalidNonce ||
                        err instanceof ccxt.InvalidOrder ||
                        err.message.includes("Margin is insufficient") ||
                        err.message.includes("EOrder:Insufficient initial margin")
                    ) {
                        throw err;
                    }
                    if (err instanceof ccxt.ExchangeError || err instanceof ccxt.NetworkError) {
                        if (err instanceof ccxt.RequestTimeout) {
                            const existedOrder = await this.checkIfOrderExists(order, creationDate);
                            if (existedOrder) response = existedOrder;
                        }

                        if (!response)
                            return {
                                order: {
                                    ...order,
                                    exId: null,
                                    exTimestamp: dayjs.utc(creationDate).toISOString(),
                                    status: OrderStatus.new,
                                    error: PrivateConnector.getErrorMessage(err)
                                },
                                nextJob: {
                                    type: OrderJobType.create,
                                    priority: Priority.high,
                                    nextJobAt: dayjs
                                        .utc()
                                        .add(this.#orderCheckTimeout, "second")
                                        .toISOString()
                                }
                            };
                    }
                    throw err;
                }
            }
            const {
                id: exId,
                datetime: exTimestamp,
                status: orderStatus,
                price,
                average,
                amount: volume,
                remaining,
                filled,
                fee
            } = response;
            const executed = (filled && +filled) || (volume && remaining && +volume - +remaining);
            const status =
                orderStatus === OrderStatus.canceled && executed && executed > 0
                    ? OrderStatus.closed
                    : <OrderStatus>orderStatus;
            return {
                order: {
                    ...order,
                    params: { ...order.params, exchangeParams: orderParams },
                    signalPrice,
                    exId,
                    exTimestamp: exTimestamp && dayjs.utc(exTimestamp).toISOString(),
                    exLastTradeAt: this.getCloseOrderDate(<string>exchange, response),
                    status,
                    price: (average && +average) || (price && +price) || signalPrice,
                    volume: volume && +volume,
                    remaining: remaining && +remaining,
                    executed,
                    fee: (fee && fee.cost) || 0,
                    lastCheckedAt: dayjs.utc().toISOString(),
                    nextJob: {
                        type: OrderJobType.check
                    },
                    error: null
                },
                nextJob: {
                    type: OrderJobType.check,
                    priority: Priority.low,
                    nextJobAt: dayjs
                        .utc()
                        .add(this.#orderCheckTimeout, "second")
                        .toISOString()
                }
            };
        } catch (err) {
            this.log.error(err, order);
            throw err;
        }
    }

    async checkIfOrderExists(order: Order, creationDate: number) {
        try {
            const { userExAccId, exchange, asset, currency, direction, exId, volume, type } = order;
            if (exId) return null;
            let orders: ccxt.Order[] = [];
            if (this.connector.has["fetchOrders"]) {
                const call = async (bail: (e: Error) => void) => {
                    try {
                        return await this.connector.fetchOrders(this.getSymbol(asset, currency), creationDate);
                    } catch (e) {
                        if (e instanceof ccxt.NetworkError && !(e instanceof ccxt.InvalidNonce)) throw e;
                        bail(e);
                    }
                };
                orders = await retry(call, this.retryOptions);
            } else if (this.connector.has["fetchOpenOrders"] && this.connector.has["fetchClosedOrders"]) {
                const callOpen = async (bail: (e: Error) => void) => {
                    try {
                        return await this.connector.fetchOpenOrders(this.getSymbol(asset, currency), creationDate);
                    } catch (e) {
                        if (e instanceof ccxt.NetworkError && !(e instanceof ccxt.InvalidNonce)) throw e;
                        bail(e);
                    }
                };
                const callClosed = async (bail: (e: Error) => void) => {
                    try {
                        return await this.connector.fetchClosedOrders(this.getSymbol(asset, currency), creationDate);
                    } catch (e) {
                        if (e instanceof ccxt.NetworkError && !(e instanceof ccxt.InvalidNonce)) throw e;
                        bail(e);
                    }
                };
                const openOrders = await retry(callOpen, this.retryOptions);
                const closedOrders = await retry(callClosed, this.retryOptions);
                orders = [...closedOrders, ...openOrders];
            } else {
                this.log.error(`Can't fetch orders from ${exchange}`);
                return null;
            }

            if (!orders || !Array.isArray(orders) || orders.length === 0) return null;

            const similarOrders = orders
                .filter(
                    (o) =>
                        //  (o.clientOrderId && o.clientOrderId === id) ||
                        o.side === direction &&
                        o.timestamp >= creationDate &&
                        o.symbol === this.getSymbol(asset, currency) &&
                        o.amount === volume &&
                        o.type === type
                )
                .sort((a, b) => sortAsc(a.timestamp, b.timestamp));
            if (!similarOrders || !Array.isArray(similarOrders) || similarOrders.length === 0) return null;
            const unknownOrders: ccxt.Order[] = [];
            for (const similarOrder of similarOrders) {
                const ordersInDB = await pg.any(sql`SELECT id 
                FROM user_orders 
                WHERE user_ex_acc_id = ${userExAccId}
                  AND ex_id = ${similarOrder.id}`);

                if (!ordersInDB || !Array.isArray(ordersInDB) || ordersInDB.length === 0) {
                    unknownOrders.push(similarOrder);
                }
            }
            if (unknownOrders.length === 0) return null;

            const existedOrder = unknownOrders.sort((a, b) => sortAsc(a.timestamp, b.timestamp))[0];

            return existedOrder;
        } catch (e) {
            this.log.error(e);
            return null;
        }
    }

    async checkOrder(
        order: Order
    ): Promise<{
        order: Order;
        nextJob?: {
            type: OrderJobType;
            priority: Priority;
            nextJobAt: string;
        };
    }> {
        try {
            const { exId, exchange, asset, currency } = order;
            const call = async (bail: (e: Error) => void) => {
                try {
                    return await this.connector.fetchOrder(exId, this.getSymbol(asset, currency));
                } catch (e) {
                    if (e instanceof ccxt.NetworkError && !(e instanceof ccxt.InvalidNonce)) throw e;
                    bail(e);
                }
            };
            const response: ccxt.Order = await retry(call, this.retryOptions);

            const {
                datetime: exTimestamp,
                status: orderStatus,
                price,
                average,
                amount: volume,
                remaining,
                filled,
                fee
            } = response;
            const executed = (filled && +filled) || (volume && remaining && +volume - +remaining);
            const status =
                orderStatus === OrderStatus.canceled && executed && executed > 0
                    ? OrderStatus.closed
                    : <OrderStatus>orderStatus;
            return {
                order: {
                    ...order,
                    exTimestamp: exTimestamp && dayjs.utc(exTimestamp).toISOString(),
                    exLastTradeAt: this.getCloseOrderDate(<string>exchange, response),
                    status,
                    price: (average && +average) || (price && +price),
                    volume: volume && +volume,
                    remaining: remaining && +remaining,
                    executed,
                    fee: (fee && fee.cost) || 0,
                    lastCheckedAt: dayjs.utc().toISOString(),
                    nextJob:
                        status === OrderStatus.canceled || status === OrderStatus.closed
                            ? null
                            : {
                                  type: OrderJobType.check
                              },

                    error: null
                },
                nextJob:
                    status === OrderStatus.canceled || status === OrderStatus.closed
                        ? null
                        : {
                              type: OrderJobType.check,
                              priority: Priority.low,
                              nextJobAt: dayjs
                                  .utc()
                                  .add(this.#orderCheckTimeout, "second")
                                  .toISOString()
                          }
            };
        } catch (err) {
            this.log.error(err, order);
            if (
                err instanceof ccxt.AuthenticationError ||
                err instanceof ccxt.InsufficientFunds ||
                err instanceof ccxt.InvalidNonce
            ) {
                throw err;
            }
            if (
                err instanceof ccxt.ExchangeError ||
                err instanceof ccxt.NetworkError ||
                err instanceof ccxt.InvalidOrder
            ) {
                return {
                    order: {
                        ...order,
                        error: PrivateConnector.getErrorMessage(err)
                    },
                    nextJob: {
                        type: OrderJobType.check,
                        priority: Priority.low,
                        nextJobAt: dayjs
                            .utc()
                            .add(this.#orderCheckTimeout * 5, "second")
                            .toISOString()
                    }
                };
            }
            throw err;
        }
    }

    async cancelOrder(
        order: Order
    ): Promise<{
        order: Order;
        nextJob?: {
            type: OrderJobType;
            priority: Priority;
            nextJobAt: string;
        };
    }> {
        try {
            const { exId, asset, currency } = order;
            const call = async (bail: (e: Error) => void) => {
                try {
                    return await this.connector.cancelOrder(exId, this.getSymbol(asset, currency));
                } catch (e) {
                    if (e instanceof ccxt.NetworkError && !(e instanceof ccxt.InvalidNonce)) throw e;
                    bail(e);
                }
            };
            await retry(call, this.retryOptions);
            return this.checkOrder(order);
        } catch (err) {
            this.log.warn(err, order);
            if (
                err instanceof ccxt.AuthenticationError ||
                err instanceof ccxt.InsufficientFunds ||
                err instanceof ccxt.InvalidNonce
            ) {
                throw err;
            }
            if (err instanceof ccxt.InvalidOrder) {
                return this.checkOrder(order);
            }
            if (err instanceof ccxt.ExchangeError || err instanceof ccxt.NetworkError) {
                return {
                    order: {
                        ...order,
                        error: PrivateConnector.getErrorMessage(err)
                    },
                    nextJob: {
                        type: OrderJobType.cancel,
                        priority: Priority.high,
                        nextJobAt: dayjs
                            .utc()
                            .add(this.#orderCheckTimeout, "second")
                            .toISOString()
                    }
                };
            }
            throw err;
        }
    }
}
