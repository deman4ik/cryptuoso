import { BaseIndicator } from "../BaseIndicator";
import { IndicatorState } from "@cryptuoso/robot-types";
export class LowestLow extends BaseIndicator {
    constructor(state: IndicatorState) {
        super(state);
    }
    get parameters() {
        return this._parameters as {
            seriesSize: number;
            optInTimePeriod: number;
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
        this.lowestSeries = [];
    }
    calc() {
        this.result = 0;
        // if we have cached candles working with array
        if (this.candlesProps.low.length > 1) {
            const lowestSeries = this.candlesProps.low.slice(-this.parameters.seriesSize);
            // if we have enough cache returning result, otherwise leave null
            if (lowestSeries.length === this.parameters.seriesSize) {
                this.result = Math.min(...lowestSeries); // save lowest low of XX items including(!) current item
            }
        }
        // without cache working with 1 candle
        else if (this.parameters.seriesSize) {
            // collecting required items count
            if (this.lowestSeries.length < this.parameters.seriesSize) {
                this.lowestSeries.push(this.candle.low);
            }
            if (this.lowestSeries.length === this.parameters.seriesSize) {
                this.result = Math.min(...this.lowestSeries); // save lowest low of XX items including(!) current item
                // remove first item
                this.lowestSeries.shift();
            }
        }
    }
}
