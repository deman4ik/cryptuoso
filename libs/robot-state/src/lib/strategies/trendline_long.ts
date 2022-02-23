import { Candle } from "@cryptuoso/market";
import { BaseStrategy, StrategyState } from "../BaseStrategy";

interface TrendlineState {
    idBar: number;
    bar1: number;
    bar2: number;
    high1: number;
    high2: number;
    barOut?: number;
    enBar?: number;
    timedOut?: boolean;
}

class Trendline {
    _f = 3; //timeout factor
    timedOut: boolean; // trendline timed out
    barOut: number; // bar at which trendline times out

    idBar: number; // bar at which TL detected/confirmed
    bar1: number; // bar at which TL starts
    bar2: number; // second defining bar of the TL
    high1: number; // high at which TL starts
    high2: number; // high of second defining bar of the TL
    enBar: number; // bar at which TL ends. If equal to -1, then the TL is still active.
    constructor({ idBar, bar1, bar2, high1, high2, barOut, enBar, timedOut }: TrendlineState) {
        this.idBar = idBar;
        this.bar1 = bar1;
        this.bar2 = bar2;
        this.barOut = barOut || bar2 + (bar2 - bar1) * this._f;
        this.enBar = enBar || -1;
        this.high1 = high1;
        this.high2 = high2;
        this.timedOut = timedOut || false;
    }
    get state(): TrendlineState {
        return {
            idBar: this.idBar,
            bar1: this.bar1,
            bar2: this.bar2,
            high1: this.high1,
            high2: this.high2,
            barOut: this.barOut,
            enBar: this.enBar,
            timedOut: this.timedOut
        };
    }

    extendF(x1: number, y1: number, x2: number, y2: number, x: number) {
        return ((y2 - y1) / (x2 - x1)) * (x - x2) + y2;
    }
    extend(bar: number) {
        return this.extendF(this.bar1, this.high1, this.bar2, this.high2, bar);
    }
    trendLineTimeout(bar: number) {
        if (this.enBar == -1 && bar > this.barOut) {
            this.enBar = bar; // Deactivate the Trendline if past BarOut
            this.timedOut = true;
            return true;
        }
        return false;
    }
    isBreakout(candle: Candle, bar: number) {
        const extend = this.extend(bar);

        if (candle.close > extend) {
            this.enBar = bar;
            return true;
        }

        if (candle.high > 0.98 * extend) this.barOut = bar + (bar - this.bar1) * this._f;

        return false;
    }
}

export class TrendlineLong extends BaseStrategy {
    constructor(state: StrategyState) {
        super(state);
    }
    get parameters() {
        return this._strategySettings as {
            stop: number;
            profit: number;
            peaks: number;
        };
    }
    _parametersSchema = {
        stop: {
            description: "Stop %",
            type: "number",
            integer: true,
            positive: true,
            min: 1,
            max: 50
        },
        profit: {
            description: "Profit %",
            type: "number",
            integer: true,
            positive: true,
            min: 1,
            max: 200
        },
        peaks: {
            description: "Peaks %",
            type: "number",
            integer: true,
            positive: true,
            min: 1,
            max: 75
        }
    };
    TLs: TrendlineState[];
    init() {
        this.log("TrendlineLong Parameters", this.parameters);
        this.bar = 0;
        this.TLs = [];
        this.target = -1;
        this.riskStopLevel = null;
        this.addIndicator("peak", "peak", {
            reversalAmount: this.parameters.peaks,
            candleProp: "high"
        });
    }
    slope(bar1: number, bar2: number, val1: number, val2: number) {
        return (Math.sign(val2 - val1) * (val2 - val1)) / (bar2 - bar1);
    }
    secondPointBar(anchorBar: number) {
        let result = -1;
        let loSlope = Infinity;

        for (let n = this.bar - 1; n > anchorBar + 10; n--) {
            const slope = this.slope(
                anchorBar,
                n,
                this.candlesProps.high[this.candlesProps.high.length - 1 - (this.bar - anchorBar)],
                this.candlesProps.high[this.candlesProps.high.length - 1 - (this.bar - n)]
            );

            if (slope > 0 && slope < loSlope) {
                result = n;
                loSlope = slope;
            }
        }
        return result;
    }
    check() {
        this.bar += 1;

        const TLs = [];

        for (let i = 0; i < this.TLs.length; i += 1) {
            TLs.push(new Trendline(this.TLs[i]));
        }

        if (this.hasActivePositions) {
            const lastPosition = this.getPosition();
            this.target = lastPosition.entryPrice * (1 + this.parameters.profit / 100);

            if (
                this.candle.close < lastPosition.entryPrice * (1 - this.parameters.stop / 100) ||
                this.candle.high >= this.target
            )
                lastPosition.sellAtMarket();
            else lastPosition.sellAtStop(this.riskStopLevel);
        }

        if (this.indicators.peak.updated) {
            const anchor = this.indicators.peak.peak.candle.time;
            const anchorBar =
                this.candles.findIndex(({ time }) => time === anchor) - this.candles.length + 1 + this.bar;
            const pt = this.secondPointBar(anchorBar);

            if (pt != -1) {
                const tL = new Trendline({
                    idBar: this.bar,
                    bar1: anchorBar,
                    bar2: pt,
                    high1: this.candlesProps.high[this.candlesProps.high.length - 1 - (this.bar - anchorBar)],
                    high2: this.candlesProps.high[this.candlesProps.high.length - 1 - (this.bar - pt)]
                });
                if (this.bar < tL.barOut) TLs.push(tL);
            }
        }

        const newTLs = [];
        for (let i = 0; i < TLs.length; i += 1) {
            const tL = TLs[i];
            if (tL.isBreakout(this.candle, this.bar) && !this.hasActivePositions) {
                const position = this.createPosition();
                position.buyAtMarket();
                this.riskStopLevel = this.candle.close * (1 - this.parameters.stop / 100);
            } else if (tL.trendLineTimeout(this.bar)) {
                const pt2 = this.secondPointBar(tL.bar2);

                const tnew = new Trendline({
                    idBar: this.bar,
                    bar1: tL.bar2,
                    bar2: pt2,
                    high1: this.candlesProps.high[this.candlesProps.high.length - 1 - (this.bar - tL.bar2)],
                    high2: this.candlesProps.high[this.candlesProps.high.length - 1 - (this.bar - pt2)]
                });
                if (this.bar < tnew.barOut && tnew.extend(this.bar) > this.candle.close) {
                    newTLs.push(tnew);
                }
            }
        }
        this.TLs = [];
        for (let i = 0; i < TLs.length; i += 1) {
            if (TLs[i].enBar === -1) this.TLs.push(TLs[i].state);
        }
        for (let i = 0; i < newTLs.length; i += 1) {
            this.TLs.push(TLs[i].state);
        }
    }
}
