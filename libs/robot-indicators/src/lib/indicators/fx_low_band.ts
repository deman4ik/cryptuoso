import { BaseIndicator, IndicatorState } from "../BaseIndicator";

export class FXLowBand extends BaseIndicator {
    constructor(state: IndicatorState) {
        super(state);
    }
    get parameters() {
        return this._parameters as {
            mod: number;
            seriesSize: number;
            optInTimePeriod: number;
        };
    }
    _parametersSchema = {
        seriesSize: {
            description: "StdDev Series Size",
            type: "number",
            integer: "true",
            positive: "true",
            min: 1,
            max: 100
        },
        optInTimePeriod: {
            description: "RSI optInTimePeriod ",
            type: "number",
            integer: true,
            positive: true,
            min: 3,
            max: 100
        },
        mod: {
            description: "Modifier",
            type: "number",
            integer: "true",
            positive: "true",
            min: 1,
            max: 100
        }
    };
    init() {
        this.result = 0;
        this.requiredCache = this.parameters.seriesSize + this.parameters.optInTimePeriod;
    }
    async calc() {
        if (this.candles.length >= this.requiredCache) {
            const rsiSeries = await this.calcTulipSeries(
                "rsiLow",
                "rsiLow",
                {
                    optInTimePeriod: this.parameters.optInTimePeriod
                },
                this.parameters.seriesSize
            );
            if (rsiSeries.length === this.parameters.seriesSize) {
                const rsiCurrent = rsiSeries[rsiSeries.length - 1];
                const stdDevValue = this.standardDeviation(rsiSeries);

                this.result = rsiCurrent / 30 - stdDevValue * 1.3185 + this.parameters.mod;

                return;
            }
        }
        this.result = 0;
    }
}
