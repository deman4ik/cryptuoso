import { BaseStrategy, StrategyState } from "../BaseStrategy";

export class CounterCandle extends BaseStrategy {
    constructor(state: StrategyState) {
        super(state);
    }
    get parameters() {
        return this._strategySettings as {
            highest: number;
            z: number;
            n: number;
            yClose: number;
            xClose: number;
        };
    }
    parametersSchema = {
        highest: {
            description: "Highest",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 100
        },
        z: {
            description: "Z",
            type: "number",
            positive: true,
            min: 0.1,
            max: 5
        },
        n: {
            description: "N",
            type: "number",
            positive: true,
            min: 0.1,
            max: 5
        },
        yClose: {
            description: "Y Close",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 100
        },
        xClose: {
            description: "X Close",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 100
        }
    };
    init() {
        this.log("CounterCandle Parameters", this.parameters);
        this.addIndicator("highestHigh", "highest_high", {
            seriesSize: this.parameters.highest
        });
        this.addIndicator("lowestLow", "lowest_low", {
            seriesSize: this.parameters.highest
        });
    }
    check() {
        if (this.hasActivePositions) {
            const lastPosition = this.getPosition();
            if (lastPosition.direction === this.CONSTS.LONG) {
                lastPosition.sellAtTrailingStop(this.indicators.lowestLow.result);
            } else {
                lastPosition.coverAtTrailingStop(this.indicators.highestHigh.result);
            }
        } else {
            const prevCandle = this.candles[this.candles.length - 2];
            const lastCandle = this.candles[this.candles.length - 1];

            const z = (prevCandle.high - prevCandle.open) / (prevCandle.close - prevCandle.open);
            const n = (prevCandle.open - prevCandle.low) / (prevCandle.open - prevCandle.close);

            if (
                prevCandle.open < prevCandle.close &&
                lastCandle.open > lastCandle.close &&
                z >= this.parameters.z &&
                lastCandle.close > this.candles[this.candles.length - 1 - this.parameters.xClose].close
            ) {
                const position = this.createPosition();
                this.stop = null;
                position.shortAtMarket();
            } else if (
                prevCandle.open > prevCandle.close &&
                lastCandle.open < lastCandle.close &&
                n >= this.parameters.n &&
                lastCandle.close < this.candles[this.candles.length - 1 - this.parameters.yClose].close
            ) {
                const position = this.createPosition();
                this.stop = null;
                position.buyAtMarket();
            }
        }
    }
}
