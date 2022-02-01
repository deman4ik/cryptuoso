import dayjs from "@cryptuoso/dayjs";
import { createDatesList, createDatesListWithRange, arraysDiff, sortAsc, sortDesc } from "@cryptuoso/helpers";
import { Timeframe, ValidTimeframe } from "./timeframe";
import { ExchangeTrade } from "./market";

export const enum CandleType {
    loaded = "loaded",
    created = "created",
    previous = "previous",
    history = "history"
}

export interface ExchangeCandle {
    exchange: string;
    asset: string;
    currency: string;
    timeframe: ValidTimeframe;
    time: number;
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    type: CandleType;
}

export interface DBCandle {
    exchange: string;
    asset: string;
    currency: string;
    timeframe: number;
    id?: string;
    time: number;
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    type: CandleType;
}

export interface Candle extends DBCandle {
    id?: string;
}

export interface CandleProps {
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
}

export interface ExchangeCandlesInTimeframes {
    [key: string]: ExchangeCandle[];
}

export function handleCandleGaps(
    dateFromInput: string,
    dateTo: string,
    inputCandles: ExchangeCandle[]
): ExchangeCandle[] {
    if (!inputCandles || !Array.isArray(inputCandles) || inputCandles.length === 0) return [];
    let candles = [...inputCandles];

    const { exchange, asset, currency, timeframe } = inputCandles[0];
    const { unit, amountInUnit } = Timeframe.timeframes[timeframe];
    const dateFrom = Timeframe.validTimeframeDateNext(dateFromInput, timeframe);
    const duration = Timeframe.durationTimeframe(dateFrom, dateTo, timeframe);
    const fullDatesList = createDatesList(dateFrom, dateTo, unit, 1, duration);

    const loadedDatesList = candles.map((candle) => candle.time);
    // Ищем пропуски
    const diffs = arraysDiff(fullDatesList, loadedDatesList).sort(sortAsc);
    // Если есть пропуски
    if (diffs.length > 0) {
        // Для каждой пропущенный свечи
        for (const diffTime of diffs) {
            // Время предыдущей свечи
            const previousTime = dayjs.utc(diffTime).add(-amountInUnit, unit).valueOf();
            // Предыдущая свеча
            const previousCandle = candles.find((candle) => candle.time === previousTime);
            if (previousCandle) {
                // Заполняем пропуск
                const gappedCandle = {
                    exchange, // код биржи
                    asset, // базовая валюта
                    currency, // котировка валюты
                    timeframe, // таймфрейм в минутах
                    time: diffTime, // время в милисекундах
                    timestamp: dayjs.utc(diffTime).toISOString(), // время в ISO UTC
                    open: previousCandle.close, // цена открытия = цене закрытия предыдущей
                    high: previousCandle.close, // максимальная цена = цене закрытия предыдущей
                    low: previousCandle.close, // минимальная цена = цене закрытия предыдущей
                    close: previousCandle.close, // цена закрытия = цене закрытия предыдущей
                    volume: 0, // нулевой объем
                    type: CandleType.previous // тип - предыдущая
                };
                candles.push(gappedCandle);
                candles = candles.sort((a, b) => sortAsc(a.time, b.time));
            }
        }
    }
    candles = candles.filter((c) => c.time >= dayjs.utc(dateFrom).valueOf() && c.time < dayjs.utc(dateTo).valueOf());
    return candles;
}

export function batchCandles(
    dateFromInput: string,
    dateTo: string,
    timeframe: ValidTimeframe,
    inputCandles: ExchangeCandle[]
): ExchangeCandle[] {
    let timeframeCandles: ExchangeCandle[] = [];
    if (!inputCandles || !Array.isArray(inputCandles) || inputCandles.length === 0) return [];
    const candles = [...inputCandles];
    const { exchange, asset, currency } = inputCandles[0];
    const { unit, amountInUnit } = Timeframe.timeframes[timeframe];
    const dateFrom = Timeframe.validTimeframeDateNext(dateFromInput, timeframe);
    const duration = Timeframe.durationTimeframe(dateFrom, dateTo, timeframe);

    const fullDatesList = createDatesList(dateFrom, dateTo, unit, amountInUnit, duration + 1);
    // добавляем еще одну свечу чтобы сформировать прошедший таймфрейм

    fullDatesList.forEach((time) => {
        const date = dayjs.utc(time);
        // Пропускаем самую первую свечу
        if (dayjs.utc(dateFrom).valueOf() === date.valueOf()) return;

        const timeFrom = date.add(-amountInUnit, unit).valueOf();
        const timeTo = date.valueOf();
        const currentCandles = candles
            .filter((candle) => candle.time >= timeFrom && candle.time < timeTo)
            .sort((a, b) => sortAsc(a.time, b.time));
        if (currentCandles.length > 0) {
            const volume = +currentCandles.map((t) => t.volume).reduce((a, b) => a + b, 0) || 0;
            timeframeCandles.push({
                exchange,
                asset,
                currency,
                timeframe,
                time: timeFrom, // время в милисекундах
                timestamp: dayjs.utc(timeFrom).toISOString(), // время в ISO UTC
                open: +currentCandles[0].open, // цена открытия - цена открытия первой свечи
                high: Math.max(...currentCandles.map((t) => +t.high)), // максимальная цена
                low: Math.min(...currentCandles.map((t) => +t.low)), // минимальная цена
                close: +currentCandles[currentCandles.length - 1].close, // цена закрытия - цена закрытия последней свечи
                volume, // объем - сумма объема всех свечей
                type: volume === 0 ? CandleType.previous : CandleType.created
            });
        }
    });
    if (timeframeCandles.length > 0) timeframeCandles = timeframeCandles.sort((a, b) => sortAsc(a.time, b.time));

    return timeframeCandles;
}

export function createCandlesFromTrades(
    dateFrom: string,
    dateTo: string,
    timeframes: ValidTimeframe[],
    trades: ExchangeTrade[]
): ExchangeCandlesInTimeframes {
    const result: ExchangeCandlesInTimeframes = {};
    if (trades.length > 0) {
        const { exchange, asset, currency } = trades[0];

        timeframes.map(async (timeframe) => {
            result[timeframe] = [];
            let currentTrades = [...trades];
            const duration = Timeframe.durationTimeframe(dateFrom, dateTo, timeframe);
            if (duration > 0) {
                const { unit, amountInUnit } = Timeframe.get(timeframe);
                const dates = createDatesListWithRange(dateFrom, dateTo, unit, amountInUnit, duration);

                await Promise.all(
                    dates.map(async (date) => {
                        const dateTrades = currentTrades.filter(
                            (trade) => trade.time >= date.dateFrom && trade.time <= date.dateTo
                        );

                        if (dateTrades && dateTrades.length > 0) {
                            currentTrades = currentTrades.slice(dateTrades.length);
                            const volume = +dateTrades.map((t) => t.amount).reduce((a, b) => a + b, 0) || 0;
                            const prices = dateTrades.map((t) => +t.price);
                            result[timeframe].push({
                                exchange,
                                asset,
                                currency,
                                timeframe: timeframe,
                                time: +date.dateFrom, // время в милисекундах
                                timestamp: dayjs.utc(date.dateFrom).toISOString(), // время в ISO UTC
                                open: +dateTrades[0].price, // цена открытия - цена первого тика
                                high: +Math.max(...prices), // максимальная цена тиков
                                low: +Math.min(...prices), // минимальная цена тиков
                                close: +dateTrades[dateTrades.length - 1].price, // цена закрытия - цена последнего тика
                                volume, // объем - сумма объема всех тиков
                                type: volume === 0 ? CandleType.previous : CandleType.created // признак - свеча сформирована
                            });
                        }
                    })
                );
                result[timeframe] = result[timeframe].sort((a, b) => sortAsc(a.time, b.time));
            }
        });
    }
    return result;
}

export function convertExchangeTimeframes(exchangeTimeframes: { [key: string]: string | number }): {
    [key: string]: Timeframe;
} {
    const timeframes: { [key: string]: ValidTimeframe } = {};
    Object.keys(exchangeTimeframes).forEach((key) => {
        const tf = Timeframe.stringToTimeframe(key);
        if (Timeframe.exists(tf)) {
            timeframes[key] = tf;
        }
    });
    return timeframes;
}

export function getCurrentCandleParams(
    exchange: string,
    exchangeTimeframes: { [key: string]: string | number },
    timeframe: ValidTimeframe
) {
    const timeframeStr = Timeframe.toString(timeframe);

    const candleTime = Timeframe.getCurrentSince(1, timeframe);
    const params = {
        timeframe,
        timeframeStr,
        dateFrom: candleTime,
        time: candleTime,
        limit: 1,
        batch: false
    };
    const timeframes: { [key: string]: Timeframe } = convertExchangeTimeframes(exchangeTimeframes);

    const exchangeHasTimeframe = Timeframe.inList(timeframes, timeframeStr);

    if (!exchangeHasTimeframe) {
        const { amountInUnit } = Timeframe.get(timeframe);
        const exchangeTimeframeList = Object.values(timeframes)
            .map((t) => +t)
            .sort(sortDesc);
        const lowerTimeframe = exchangeTimeframeList.filter((t) => +t < +timeframe)[0];
        params.timeframe = lowerTimeframe;
        params.timeframeStr = Timeframe.toString(lowerTimeframe);
        params.dateFrom = Timeframe.getCurrentSince(amountInUnit, lowerTimeframe);
        params.limit = loadLimit(exchange);
        params.batch = true;
    }

    return params;
}

export function getCandlesParams(
    exchange: string,
    exchangeTimeframes: { [key: string]: string | number },
    timeframe: ValidTimeframe,
    dateFromInput: string,
    inputLimit = 100
) {
    const timeframes: { [key: string]: Timeframe } = convertExchangeTimeframes(exchangeTimeframes); //TODO: refactor
    let currentTimeframe = Timeframe.get(timeframe);
    const exchangeHasTimeframe = Timeframe.inList(timeframes, Timeframe.toString(timeframe));
    let limit = inputLimit;
    if (!exchangeHasTimeframe) {
        currentTimeframe = Timeframe.get(
            Object.values(timeframes)
                .map((t) => +t)
                .sort(sortDesc)
                .filter((t) => +t < +timeframe)[0]
        );
        limit = loadLimit(exchange);
    }

    const { amount, unit } = Timeframe.timeframeAmountToTimeUnit(limit, currentTimeframe.value);
    const validCurrentTimeframeDate = Timeframe.validTimeframeDateNext(dayjs.utc().toISOString(), timeframe);
    const dateFrom = Timeframe.validTimeframeDateNext(dateFromInput, timeframe);
    const dateToCalc = dayjs.utc(dateFrom).add(amount, unit).toISOString();
    const dateTo =
        (dayjs.utc(dateToCalc).valueOf() < dayjs.utc(validCurrentTimeframeDate).valueOf() && dateToCalc) ||
        validCurrentTimeframeDate;

    return {
        timeframe: currentTimeframe.value,
        timeframeStr: currentTimeframe.str,
        dateFrom: dayjs
            .utc(dateFrom)
            .add(-3 * currentTimeframe.amountInUnit, unit)
            .valueOf(),
        dateTo,
        unit,
        limit: limit + 3,
        batch: !exchangeHasTimeframe
    };
}

export function loadLimit(exchange: string) {
    switch (exchange) {
        case "bitfinex":
            return 900;
        case "kraken":
            return 450;
        case "binance":
            return 900;
        case "binance_futures":
            return 500;
        case "kucoin":
            return 1400;
        case "huobipro":
            return 1900;
        default:
            return 250;
    }
}
