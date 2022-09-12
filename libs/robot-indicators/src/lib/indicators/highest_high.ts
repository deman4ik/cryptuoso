import { BaseIndicator } from "../BaseIndicator";
import { IndicatorState } from "@cryptuoso/robot-types";
import { DBCandle } from "@cryptuoso/market";
export class HighestHigh extends BaseIndicator {
    declare result: number;
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
    async init(candles: DBCandle[]) {
        this.result = 0;
        this.highestSeries = [];
        for (const candle of candles) {
            await this.calc(candle);
        }
    }
    async calc(candle: DBCandle) {
        this.result = 0;

        // collecting required items count
        if (this.highestSeries.length < this.parameters.seriesSize) {
            this.highestSeries.push(candle.high);
        }
        if (this.highestSeries.length === this.parameters.seriesSize) {
            this.result = Math.max(...this.highestSeries); // save higest high of XX items including(!) current item
            // remove first item
            this.highestSeries.shift();
        }
    }
}
