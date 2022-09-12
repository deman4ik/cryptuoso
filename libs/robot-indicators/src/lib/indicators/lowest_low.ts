import { BaseIndicator } from "../BaseIndicator";
import { IndicatorState } from "@cryptuoso/robot-types";
import { DBCandle } from "@cryptuoso/market";
export class LowestLow extends BaseIndicator {
    declare result: number;
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
    async init(candles: DBCandle[]) {
        this.result = 0;
        this.lowestSeries = [];
        for (const candle of candles) {
            await this.calc(candle);
        }
    }
    async calc(candle: DBCandle) {
        this.result = 0;

        // collecting required items count
        if (this.lowestSeries.length < this.parameters.seriesSize) {
            this.lowestSeries.push(candle.low);
        }
        if (this.lowestSeries.length === this.parameters.seriesSize) {
            this.result = Math.min(...this.lowestSeries); // save lowest low of XX items including(!) current item
            // remove first item
            this.lowestSeries.shift();
        }
    }
}
