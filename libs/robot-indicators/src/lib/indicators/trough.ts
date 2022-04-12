import { BaseIndicator } from "../BaseIndicator";
import { IndicatorState } from "@cryptuoso/robot-types";
export class Trough extends BaseIndicator {
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
        this.prevTrough = {
            candle: null,
            result: 0
        };
        this.trough = {
            candle: null,
            result: 0
        };
        this.lowest = {
            candle: null,
            result: 0
        };
        this.targetValue = 0;
        this.updated = false;
        this.candleProp = this.parameters.candleProp || "close";
    }
    async calc() {
        this.updated = false;
        if (this.targetValue && this.candle[this.candleProp] > this.targetValue) {
            this.prevTrough = {
                ...this.trough
            };
            this.trough = { ...this.lowest };

            this.lowest = {
                candle: this.candle,
                result: this.candle[this.candleProp]
            };
            this.targetValue = 0;
            this.updated = true;
            return;
        }

        if (!this.targetValue && this.lowest.result) {
            this.targetValue = this.utils.addPercent(this.lowest.result, this.parameters.reversalAmount);
        }

        if ((!this.targetValue && !this.lowest.result) || this.lowest.result > this.candle[this.candleProp]) {
            this.lowest = {
                candle: this.candle,
                result: this.candle[this.candleProp]
            };
            this.targetValue = this.utils.addPercent(this.lowest.result, this.parameters.reversalAmount);
            if (!this.trough.result) this.trough.result = this.candle[this.candleProp];
        }
    }
}
