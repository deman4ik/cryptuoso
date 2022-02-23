import { BaseIndicator, IndicatorState } from "../BaseIndicator";

export class ChannelADX extends BaseIndicator {
    constructor(state: IndicatorState) {
        super(state);
    }
    get parameters() {
        return this._parameters as {
            ratio: number;
            seriesSize: number;
            optInTimePeriod: number;
        };
    }
    _parametersSchema = {
        ratio: {
            description: "Ratio",
            type: "number",
            integer: true,
            positive: true,
            min: 5,
            max: 400
        },
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
        this.result = {
            adx: 0,
            value: 0,
            high: 0,
            low: 0
        };
        this.requiredCache = this.parameters.optInTimePeriod * 2;
    }
    async calc() {
        const { ratio, optInTimePeriod, seriesSize } = this.parameters;
        if (this.candles.length >= this.requiredCache) {
            const adxSeries = await this.calcTulipSeries("adx", "adx", { optInTimePeriod }, seriesSize);
            if (adxSeries.length === seriesSize) {
                const channelSeries = [];
                for (let i = 0; i < adxSeries.length; i += 1) {
                    channelSeries.push(Math.max(Math.trunc(ratio / adxSeries[i]), 1));
                }

                this.result.adx = adxSeries[adxSeries.length - 1];
                this.result.value = channelSeries[channelSeries.length - 1];
                this.result.high = this.getHighest("high", this.result.value);
                this.result.low = this.getLowest("low", this.result.value);
                return;
            }
        }
        this.result = {
            adx: 0,
            value: 0,
            high: 0,
            low: 0
        };
    }
}
