import { round } from "@cryptuoso/helpers";
import logger from "@cryptuoso/logger";
import { Candle } from "@cryptuoso/market";
import { Robot } from "../lib/Robot";
import candles from "./data/binance_futures-BTC-USDT-1440.json";
jest.setTimeout(40000);
global.setImmediate = jest.useRealTimers as unknown as typeof setImmediate;
describe("Test 'Robot'", () => {
    describe("Test persistance", () => {
        it("Should run Breakout v1", async () => {
            const robot = new Robot({
                id: "some_id",
                exchange: "binance_futures",
                asset: "BTC",
                currency: "USDT",
                timeframe: 1440,
                strategy: "breakout",
                settings: {
                    strategySettings: {
                        adxHigh: 15,
                        lookback: 30,
                        adxPeriod: 25,
                        trailBars: 4,
                        requiredHistoryMaxBars: 300
                    },
                    robotSettings: {
                        volumeType: "currencyDynamic",
                        volumeInCurrency: 1000
                    },
                    activeFrom: "2020-01-01T00:00:00.000Z"
                }
            });
            const historyCandles: Candle[] = candles.slice(0, 300) as Candle[];

            const newCandles: Candle[] = candles.slice(300) as Candle[];

            robot.handleHistoryCandles(historyCandles);
            robot.initStrategy();
            await robot.initIndicators();

            robot.handleCandle(newCandles[0]);
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            robot.handleCandle(newCandles[1]);
            robot.clearEvents();
            robot.checkAlerts();
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            expect(round(robot.state.indicators["highestHigh"].result, 2)).toEqual(round(13863, 2));
            expect(round(robot.state.indicators["lowestLow"].result, 2)).toEqual(round(12715, 2));
            expect(round(robot.state.indicators["highestHighLookback"].result, 2)).toEqual(round(13863, 2));
            expect(round(robot.state.indicators["lowestLowLookback"].result, 2)).toEqual(round(10371.03, 2));
            expect(round(robot.state.indicators["highestADX"].result, 2)).toEqual(round(28.0167645865844, 2));
        });

        it("Should run Breakout v2", async () => {
            const robot = new Robot({
                id: "some_id",
                exchange: "binance_futures",
                asset: "BTC",
                currency: "USDT",
                timeframe: 1440,
                strategy: "breakout_v2",
                settings: {
                    strategySettings: {
                        adxHigh: 15,
                        lookback: 10,
                        adxPeriod: 25,
                        orderStopLoss: 0.01,
                        orderTakeProfit: 0.01,
                        requiredHistoryMaxBars: 300
                    },
                    robotSettings: {
                        volumeType: "currencyDynamic",
                        volumeInCurrency: 1000
                    },
                    activeFrom: "2020-01-01T00:00:00.000Z"
                }
            });

            const historyCandles: Candle[] = candles.slice(0, 300) as Candle[];

            const newCandles: Candle[] = candles.slice(300) as Candle[];

            robot.handleHistoryCandles(historyCandles);
            robot.initStrategy();
            await robot.initIndicators();

            robot.handleCandle(newCandles[0]);
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            robot.handleCandle(newCandles[1]);
            robot.clearEvents();
            robot.checkAlerts();
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            expect(round(robot.state.indicators["highestHighLookback"].result, 2)).toEqual(round(13863, 2));
            expect(round(robot.state.indicators["lowestLowLookback"].result, 2)).toEqual(round(11404.01, 2));
            expect(round(robot.state.indicators["highestADX"].result, 2)).toEqual(round(28.0167645865844, 2));
        });

        it("Should run Channels", async () => {
            const robot = new Robot({
                id: "some_id",
                exchange: "binance_futures",
                asset: "BTC",
                currency: "USDT",
                timeframe: 1440,
                strategy: "channels",
                settings: {
                    strategySettings: {
                        adx: 10,
                        tick: 0.01,
                        ratio: 150,
                        seriesSize: 10,
                        requiredHistoryMaxBars: 300
                    },
                    robotSettings: {
                        volumeType: "currencyDynamic",
                        volumeInCurrency: 1000
                    },
                    activeFrom: "2020-01-01T00:00:00.000Z"
                }
            });

            const historyCandles: Candle[] = candles.slice(0, 300) as Candle[];

            const newCandles: Candle[] = candles.slice(300) as Candle[];

            robot.handleHistoryCandles(historyCandles);
            robot.initStrategy();
            await robot.initIndicators();

            robot.handleCandle(newCandles[0]);
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            robot.handleCandle(newCandles[1]);
            robot.clearEvents();
            robot.checkAlerts();
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            expect(round(robot.state.indicators["channelADX"].result.value, 2)).toEqual(round(2, 2));
        });

        it("Should run Counter Candle", async () => {
            const robot = new Robot({
                id: "some_id",
                exchange: "binance_futures",
                asset: "BTC",
                currency: "USDT",
                timeframe: 1440,
                strategy: "counter_candle",
                settings: {
                    strategySettings: {
                        n: 0.5,
                        z: 2.5,
                        xClose: 50,
                        yClose: 50,
                        highest: 30,
                        requiredHistoryMaxBars: 300
                    },
                    robotSettings: {
                        volumeType: "currencyDynamic",
                        volumeInCurrency: 1000
                    },
                    activeFrom: "2020-01-01T00:00:00.000Z"
                }
            });

            const historyCandles: Candle[] = candles.slice(0, 300) as Candle[];

            const newCandles: Candle[] = candles.slice(300) as Candle[];

            robot.handleHistoryCandles(historyCandles);
            robot.initStrategy();
            await robot.initIndicators();

            robot.handleCandle(newCandles[0]);
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            robot.handleCandle(newCandles[1]);
            robot.clearEvents();
            robot.checkAlerts();
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            expect(round(robot.state.indicators["highestHigh"].result, 2)).toEqual(round(13863, 2));
            expect(round(robot.state.indicators["lowestLow"].result, 2)).toEqual(round(10371.03, 2));
        });

        it("Should run Double Reverse MM", async () => {
            const robot = new Robot({
                id: "some_id",
                exchange: "binance_futures",
                asset: "BTC",
                currency: "USDT",
                timeframe: 1440,
                strategy: "double_reverse_mm",
                settings: {
                    strategySettings: {
                        periodLow: 10,
                        periodHigh: 10,
                        requiredHistoryMaxBars: 300
                    },
                    robotSettings: {
                        volumeType: "currencyDynamic",
                        volumeInCurrency: 1000
                    },
                    activeFrom: "2020-01-01T00:00:00.000Z"
                }
            });

            const historyCandles: Candle[] = candles.slice(0, 300) as Candle[];

            const newCandles: Candle[] = candles.slice(300) as Candle[];

            robot.handleHistoryCandles(historyCandles);
            robot.initStrategy();
            await robot.initIndicators();

            robot.handleCandle(newCandles[0]);
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            robot.handleCandle(newCandles[1]);
            robot.clearEvents();
            robot.checkAlerts();
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            expect(round(robot.state.indicators["highestHigh"].result, 2)).toEqual(round(13863, 2));
            expect(round(robot.state.indicators["lowestLow"].result, 2)).toEqual(round(11404.01, 2));
        });

        it("Should run Fx Cash", async () => {
            const robot = new Robot({
                id: "some_id",
                exchange: "binance_futures",
                asset: "BTC",
                currency: "USDT",
                timeframe: 1440,
                strategy: "fx_cash",
                settings: {
                    strategySettings: {
                        fxLowB: 50,
                        macdFE: 70,
                        macdSE: 10,
                        fxHighB: 50,
                        fxSignal: 4,
                        macdSignal: 28,
                        requiredHistoryMaxBars: 300
                    },
                    robotSettings: {
                        volumeType: "currencyDynamic",
                        volumeInCurrency: 1000
                    },
                    activeFrom: "2020-01-01T00:00:00.000Z"
                }
            });

            const historyCandles: Candle[] = candles.slice(0, 300) as Candle[];

            const newCandles: Candle[] = candles.slice(300) as Candle[];

            robot.handleHistoryCandles(historyCandles);
            robot.initStrategy();
            await robot.initIndicators();

            robot.handleCandle(newCandles[0]);
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            robot.handleCandle(newCandles[1]);
            robot.clearEvents();
            robot.checkAlerts();
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            expect(round(robot.state.indicators["fxSignal"].result, 2)).toEqual(round(68.59019235653186, 2));
            expect(round(robot.state.indicators["fxHighB"].result, 2)).toEqual(round(72.08858199355669, 2));
            expect(round(robot.state.indicators["fxLowB"].result, 2)).toEqual(round(33.03057341242341, 2));
            expect(round(robot.state.indicators["macd"].result.histogram, 0)).toEqual(round(-803.6571054979397, 0));
        });

        it("Should run IRSTS", async () => {
            const robot = new Robot({
                id: "some_id",
                exchange: "binance_futures",
                asset: "BTC",
                currency: "USDT",
                timeframe: 1440,
                strategy: "irsts",
                settings: {
                    strategySettings: {
                        reversal: 17,
                        stopLoss: 7,
                        profitTarget: 22,
                        requiredHistoryMaxBars: 300
                    },
                    robotSettings: {
                        volumeType: "currencyDynamic",
                        volumeInCurrency: 1000
                    },
                    activeFrom: "2020-01-01T00:00:00.000Z"
                }
            });

            const historyCandles: Candle[] = candles.slice(0, 300) as Candle[];

            const newCandles: Candle[] = candles.slice(300) as Candle[];

            robot.handleHistoryCandles(historyCandles);
            robot.initStrategy();
            await robot.initIndicators();

            robot.handleCandle(newCandles[0]);
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            robot.handleCandle(newCandles[1]);
            robot.clearEvents();
            robot.checkAlerts();
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            Object.entries(robot.state.indicators).map(([key, indicator]) => {
                logger.debug(`${key}: ${indicator.peak?.result || indicator.trough?.result}`);
            });

            expect(round(robot.state.indicators["peak"].peak.result, 2)).toEqual(round(13629.38, 2));
            expect(round(robot.state.indicators["trough"].trough.result, 2)).toEqual(round(13629.38, 2));
        });

        it("Should run Parabolic", async () => {
            const robot = new Robot({
                id: "some_id",
                exchange: "binance_futures",
                asset: "BTC",
                currency: "USDT",
                timeframe: 1440,
                strategy: "parabolic",
                settings: {
                    strategySettings: {
                        smaSize: 50,
                        distInit: 2,
                        lookback: 20,
                        atrPeriod: 30,
                        adjustment: 0.12,
                        requiredHistoryMaxBars: 300
                    },
                    robotSettings: {
                        volumeType: "currencyDynamic",
                        volumeInCurrency: 1000
                    },
                    activeFrom: "2020-01-01T00:00:00.000Z"
                }
            });

            const historyCandles: Candle[] = candles.slice(0, 300) as Candle[];

            const newCandles: Candle[] = candles.slice(300) as Candle[];

            robot.handleHistoryCandles(historyCandles);
            robot.initStrategy();
            await robot.initIndicators();

            robot.handleCandle(newCandles[0]);
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            robot.handleCandle(newCandles[1]);
            robot.clearEvents();
            robot.checkAlerts();
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            expect(round(robot.state.indicators["sma"].result, 2)).toEqual(round(11236.480199999998, 2));
            expect(round(robot.state.indicators["atr"].result, 0)).toEqual(round(428.142582625723, 0));
            expect(round(robot.state.indicators["highestHigh"].result, 2)).toEqual(round(13863, 2));
            expect(round(robot.state.indicators["lowestLow"].result, 2)).toEqual(round(10818.44, 2));
        });

        it("Should run T2TrendFriend", async () => {
            const robot = new Robot({
                id: "some_id",
                exchange: "binance_futures",
                asset: "BTC",
                currency: "USDT",
                timeframe: 1440,
                strategy: "t2_trend_friend",
                settings: {
                    strategySettings: {
                        sma1: 75,
                        sma2: 125,
                        sma3: 50,
                        minBarsToHold: 5,
                        requiredHistoryMaxBars: 300
                    },
                    robotSettings: {
                        volumeType: "currencyDynamic",
                        volumeInCurrency: 1000
                    },
                    activeFrom: "2020-01-01T00:00:00.000Z"
                }
            });

            const historyCandles: Candle[] = candles.slice(0, 300) as Candle[];

            const newCandles: Candle[] = candles.slice(300) as Candle[];

            robot.handleHistoryCandles(historyCandles);
            robot.initStrategy();
            await robot.initIndicators();

            robot.handleCandle(newCandles[0]);
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            robot.handleCandle(newCandles[1]);
            robot.clearEvents();
            robot.checkAlerts();
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            expect(round(robot.state.indicators["sma1"].result, 2)).toEqual(round(11272.623200000011, 2));
            expect(round(robot.state.indicators["sma2"].result, 2)).toEqual(round(10806.320880000003, 2));
            expect(round(robot.state.indicators["sma3"].result, 2)).toEqual(round(11236.480199999998, 2));
        });

        it("Should run Trendline Long", async () => {
            const robot = new Robot({
                id: "some_id",
                exchange: "binance_futures",
                asset: "BTC",
                currency: "USDT",
                timeframe: 1440,
                strategy: "trendline_long",
                settings: {
                    strategySettings: {
                        stop: 6,
                        peaks: 5,
                        profit: 6,
                        requiredHistoryMaxBars: 300
                    },
                    robotSettings: {
                        volumeType: "currencyDynamic",
                        volumeInCurrency: 1000
                    },
                    activeFrom: "2020-01-01T00:00:00.000Z"
                }
            });

            const historyCandles: Candle[] = candles.slice(0, 300) as Candle[];

            const newCandles: Candle[] = candles.slice(300) as Candle[];

            robot.handleHistoryCandles(historyCandles);
            robot.initStrategy();
            await robot.initIndicators();

            robot.handleCandle(newCandles[0]);
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            robot.handleCandle(newCandles[1]);
            robot.clearEvents();
            robot.checkAlerts();
            await robot.calcIndicators();
            robot.runStrategy();
            robot.finalize();

            /*  Object.entries(robot.state.indicators).map(([key, indicator]) => {
                logger.debug(`${key}: ${indicator.peak?.result}`);
            });*/

            expect(round(robot.state.indicators["peak"].peak.result, 2)).toEqual(round(13787.83, 2));
        });
    });
});
