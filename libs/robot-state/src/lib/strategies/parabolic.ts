import { BaseStrategy, StrategyState } from "../BaseStrategy";

export class Parabolic extends BaseStrategy {
    constructor(state: StrategyState) {
        super(state);
    }
    get parameters() {
        return this._strategySettings as {
            distInit: number;
            adjustment: number;
            atrPeriod: number;
            smaSize: number;
            lookback: number;
        };
    }
    _parametersSchema = {
        distInit: {
            description: "Stop init",
            type: "number",
            positive: true,
            min: 0,
            max: 100
        },
        adjustment: {
            description: "Adjustment",
            type: "number",
            positive: true,
            min: 0,
            max: 100
        },
        atrPeriod: {
            description: "ATR period",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 100
        },
        smaSize: {
            description: "SMA size",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 400
        },
        lookback: {
            description: "Lookback",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 1000
        }
    };
    init() {
        this.log("Parabolic Parameters", this.parameters);
        this.dist = this.parameters.distInit;
        this.addRsIndicator("sma", "TaSMA", {
            period: this.parameters.smaSize,
            candleProp: "close"
        });
        this.addRsIndicator("atr", "ATR", {
            period: this.parameters.atrPeriod
        });
        this.addRsIndicator("highestHigh", "TaMaximum", {
            period: this.parameters.lookback,
            candleProp: "high"
        });
        this.addRsIndicator("lowestLow", "TaMinimum", {
            period: this.parameters.lookback,
            candleProp: "low"
        });
    }
    calcKER() {
        let a = 0;
        let b = 0;
        const per = this.parameters.atrPeriod + 2; // +1 т.к. так же реализовано в параболике из WL
        const series = this.candles.slice(-per).map((c) => c.close);
        a = Math.abs(series[series.length - 1] - series[1]); // series[1] т.к. так же реализовано в параболике из WL
        for (let i = 1; i < series.length; i += 1) {
            b += Math.abs(series[i] - series[i - 1]);
        }
        const result = a / b;
        return result;
    }
    check() {
        const { adjustment, distInit } = this.parameters;
        const sma = this.indicators.sma.result;
        const atr = this.indicators.atr.result;
        const highestHigh = this.indicators.highestHigh.result;
        const lowestLow = this.indicators.lowestLow.result;
        const ker = this.calcKER();
        if (this.hasActivePositions) {
            const lastPosition = this.getPosition();

            if (ker > 0.3) this.dist -= 1 * adjustment;
            if (ker > 0.6) this.dist -= 2 * adjustment;

            if (lastPosition.direction === this.CONSTS.LONG) {
                lastPosition.sellAtTrailingStop(lastPosition.highestHigh - atr * this.dist);
            } else {
                lastPosition.coverAtTrailingStop(lastPosition.lowestLow + atr * this.dist);
            }
        } else {
            const position = this.createPosition();
            this.dist = distInit;
            if (this.candle.close > sma) {
                position.buyAtStop(highestHigh);
            } else {
                position.shortAtStop(lowestLow);
            }
        }
    }
}
