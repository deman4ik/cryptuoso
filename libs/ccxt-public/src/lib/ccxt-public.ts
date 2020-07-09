import ccxt, { Exchange } from "ccxt";
import retry from "async-retry";
import dayjs from "@cryptuoso/dayjs";
import logger, { Logger } from "@cryptuoso/logger";
import { round } from "@cryptuoso/helpers";
import {
    ExchangePrice,
    ExchangeCandle,
    CandleType,
    ExchangeTrade,
    Timeframe,
    ValidTimeframe,
    getCurrentCandleParams,
    getCandlesParams,
    handleCandleGaps,
    batchCandles
} from "@cryptuoso/market";
import { createSocksProxyAgent } from "./fetch";

interface MinMax {
    min: number;
    max: number | undefined;
}

export interface Market {
    exchange: string;
    asset: string;
    currency: string;
    precision: { base: number; quote: number; amount: number; price: number };
    limits: { amount: MinMax; price: MinMax; cost?: MinMax };
    averageFee: number;
    loadFrom: string;
}

export class PublicConnector {
    log: Logger;
    connectors: { [key: string]: Exchange } = {};

    constructor() {
        this.log = logger;
    }

    retryOptions = {
        retries: 1000,
        minTimeout: 0,
        maxTimeout: 0,
        onRetry: (err: any, i: number) => {
            if (err) {
                this.log.warn(`Retry ${i} - ${err.message}`);
            }
        }
    };

    _agent = createSocksProxyAgent(process.env.PROXY_ENDPOINT);

    async initConnector(exchange: string): Promise<void> {
        if (!(exchange in this.connectors)) {
            const config: { [key: string]: any } = {
                agent: this._agent
            };
            if (exchange === "bitfinex" || exchange === "kraken") {
                this.connectors[exchange] = new ccxt[exchange](config);
            } else if (exchange === "binance_futures") {
                config.options = { defaultType: "future" };
                this.connectors[exchange] = new ccxt.binance(config);
            } else if (exchange === "binance_spot") {
                this.connectors[exchange] = new ccxt.binance(config);
            } else throw new Error("Unsupported exchange");

            const call = async (bail: (e: Error) => void) => {
                try {
                    return await this.connectors[exchange].loadMarkets();
                } catch (e) {
                    if (e instanceof ccxt.NetworkError) throw e;
                    bail(e);
                }
            };
            await retry(call, this.retryOptions);
        }
    }

    getSymbol(asset: string, currency: string): string {
        return `${asset}/${currency}`;
    }

    async getMarket(exchange: string, asset: string, currency: string): Promise<Market> {
        try {
            await this.initConnector(exchange);
            const response: ccxt.Market = await this.connectors[exchange].market(this.getSymbol(asset, currency));
            let loadFrom;
            if (exchange === "kraken") {
                const [firstTrade] = await this.getTrades(
                    exchange,
                    asset,
                    currency,
                    dayjs.utc("01.01.2013").toISOString()
                );
                if (firstTrade) loadFrom = dayjs.utc(firstTrade.timestamp).add(1, "day").startOf("day").toISOString();
            } else {
                const [firstCandle] = await this.getRawCandles(
                    exchange,
                    asset,
                    currency,
                    5,
                    dayjs.utc("01.01.2013").toISOString(),
                    10
                );
                if (firstCandle) loadFrom = dayjs.utc(firstCandle.timestamp).add(1, "day").startOf("day").toISOString();
            }
            return {
                exchange,
                asset,
                currency,
                loadFrom,
                limits: response.limits,
                precision: response.precision,
                averageFee: response.taker
            };
        } catch (e) {
            if (e instanceof ccxt.ExchangeNotAvailable) throw new Error("ExchangeNotAvailable");
            if (e instanceof ccxt.NetworkError) throw new Error("NetworkError");
            throw e;
        }
    }

    async getTimeframes(
        exchange: string
    ): Promise<{
        [key: string]: Timeframe;
    }> {
        await this.initConnector(exchange);
        const timeframes: {
            [key: string]: Timeframe;
        } = {};

        Object.keys(this.connectors[exchange].timeframes).forEach((key) => {
            const timeframe = Timeframe.stringToTimeframe(key);
            if (timeframe) timeframes[key] = timeframe;
        });
        return timeframes;
    }

    async getCurrentPrice(exchange: string, asset: string, currency: string): Promise<ExchangePrice> {
        try {
            await this.initConnector(exchange);
            const call = async (bail: (e: Error) => void) => {
                try {
                    return await this.connectors[exchange].fetchTicker(this.getSymbol(asset, currency));
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

    async getCurrentCandle(
        exchange: string,
        asset: string,
        currency: string,
        timeframe: ValidTimeframe
    ): Promise<ExchangeCandle> {
        try {
            await this.initConnector(exchange);
            const params = getCurrentCandleParams(this.connectors[exchange].timeframes, timeframe);
            const call = async (bail: (e: Error) => void) => {
                try {
                    return await this.connectors[exchange].fetchOHLCV(
                        this.getSymbol(asset, currency),
                        params.timeframeStr,
                        params.dateFrom,
                        params.limit
                    );
                } catch (e) {
                    if (e instanceof ccxt.NetworkError) throw e;
                    bail(e);
                }
            };
            const response: ccxt.OHLCV[] = await retry(call, this.retryOptions);
            if (!response || !Array.isArray(response) || response.length === 0) {
                const { price } = await this.getCurrentPrice(exchange, asset, currency);
                if (!price) return null;
                const time = dayjs.utc(params.time);
                const roundedPrice = round(price, 6);
                return {
                    exchange,
                    asset,
                    currency,
                    timeframe,
                    time: time.valueOf(),
                    timestamp: time.toISOString(),
                    open: roundedPrice,
                    high: roundedPrice,
                    low: roundedPrice,
                    close: roundedPrice,
                    volume: 0,
                    type: CandleType.previous
                };
            }
            let candles: ExchangeCandle[] = response.map((candle) => {
                try {
                    if (!candle || !Array.isArray(candle)) throw new Error("Wrong response");
                    return {
                        exchange,
                        asset,
                        currency,
                        timeframe: params.timeframe,
                        time: +candle[0],
                        timestamp: dayjs.utc(+candle[0]).toISOString(),
                        open: round(+candle[1], 6),
                        high: round(+candle[2], 6),
                        low: round(+candle[3], 6),
                        close: round(+candle[4], 6),
                        volume: round(+candle[5] || 0, 6),
                        type: +candle[5] === 0 ? CandleType.previous : CandleType.loaded
                    };
                } catch (e) {
                    this.log.error(e, candle);
                    throw e;
                }
            });

            if (candles.length > 0 && params.batch) {
                const time = dayjs.utc(params.time);
                candles = [
                    {
                        exchange,
                        asset,
                        currency,
                        timeframe,
                        time: time.valueOf(),
                        timestamp: time.toISOString(),
                        open: round(+candles[0].open, 6),
                        high: round(Math.max(...candles.map((t) => +t.high)), 6),
                        low: round(Math.min(...candles.map((t) => +t.low)), 6),
                        close: round(+candles[candles.length - 1].close, 6),
                        volume: round(+candles.map((t) => t.volume).reduce((a, b) => a + b, 0) || 0, 6),
                        type: CandleType.created
                    }
                ];
            }
            return candles[candles.length - 1];
        } catch (e) {
            if (e instanceof ccxt.ExchangeNotAvailable) throw new Error("ExchangeNotAvailable");
            if (e instanceof ccxt.NetworkError) throw new Error("NetworkError");
            throw e;
        }
    }

    async getRawCandles(
        exchange: string,
        asset: string,
        currency: string,
        timeframe: ValidTimeframe,
        dateFrom: string,
        limit = 100
    ): Promise<ExchangeCandle[]> {
        try {
            await this.initConnector(exchange);
            const { str } = Timeframe.get(timeframe);
            let candles: ExchangeCandle[] = [];

            const call = async (bail: (e: Error) => void) => {
                try {
                    return await this.connectors[exchange].fetchOHLCV(
                        this.getSymbol(asset, currency),
                        str,
                        dayjs.utc(dateFrom).valueOf(),
                        limit
                    );
                } catch (e) {
                    if (e instanceof ccxt.NetworkError) throw e;
                    bail(e);
                }
            };
            const response: ccxt.OHLCV[] = await retry(call, this.retryOptions);
            if (!response || !Array.isArray(response) || response.length === 0) return candles;

            candles = response.map((candle) => {
                try {
                    if (!candle || !Array.isArray(candle)) throw new Error("Wrong response");
                    return {
                        exchange,
                        asset,
                        currency,
                        timeframe: timeframe,
                        time: +candle[0],
                        timestamp: dayjs.utc(+candle[0]).toISOString(),
                        open: round(+candle[1], 6),
                        high: round(+candle[2], 6),
                        low: round(+candle[3], 6),
                        close: round(+candle[4], 6),
                        volume: round(+candle[5], 6) || 0,
                        type: +candle[5] === 0 ? CandleType.previous : CandleType.loaded
                    };
                } catch (e) {
                    this.log.error(e, candle);
                    throw e;
                }
            });

            return candles;
        } catch (e) {
            if (e instanceof ccxt.ExchangeNotAvailable) throw new Error("ExchangeNotAvailable");
            if (e instanceof ccxt.NetworkError) throw new Error("NetworkError");
            throw e;
        }
    }

    async getCandles(
        exchange: string,
        asset: string,
        currency: string,
        timeframe: ValidTimeframe,
        dateFrom: string,
        limit = 100
    ): Promise<ExchangeCandle[]> {
        try {
            await this.initConnector(exchange);
            const params = getCandlesParams(this.connectors[exchange].timeframes, timeframe, dateFrom, limit);
            const dateTo = dayjs.utc(params.dateTo).toISOString();
            let candles: ExchangeCandle[] = [];

            const call = async (bail: (e: Error) => void) => {
                try {
                    return await this.connectors[exchange].fetchOHLCV(
                        this.getSymbol(asset, currency),
                        params.timeframeStr,
                        params.dateFrom,
                        params.limit
                    );
                } catch (e) {
                    if (e instanceof ccxt.NetworkError) throw e;
                    bail(e);
                }
            };
            const response: ccxt.OHLCV[] = await retry(call, this.retryOptions);

            if (!response || !Array.isArray(response) || response.length === 0) return candles;

            candles = response.map((candle) => {
                try {
                    if (!candle || !Array.isArray(candle)) throw new Error("Wrong response");
                    return {
                        exchange,
                        asset,
                        currency,
                        timeframe: params.timeframe,
                        time: +candle[0],
                        timestamp: dayjs.utc(+candle[0]).toISOString(),
                        open: round(+candle[1], 6),
                        high: round(+candle[2], 6),
                        low: round(+candle[3], 6),
                        close: round(+candle[4], 6),
                        volume: round(+candle[5], 6) || 0,
                        type: +candle[5] === 0 ? CandleType.previous : CandleType.loaded
                    };
                } catch (e) {
                    this.log.error(e, candle);
                    throw e;
                }
            });

            if (params.batch && timeframe > ValidTimeframe["1m"]) {
                candles = handleCandleGaps(dayjs.utc(params.dateFrom).toISOString(), dateTo, candles);
                candles = batchCandles(dateFrom, dateTo, timeframe, candles);
            } else {
                candles = handleCandleGaps(dateFrom, dateTo, candles);
            }
            return candles;
        } catch (e) {
            if (e instanceof ccxt.ExchangeNotAvailable) throw new Error("ExchangeNotAvailable");
            if (e instanceof ccxt.NetworkError) throw new Error("NetworkError");
            throw e;
        }
    }

    async getTrades(exchange: string, asset: string, currency: string, dateFrom: string): Promise<ExchangeTrade[]> {
        try {
            await this.initConnector(exchange);
            const since = dayjs.utc(dateFrom).valueOf();
            const params =
                exchange === "kraken"
                    ? {
                          since: since * 1000000
                      }
                    : null;

            const call = async (bail: (e: Error) => void) => {
                try {
                    return await this.connectors[exchange].fetchTrades(
                        this.getSymbol(asset, currency),
                        since,
                        1000,
                        params
                    );
                } catch (e) {
                    if (e instanceof ccxt.NetworkError) throw e;
                    bail(e);
                }
            };
            const response: ccxt.Trade[] = await retry(call, this.retryOptions);

            if (!response || !Array.isArray(response)) throw new Error("Failed to fetch trades");

            if (response.length === 0) return [];

            const trades = response.map((trade) => {
                try {
                    if (!trade || !trade.datetime) throw new Error("Wrong response");
                    const time = dayjs.utc(trade.datetime);
                    return {
                        exchange,
                        asset,
                        currency,
                        time: time.valueOf(),
                        timestamp: time.toISOString(),
                        side: trade.side,
                        price: round(trade.price, 6),
                        amount: round(trade.amount, 6)
                    };
                } catch (e) {
                    this.log.error(e, trade);
                    throw e;
                }
            });

            return trades;
        } catch (e) {
            if (e instanceof ccxt.ExchangeNotAvailable) throw new Error("ExchangeNotAvailable");
            if (e instanceof ccxt.NetworkError) throw new Error("NetworkError");
            throw e;
        }
    }
}
