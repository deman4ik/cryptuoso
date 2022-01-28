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
    parametersSchema = {
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
        this.addTulipIndicator("fxSignal", "rsiLow", {
            optInTimePeriod: this.parameters.fxSignal
        });
        this.addIndicator("fxHighB", "fx_high_band", {
            seriesSize: 30,
            optInTimePeriod: 8,
            mod: this.parameters.fxHighB
        });
        this.addIndicator("fxLowB", "fx_low_band", {
            seriesSize: 30,
            optInTimePeriod: 8,
            mod: this.parameters.fxLowB
        });
        this.addTulipIndicator("macd", "macd", {
            optInFastPeriod: this.parameters.macdFE,
            optInSlowPeriod: this.parameters.macdSE,
            optInSignalPeriod: this.parameters.macdSignal
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
                    this.crossUnder(this.prevInds.macd, 0, this.indicators.macd.macdHistogram, 0) ||
                    this.indicators.macd.macdHistogram < 0;
                const signalFilterSell =
                    this.crossOver(this.prevInds.macd, 0, this.indicators.macd.macdHistogram, 0) ||
                    this.indicators.macd.macdHistogram > 0;

                if (signalBuy && signalFilterBuy) {
                    const position = this.createPosition();
                    position.buyAtMarket();
                } else if (signalShort && signalFilterSell) {
                    const position = this.createPosition();
                    position.shortAtMarket();
                }
            }
        }

        this.prevInds.macd = this.indicators.macd.macdHistogram;
        this.prevInds.fxSignal = this.indicators.fxSignal.result;
        this.prevInds.fxHighB = this.indicators.fxHighB.result;
        this.prevInds.fxLowB = this.indicators.fxLowB.result;
    }
}
