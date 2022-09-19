import candles from "./data/check_adx_candles.json";
import { RsIndicator } from "../lib/RsIndicator";
import { DBCandle } from "@cryptuoso/market";
import logger from "@cryptuoso/logger";
global.setImmediate = jest.useRealTimers as unknown as typeof setImmediate;
describe("Test 'RsIndicator'", () => {
    it("Should calc MaxADX", async () => {
        const indicator = new RsIndicator({
            name: "ADX",
            indicatorName: "ADX",
            exchange: "binance_futures",
            asset: "BTC",
            currency: "USDT",
            interval: "1440",
            robotId: "test",
            strategySettings: {
                requiredHistoryMaxBars: 300
            },
            parameters: {
                period: 30
                //adxPeriod: 25,
                //  candleProp: "high"
            }
        });
        const historyCandles: DBCandle[] = candles.slice(0, 300) as DBCandle[];
        const newCandles: DBCandle[] = candles.slice(300) as DBCandle[];
        await indicator.init(historyCandles);

        for (const candle of newCandles) {
            await indicator.calc(candle);
            //logger.info(`${candle.timestamp} - ${indicator.result}`);
        }
    });
});
