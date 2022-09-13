import { BaseStrategy, StrategyState } from "../BaseStrategy";

export class T2TF extends BaseStrategy {
    constructor(state: StrategyState) {
        super(state);
    }
    get parameters() {
        return this._strategySettings as {
            sma1: number;
            sma2: number;
            sma3: number;
            minBarsToHold: number;
        };
    }
    _parametersSchema = {
        sma1: {
            description: "SMA 1 window length",
            type: "number",
            integer: true,
            positive: true,
            min: 1,
            max: 300
        },
        sma2: {
            description: "SMA 2 window length",
            type: "number",
            integer: true,
            positive: true,
            min: 1,
            max: 300
        },
        sma3: {
            description: "SMA 3 window length",
            type: "number",
            integer: true,
            positive: true,
            min: 1,
            max: 300
        },
        minBarsToHold: {
            description: "Minimum bars to hold",
            type: "number",
            integer: true,
            positive: true,
            min: 1,
            max: 100
        }
    };
    init() {
        this.log("T2TF Parameters", this.parameters);
        this.heldEnoughBars = 0;
        this.addRsIndicator("sma1", "TaSMA", {
            period: this.parameters.sma1
        });
        this.addRsIndicator("sma2", "TaSMA", {
            period: this.parameters.sma2
        });
        this.addRsIndicator("sma3", "TaSMA", {
            period: this.parameters.sma3
        });
    }
    check() {
        const { minBarsToHold } = this.parameters;
        const sma1 = this.indicators.sma1.result;
        const sma2 = this.indicators.sma2.result;
        const sma3 = this.indicators.sma3.result;
        if (this.hasActivePositions) {
            const lastPosition = this.getPosition();
            if (lastPosition.direction === this.CONSTS.LONG) {
                this.heldEnoughBars += 1;
                if (this.candle.close < sma1 && this.heldEnoughBars > minBarsToHold) {
                    this.heldEnoughBars = 0;
                    lastPosition.sellAtMarket();
                }
            }
        } else if (this.candle.close > sma1 && sma1 > sma2 && sma1 > sma3 && sma2 > sma3) {
            this.heldEnoughBars = 1;
            const position = this.createPosition();
            position.buyAtMarket();
        }
    }
}
