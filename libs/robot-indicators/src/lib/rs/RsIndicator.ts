import { IndicatorState } from "@cryptuoso/robot-types";
import { BaseIndicator } from "../BaseIndicator";
import { SmaIndicator } from "@cryptuoso/rs";

export class RsIndicator extends BaseIndicator {
    indicator: SmaIndicator;

    constructor(state: IndicatorState) {
        super(state);
        this._parametersSchema = {
            candlesLength: {
                description: "Candles window length",
                type: "number",
                integer: "true",
                positive: "true",
                min: 1,
                max: this._strategySettings?.requiredHistoryMaxBars || 1,
                optional: true
            }
        };

        this.indicator = new SmaIndicator(this.parameters["optInTimePeriod"]);
    }

    async calc() {
        this.result = this.indicator.calc(this.candles[this.candles.length - 1].close);
    }
}
