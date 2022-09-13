import { BaseStrategy, StrategyState } from "../BaseStrategy";

export class FXCash extends BaseStrategy {
    constructor(state: StrategyState) {
        super(state);
    }
    get parameters() {
        return this._strategySettings as {
            macdFE: number;
            macdSE: number;
            macdSignal: number;
            fxSignal: number;
            fxHighB: number;
            fxLowB: number;
        };
    }
    _parametersSchema = {
        macdFE: {
            description: "MACD Histogram Fast EMA",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 300
        },
        macdSE: {
            description: "MACD Histogram Slow EMA",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 300
        },
        macdSignal: {
            description: "MACD Histogram Signal",
            type: "number",
            integer: true,
            positive: true,
            min: 0,
            max: 100
        },
        fxSignal: {
            description: "FX Signal",
            type: "number",
            integer: true,
            positive: true,
            min: 0,
            max: 100
        },
        fxHighB: {
            description: "FX High Band",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 200
        },
        fxLowB: {
            description: "FX Low Band",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 200
        }
    };
    init() {
        this.log("FXCash Parameters", this.parameters);
        this.addRsIndicator("fxSignal", "RSI", {
            period: this.parameters.fxSignal,
            candleProp: "low"
        });
        this.addRsIndicator("fxHighB", "FXHighBand", {
            period: 30,
            rsiPeriod: 8,
            modifier: this.parameters.fxHighB
        });
        this.addRsIndicator("fxLowB", "FXLowBand", {
            period: 30,
            rsiPeriod: 8,
            modifier: this.parameters.fxLowB
        });
        this.addRsIndicator("macd", "TaMACD", {
            fastPeriod: this.parameters.macdFE,
            slowPeriod: this.parameters.macdSE,
            signalPeriod: this.parameters.macdSignal,
            candleProp: "close"
        });

        this.prevInds = {
            macd: null,
            fxSignal: null,
            fxHighB: null,
            fxLowB: null
        };
    }
    crossOver(prevCurrent: number, prevTarget: number, current: number, target: number) {
        return current > target && prevCurrent <= prevTarget;
    }
    crossUnder(prevCurrent: number, prevTarget: number, current: number, target: number) {
        return current < target && prevCurrent >= prevTarget;
    }
    check() {
        if (
            this.prevInds.macd !== null &&
            this.prevInds.fxSignal !== null &&
            this.prevInds.fxHighB !== null &&
            this.prevInds.fxLowB !== null
        ) {
            if (this.hasActivePositions) {
                const lastPosition = this.getPosition();
                if (lastPosition.direction === this.CONSTS.LONG) {
                    if (
                        this.crossUnder(
                            this.prevInds.fxSignal,
                            this.prevInds.fxHighB,
                            this.indicators.fxSignal.result,
                            this.indicators.fxHighB.result
                        )
                    ) {
                        lastPosition.sellAtMarket();
                    }
                } else {
                    if (
                        this.crossOver(
                            this.prevInds.fxSignal,
                            this.prevInds.fxLowB,
                            this.indicators.fxSignal.result,
                            this.indicators.fxLowB.result
                        )
                    ) {
                        lastPosition.coverAtMarket();
                    }
                }
            } else {
                const signalBuy = this.crossOver(
                    this.prevInds.fxSignal,
                    this.prevInds.fxLowB,
                    this.indicators.fxSignal.result,
                    this.indicators.fxLowB.result
                );
                const signalShort = this.crossUnder(
                    this.prevInds.fxSignal,
                    this.prevInds.fxHighB,
                    this.indicators.fxSignal.result,
                    this.indicators.fxHighB.result
                );

                const signalFilterBuy =
                    this.crossUnder(this.prevInds.macd, 0, this.indicators.macd.result.histogram, 0) ||
                    this.indicators.macd.result.histogram < 0;
                const signalFilterSell =
                    this.crossOver(this.prevInds.macd, 0, this.indicators.macd.result.histogram, 0) ||
                    this.indicators.macd.result.histogram > 0;

                if (signalBuy && signalFilterBuy) {
                    const position = this.createPosition();
                    position.buyAtMarket();
                } else if (signalShort && signalFilterSell) {
                    const position = this.createPosition();
                    position.shortAtMarket();
                }
            }
        }

        this.prevInds.macd = this.indicators.macd.result.histogram;
        this.prevInds.fxSignal = this.indicators.fxSignal.result;
        this.prevInds.fxHighB = this.indicators.fxHighB.result;
        this.prevInds.fxLowB = this.indicators.fxLowB.result;
    }
}
