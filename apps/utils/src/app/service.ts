import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { Tracer } from "@cryptuoso/logger";
import { sql } from "@cryptuoso/postgres";
import { DBCandle } from "@cryptuoso/market";
import { RsIndicator, TulipIndicator } from "@cryptuoso/robot-indicators";
import {
    RobotSettings,
    RobotState,
    T2TrendFriendRobot,
    T2TrendFriendStrategyParams,
    T2TrendFriendStrategyState
} from "@cryptuoso/rs";

export type UtilsServiceConfig = HTTPServiceConfig;

export default class UtilsService extends HTTPService {
    constructor(config?: UtilsServiceConfig) {
        super(config);

        try {
            this.addOnStartedHandler(this.onStartRS);
        } catch (err) {
            this.log.error("Error while constructing UtilsService", err);
        }
    }
    async onStartRS() {
        /*   const robotSettings: RobotSettings = {
            exchange: "binance_futures",

            timeframe: 30,
            strategySettings: {
                strategyType: "t2_trend_friend",
                backtest: true
            }
        };
        const strategyParams: T2TrendFriendStrategyParams = {
            sma1: 50,
            sma2: 175,
            sma3: 100,
            minBarsToHold: 5
        };
        const strategyState: T2TrendFriendStrategyState = {
            sma1Result: undefined,
            sma2Result: undefined,
            sma3Result: undefined,
            barsHeld: undefined
        };

        const robotState: RobotState = {
            positionLastNum: undefined,
            positions: undefined
        }; */
        //const robot = new T2TrendFriendRobot(robotSettings, strategyParams, strategyState, robotState);

        const candlesDB = await this.db.pg
            .many<DBCandle>(sql`SELECT time, timestamp, timeframe, open, high, low, close, volume 
        FROM candles
        WHERE exchange = 'binance_futures' and asset = 'REN' and currency = 'USDT' and timeframe = 30
        ORDER BY time ASC limit 10000;`);
        const candles = [...candlesDB];

        const tulip = new RsIndicator({
            exchange: "binance_futures",
            asset: "REM",
            currency: "USDT",
            name: "sma",
            indicatorName: "sma",
            parameters: {
                optInTimePeriod: 30
            }
        });

        const tracer = new Tracer();
        const traceRust = tracer.start("BACKTEST");

        const currentCandles = [];
        for (const candle of candles) {
            currentCandles.push(candle);
            currentCandles.slice(-30);
            tulip._handleCandles(
                currentCandles[currentCandles.length - 1],
                currentCandles
                //   tulip.prepareCandles(currentCandles)
            );
            await tulip.calc();
            //  this.log.info(candle.timestamp, tulip.result);
        }

        tracer.end(traceRust);
        this.log.info(tracer.state);
    }

    /* async onStart() {
        const candles = await this.db.pg.many<DBCandle>(sql`SELECT open, high, low, close, volume 
        FROM candles
        WHERE exchange = 'binance_futures' and asset = 'BTC' and currency = 'USDT' and timeframe = 1440
        ORDER BY timestamp ASC LIMIT 300;`);

        //  fs.writeFileSync("testResults/candles.json", JSON.stringify(candles));
        const tulip = new TulipIndicator({
            exchange: "binance_futures",
            asset: "BTC",
            currency: "USDT",
            name: "adx",
            indicatorName: "adx",
            parameters: {
                optInTimePeriod: 30
            }
        });
        tulip._handleCandles(candles[candles.length - 1], [...candles], tulip.prepareCandles([...candles]));
        const tracer = new Tracer();

        //RUST START
        const traceRust = tracer.start("RUST");

        const resultRust = sum(2, 3);

        tracer.end(traceRust);

        this.log.info(resultRust);
        //RUST END

        // TULIP START
        const traceTulip = tracer.start("TULIP");

        await tulip.calc();

        tracer.end(traceTulip);

        this.log.info(tulip.result);
        // TULIP END

        this.log.info(tracer.state);
    } */
}
