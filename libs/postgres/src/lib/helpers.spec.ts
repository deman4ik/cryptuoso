import { prepareUnnest } from "./helpers";

describe("Test postgres helpers", () => {
    describe("Test prepareUnnest", () => {
        it("Should prepare candles", () => {
            const candles = [
                {
                    exchange: "bitfinex",
                    asset: "BTC",
                    currency: "USD",
                    timeframe: 60,
                    time: 1562292000000,
                    timestamp: "2019-07-05T02:00:00.000Z",
                    open: 11241,
                    high: 11286,
                    low: 11113.09170736,
                    close: 11140,
                    volume: 298.08516229065,
                    type: "loaded"
                },
                {
                    exchange: "bitfinex",
                    asset: "BTC",
                    currency: "USD",
                    timeframe: 60,
                    time: 1562295600000,
                    timestamp: "2019-07-05T03:00:00.000Z",
                    open: 11138,
                    high: 11217,
                    low: 11082.360528,
                    close: 11149,
                    volume: 284.51513229438,
                    type: "loaded"
                }
            ];

            const result = prepareUnnest(candles, [
                "exchange",
                "asset",
                "currency",
                "open",
                "high",
                "low",
                "close",
                "volume",
                "time",
                "timestamp",
                "type"
            ]);
            expect(result).toStrictEqual([
                [
                    "bitfinex",
                    "BTC",
                    "USD",
                    11241,
                    11286,
                    11113.09170736,
                    11140,
                    298.08516229065,
                    1562292000000,
                    "2019-07-05T02:00:00.000Z",
                    "loaded"
                ],
                [
                    "bitfinex",
                    "BTC",
                    "USD",
                    11138,
                    11217,
                    11082.360528,
                    11149,
                    284.51513229438,
                    1562295600000,
                    "2019-07-05T03:00:00.000Z",
                    "loaded"
                ]
            ]);
        });
    });
});
