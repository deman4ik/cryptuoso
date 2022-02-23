import { BaseIndicator, IndicatorState } from "../BaseIndicator";

export class HighestHigh extends BaseIndicator {
    constructor(state: IndicatorState) {
        super(state);
    }
    get parameters() {
        return this._parameters as {
            seriesSize: number;
        };
    }
    _parametersSchema = {
        seriesSize: {
            description: "Highest Series Size",
            type: "number",
            integer: "true",
            positive: "true",
            min: 1,
            max: 100
        }
    };
    init() {
        this.result = 0;
        this.highestSeries = [];
    }
    calc() {
        this.result = 0;
        // if we have cached candles working with array
        if (this.candlesProps.high.length > 1) {
            const highestSeries = this.candlesProps.high.slice(-this.parameters.seriesSize);
            // if we have enough cache returning result, otherwise leave null
            if (highestSeries.length === this.parameters.seriesSize) {
                this.result = Math.max(...highestSeries); // save higest high of XX items including(!) current item
            }
        }
        // without cache working with 1 candle
        else if (this.parameters.seriesSize) {
            // collecting required items count
            if (this.highestSeries.length < this.parameters.seriesSize) {
                this.highestSeries.push(this.candle.high);
            }
            if (this.highestSeries.length === this.parameters.seriesSize) {
                this.result = Math.max(...this.highestSeries); // save higest high of XX items including(!) current item
                // remove first item
                this.highestSeries.shift();
            }
        }
    }
}
