import { BaseStrategy, StrategyState } from "../BaseStrategy";

export class Breakout extends BaseStrategy {
    constructor(state: StrategyState) {
        super(state);
    }
    get parameters() {
        return this._strategySettings as {
            adxPeriod: number;
            adxHigh: number;
            lookback: number;
            trailBars: number;
        };
    }
    _parametersSchema = {
        adxPeriod: {
            description: "ADX period",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 100
        },
        adxHigh: {
            description: "ADX upper limit value",
            type: "number",
            //integer: true,
            positive: true,
            min: 10,
            max: 100
        },
        lookback: {
            description: "ADX below the limit within the lookback",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 100,
            optional: true
        },
        trailBars: {
            description: "Trailing stop period",
            type: "number",
            integer: true,
            positive: true,
            min: 0,
            max: 100
        }
    };
    init() {
        this.log("Breakout Parameters", this.parameters);
        this.addIndicator("highestHigh", "highest_high", {
            seriesSize: this.parameters.trailBars
        });
        this.addIndicator("lowestLow", "lowest_low", {
            seriesSize: this.parameters.trailBars
        });
        this.addIndicator("highestHighLookback", "highest_high", {
            seriesSize: this.parameters.lookback
        });
        this.addIndicator("lowestLowLookback", "lowest_low", {
            seriesSize: this.parameters.lookback
        });
        this.addIndicator("highestADX", "highest_adx", {
            seriesSize: this.parameters.lookback,
            optInTimePeriod: this.parameters.adxPeriod
        });
    }
    check() {
        const { adxHigh } = this.parameters;
        const highestHigh = this.indicators.highestHigh.result;
        const lowestLow = this.indicators.lowestLow.result;
        const highestHighLookback = this.indicators.highestHighLookback.result;
        const lowestLowLookback = this.indicators.lowestLowLookback.result;
        const highestADX = this.indicators.highestADX.result;

        if (this.hasActivePositions) {
            const lastPosition = this.getPosition();
            if (lastPosition.direction === this.CONSTS.LONG) {
                lastPosition.sellAtTrailingStop(lowestLow);
            } else {
                lastPosition.coverAtTrailingStop(highestHigh);
            }
        } else {
            if (highestADX < adxHigh) {
                const position = this.createPosition();
                this.stop = null;
                position.buyAtStop(highestHighLookback);
                position.shortAtStop(lowestLowLookback);
            }
        }
    }
}
