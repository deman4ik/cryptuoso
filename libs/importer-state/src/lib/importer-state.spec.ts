import MockDate from "mockdate";
import { Importer, ImporterState, Status } from "./importer-state";
import dayjs from "@cryptuoso/dayjs";
import util from "util";

const config: ImporterState = {
    id: "some_id",
    exchange: "bitfinex",
    asset: "BTC",
    currency: "USD",
    type: "history",
    params: {
        timeframes: [1440, 480, 240, 120, 60, 30, 15, 5],
        dateFrom: dayjs.utc("2017-01-01 00:00").toISOString(),
        dateTo: dayjs.utc("2017-01-30 00:00").toISOString()
    },
    status: Status.queued
};
const bitfinexTimeframes = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "3h": "3h",
    "6h": "6h",
    "12h": "12h",
    "1d": "1D",
    "1w": "7D",
    "2w": "14D",
    "1M": "1M"
};
describe("Test 'Importer' Class", () => {
    beforeAll(() => {
        MockDate.set(new Date(Date.UTC(2017, 0, 29, 1, 0)));
    });

    afterAll(() => {
        MockDate.reset();
    });
    describe("Test init", () => {
        it("Should create new instance", () => {
            const importer = new Importer(config);

            expect(importer.state).toStrictEqual({
                asset: "BTC",
                currency: "USD",
                currentState: {},
                endedAt: undefined,
                error: undefined,
                exchange: "bitfinex",
                id: "some_id",
                params: {
                    dateFrom: "2017-01-01T00:00:00.000Z",
                    dateTo: "2017-01-30T00:00:00.000Z",
                    timeframes: [1440, 480, 240, 120, 60, 30, 15, 5]
                },
                progress: 0,
                startedAt: undefined,
                status: "queued",
                type: "history"
            });
        });

        it("Should init for type history", () => {
            const importer = new Importer(config);
            importer.init();
            expect(importer.currentState.candles["5"].timeframe).toBe(5);
            expect(importer.currentState.candles["5"].dateFrom).toBe("2017-01-01T00:00:00.000Z");
            expect(importer.currentState.candles["5"].dateTo).toBe("2017-01-29T00:55:00.000Z");
            expect(importer.currentState.candles["5"].loaded).toBe(false);
            expect(importer.currentState.candles["1440"].timeframe).toBe(1440);
            expect(importer.currentState.candles["1440"].dateFrom).toBe("2017-01-01T00:00:00.000Z");
            expect(importer.currentState.candles["1440"].dateTo).toBe("2017-01-28T00:00:00.000Z");
            expect(importer.currentState.candles["1440"].loaded).toBe(false);
        });

        it("Should init for type history and trades", () => {
            const importer = new Importer({ ...config, exchange: "kraken" });
            importer.init();
            expect(importer.currentState.trades.dateFrom).toBe("2017-01-01T00:00:00.000Z");
            expect(importer.currentState.trades.dateTo).toBe("2017-01-29T01:00:00.000Z");
            expect(importer.currentState.trades.loaded).toBe(false);
        });

        it("Should init for type recent", () => {
            const importer = new Importer({
                ...config,
                type: "recent",
                params: {
                    timeframes: [1440],
                    amount: 300
                }
            });
            importer.init();
            expect(importer.currentState.candles["1440"].timeframe).toBe(1440);
            expect(importer.currentState.candles["1440"].dateFrom).toBe("2016-04-03T00:00:00.000Z");
            expect(importer.currentState.candles["1440"].dateTo).toBe("2017-01-28T00:00:00.000Z");
            expect(importer.currentState.candles["1440"].loaded).toBe(false);
        });
    });

    describe("Test createChunks", () => {
        it("Should create chunks for type history", () => {
            const importer = new Importer(config);
            importer.init();
            importer.createChunks(bitfinexTimeframes);
            expect(importer.currentState.candles["1440"].chunks).toBeInstanceOf(Array);
            expect(importer.currentState.candles["1440"].chunks[0].dateFrom).toBe("2017-01-01T00:00:00.000Z");
            expect(importer.currentState.candles["1440"].chunks[0].dateTo).toBe("2017-01-28T00:00:00.000Z");
            expect(importer.currentState.candles["1440"].chunks[0].timeframe).toBe(1440);
        });
        it("Should create chunks for type history and trades", () => {
            const importer = new Importer({ ...config, exchange: "kraken" });
            importer.init();
            importer.createChunks(bitfinexTimeframes);
            expect(importer.currentState.trades.chunks).toBeInstanceOf(Array);
            expect(importer.currentState.trades.chunks[0].dateFrom).toBe("2017-01-01T00:00:00.000Z");
            expect(importer.currentState.trades.chunks[0].dateTo).toBe("2017-01-01T23:59:59.999Z");
            const lastChunk = importer.currentState.trades.chunks[importer.currentState.trades.chunks.length - 1];
            expect(lastChunk.dateFrom).toBe("2017-01-29T00:00:00.000Z");
            expect(lastChunk.dateTo).toBe("2017-01-29T01:00:00.000Z");
        });
        it("Should create chunks for type recent", () => {
            const importer = new Importer({
                ...config,
                type: "recent",
                params: {
                    timeframes: [1440],
                    amount: 300
                }
            });
            importer.init();
            importer.createChunks(bitfinexTimeframes);
            expect(importer.currentState.candles["1440"].chunks).toBeInstanceOf(Array);
            expect(importer.currentState.candles["1440"].chunks[0].dateFrom).toBe("2016-04-03T00:00:00.000Z");
            expect(importer.currentState.candles["1440"].chunks[0].dateTo).toBe("2017-01-28T00:00:00.000Z");
            expect(importer.currentState.candles["1440"].chunks[0].timeframe).toBe(1440);
        });
    });

    describe("Test progress", () => {
        it("Should set progress", () => {
            const importer = new Importer({
                ...config,
                type: "recent",
                params: {
                    timeframes: [30, 60, 1440],
                    amount: 300
                }
            });
            importer.init();
            importer.createChunks(bitfinexTimeframes);

            importer.start();

            importer.setCandlesProgress(1440, 14400);
            console.log(util.inspect(importer.state, false, null, true));
            expect(importer.state.progress).toEqual(33);
            expect(importer.isLoaded).toEqual(false);
        });
    });
});
