import { BaseIndicator } from "../BaseIndicator";
import { IndicatorState } from "@cryptuoso/robot-types";
import { DBCandle } from "@cryptuoso/market";
import { ADX } from "ta-rs";

export class HighestADX extends BaseIndicator {
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
            description: "Highest ADX Series Size",
            type: "number",
            integer: "true",
            positive: "true",
            min: 1,
            max: 100
        },
        optInTimePeriod: {
            description: "ADX optInTimePeriod",
            type: "number",
            integer: true,
            positive: true,
            min: 3,
            max: 100
        }
    };

    declare result: number;
    adxSeries: number[];
    indicators: {
        adx: ADX;
    };
    async init(candles: DBCandle[]) {
        this.result = 0;

        this.adxSeries = [];

        this.indicators = {
            adx: new ADX(this.parameters.optInTimePeriod)
        };

        for (const candle of candles) {
            await this.calc(candle);
        }
    }
    async calc(candle: DBCandle) {
        this.adxSeries.push(await this.indicators.adx.next(candle));
        this.adxSeries.slice(-this.parameters.seriesSize);

        if (this.adxSeries.length === this.parameters.seriesSize) {
            this.result = Math.max(...this.adxSeries);
            return;
        }

        this.result = 0;
    }
}
