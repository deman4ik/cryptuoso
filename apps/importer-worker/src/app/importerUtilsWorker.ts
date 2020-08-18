import { expose } from "threads/worker";
import { TradesChunk } from "@cryptuoso/importer-state";
import { uniqueElementsBy, sortAsc } from "@cryptuoso/helpers";
import { ExchangeTrade, createCandlesFromTrades, handleCandleGaps } from "@cryptuoso/market";
import dayjs from "@cryptuoso/dayjs";

const tradesToCandles = ({
    timeframes,
    chunk,
    trades
}: {
    timeframes: number[];
    chunk: TradesChunk;
    trades: ExchangeTrade[];
}) => {
    const uniqTrades = uniqueElementsBy(
        trades,
        (a, b) => a.time === b.time && a.price === b.price && a.amount === b.amount && a.side === b.side
    )
        .filter(
            (trade) =>
                trade.time >= dayjs.utc(chunk.dateFrom).valueOf() && trade.time <= dayjs.utc(chunk.dateTo).valueOf()
        )
        .sort((a, b) => sortAsc(a.time, b.time));
    const candlesInTimeframes = createCandlesFromTrades(chunk.dateFrom, chunk.dateTo, timeframes, uniqTrades);
    if (candlesInTimeframes) {
        for (const timeframe of Object.keys(candlesInTimeframes)) {
            const candles = handleCandleGaps(chunk.dateFrom, chunk.dateTo, candlesInTimeframes[+timeframe]);
            candlesInTimeframes[+timeframe] = candles;
        }
    }
    return {
        chunk,
        candlesInTimeframes
    };
};

const importerUtils = {
    tradesToCandles
};

export type ImporterUtils = typeof importerUtils;

expose(importerUtils);
