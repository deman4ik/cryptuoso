import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { Tracer } from "@cryptuoso/logger";
import { sql } from "@cryptuoso/postgres";
import { DBCandle } from "@cryptuoso/market";
import { TulipIndicator } from "@cryptuoso/robot-indicators";
import { StrategyType, T2TrendFriendRobot } from "@cryptuoso/rs";

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
        const robot = new T2TrendFriendRobot(1440, { state: "initial" });

        const result = robot.run();

        this.log.info(result);
        this.log.info(robot.strategyType);
        this.log.info(robot.timeframe);
        this.log.info(robot.state);
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
