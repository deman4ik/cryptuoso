import { handleCandleGaps, batchCandles, createCandlesFromTrades, convertExchangeTimeframes } from "../lib/candles";
import { CandleType } from "@cryptuoso/market";
import dayjs from "@cryptuoso/dayjs";
import { candles60 as gappedCandles60 } from "./testData/gappedCandles";
import { candles60 } from "./testData/candles";
import { trades } from "./testData/trades";

describe("Test 'candles' utils", () => {
    describe("Test 'handleGaps'", () => {
        it("Schould fill gaps in candles - timeframe 60", async () => {
            const dateFrom = dayjs.utc("2019-07-03T15:00:00.000Z");
            const dateTo = dayjs.utc("2019-07-04T02:00:00.000Z");
            const result = await handleCandleGaps(dateFrom.toISOString(), dateTo.toISOString(), gappedCandles60);
            expect(result[0].timestamp).toBe(dateFrom.toISOString());
            expect(result[result.length - 1].timestamp).toBe("2019-07-04T01:00:00.000Z");
            expect(result[result.length - 1].type).toBe(CandleType.previous);
        });
    });
    describe("Test 'batchCandles'", () => {
        it("Should batch candles 60 -> 120", async () => {
            const dateFrom = candles60[0].timestamp;
            const dateTo = candles60[candles60.length - 1].timestamp;
            const result = await batchCandles(dateFrom, dateTo, 120, candles60);
            expect(Array.isArray(result)).toBe(true);
            expect(result[0].timestamp).toBe(dateFrom);
            expect(result[0].open).toBe(10800);
            expect(result[0].high).toBe(11123);
            expect(result[0].low).toBe(10641);
            expect(result[0].close).toBe(10918);
            expect(result[0].volume).toBe(1098.105552502385 + 584.163312387595);
            expect(result[result.length - 1].timestamp).toBe("2019-07-05T00:00:00.000Z");
        });
        it("Should batch candles 60 -> 240", async () => {
            const dateFrom = candles60[0].timestamp;
            const dateTo = candles60[candles60.length - 1].timestamp;
            const result = await batchCandles(dateFrom, dateTo, 240, candles60);
            expect(Array.isArray(result)).toBe(true);
            expect(result[0].timestamp).toBe(dateFrom);
            expect(result[result.length - 1].timestamp).toBe("2019-07-04T20:00:00.000Z");
        });
        it("Should batch candles 60 -> 1440", async () => {
            const dateFrom = candles60[0].timestamp;
            const dateTo = candles60[candles60.length - 1].timestamp;
            const result = await batchCandles(dateFrom, dateTo, 1440, candles60);
            expect(Array.isArray(result)).toBe(true);
            expect(result[0].timestamp).toBe(dateFrom);
            expect(result[result.length - 1].timestamp).toBe("2019-07-04T00:00:00.000Z");
        });
    });
    describe("Test 'createCandlesFromTrades'", () => {
        it("Should create candles 1-60", async () => {
            const dateFrom = dayjs.utc("2019-07-01T00:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-07-01T01:00:00.000Z").toISOString();
            const result = await createCandlesFromTrades(dateFrom, dateTo, [5, 15, 30, 60, 120, 240, 1440], trades);
            //   expect(result[1].length).toBe(60);
            expect(result[5].length).toBe(12);
            expect(result[15].length).toBe(4);
            expect(result[30].length).toBe(2);
            expect(result[60].length).toBe(1);
            expect(result[120].length).toBe(0);
            expect(result[240].length).toBe(0);
            expect(result[1440].length).toBe(0);
            // expect(result[1][0].timestamp).toBe(dateFrom);
            // expect(result[1][0].open).toBe(10749.4);
            // expect(result[1][0].close).toBe(10768.4);
            expect(result[60][0].timestamp).toBe(dateFrom);
            expect(result[60][0].open).toBe(10749.4);
            expect(result[60][0].close).toBe(11014.3);
        });
    });

    describe("Test 'convertExchangeTimeframes", () => {
        it("Should convert kraken timeframes", () => {
            const exchangeTimeframes = {
                "5m": "5",
                "15m": "15",
                "30m": "30",
                "1h": "60",
                "4h": "240",
                "1d": "1440",
                "1w": "10080",
                "2w": "21600"
            };
            const timeframes = convertExchangeTimeframes(exchangeTimeframes);
            expect(Object.keys(timeframes).length).toBe(6);
        });
    });
});
