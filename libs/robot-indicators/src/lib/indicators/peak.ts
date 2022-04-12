import { BaseIndicator } from "../BaseIndicator";
import { IndicatorState } from "@cryptuoso/robot-types";

export class Peak extends BaseIndicator {
    constructor(state: IndicatorState) {
        super(state);
    }
    get parameters() {
        return this._parameters as {
            reversalAmount: number;
            candleProp: "open" | "high" | "low" | "close";
        };
    }
    _parametersSchema = {
        reversalAmount: {
            type: "number",
            integer: true,
            positive: true,
            min: 1,
            max: 100
        },
        candleProp: {
            type: "enum",
            values: ["open", "high", "low", "close"],
            optional: true
        }
    };
    candleProp: "open" | "high" | "low" | "close";
    init() {
        this.prevPeak = {
            candle: null,
            result: 0
        };
        this.peak = {
            candle: null,
            result: 0
        };
        this.highest = {
            candle: null,
            result: 0
        };
        this.targetValue = 0;
        this.updated = false;
        this.candleProp = this.parameters.candleProp || "close";
    }
    async calc() {
        this.updated = false;
        if (this.targetValue && this.candle[this.candleProp] < this.targetValue) {
            this.prevPeak = {
                ...this.peak
            };
            this.peak = { ...this.highest };

            this.highest = {
                candle: this.candle,
                result: this.candle[this.candleProp]
            };
            this.targetValue = 0;
            this.updated = true;
            return;
        }

        if (!this.targetValue && this.highest.result) {
            this.targetValue = this.utils.addPercent(this.highest.result, -this.parameters.reversalAmount);
        }

        if ((!this.targetValue && !this.highest.result) || this.highest.result < this.candle[this.candleProp]) {
            this.highest = {
                candle: this.candle,
                result: this.candle[this.candleProp]
            };

            this.targetValue = this.utils.addPercent(this.highest.result, -this.parameters.reversalAmount);
            if (!this.peak.result) this.peak.result = this.candle[this.candleProp];
        }
    }
}
