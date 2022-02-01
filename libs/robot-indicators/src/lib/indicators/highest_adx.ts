import { BaseIndicator, IndicatorState } from "../BaseIndicator";

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
    parametersSchema = {
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
    init() {
        this.result = 0;
        this.requiredCache = this.parameters.seriesSize + this.parameters.optInTimePeriod * 2;
        this[`tulip_adx_series`] = [];
    }
    async calc() {
        if (this.candles.length >= this.requiredCache) {
            const adxSeries = await this.calcTulipSeries(
                "adx",
                "adx",
                { optInTimePeriod: this.parameters.optInTimePeriod },
                this.parameters.seriesSize
            );
            if (adxSeries.length === this.parameters.seriesSize) {
                this.result = Math.max(...adxSeries);
                return;
            }
        }
        this.result = 0;
    }
}
