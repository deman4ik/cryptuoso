import { BaseStrategy, StrategyState } from "../BaseStrategy";

export class Breakoutv2 extends BaseStrategy {
    constructor(state: StrategyState) {
        super(state);
    }
    get parameters() {
        return this._strategySettings as {
            adxPeriod: number;
            adxHigh: number;
            lookback: number;
            orderStopLoss: number;
            orderTakeProfit: number;
        };
    }
    _parametersSchema = {
        adxPeriod: {
            description: "ADX period",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 100
        },
        adxHigh: {
            description: "ADX upper limit value",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 100
        },
        lookback: {
            description: "ADX below the limit within the lookback",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 1000
        },
        orderStopLoss: {
            description: "stoploss step (in coins)",
            type: "number",
            positive: true,
            min: 0,
            max: 1000
        },
        orderTakeProfit: {
            description: "takeprofit step (in coins)",
            type: "number",
            positive: true,
            min: 0,
            max: 1000
        }
    };
    init() {
        this.addRsIndicator("highestHighLookback", "TaMaximum", {
            period: this.parameters.lookback,
            candleProp: "high"
        });
        this.addRsIndicator("lowestLowLookback", "TaMinimum", {
            period: this.parameters.lookback,
            candleProp: "low"
        });
        this.addRsIndicator("highestADX", "MaxADX", {
            period: this.parameters.lookback,
            adxPeriod: this.parameters.adxPeriod
        });
    }
    check() {
        const highestHighLookback = this.indicators.highestHighLookback.result;
        const lowestLowLookback = this.indicators.lowestLowLookback.result;
        const highestADX = this.indicators.highestADX.result;
        if (this.hasActivePositions) {
            const lastPosition = this.getPosition();
            if (lastPosition.direction === this.CONSTS.LONG) {
                lastPosition.sellAtStop(lastPosition.entryPrice - this.parameters.orderStopLoss);
                lastPosition.sellAtLimit(lastPosition.entryPrice + this.parameters.orderTakeProfit);
            } else {
                lastPosition.coverAtStop(lastPosition.entryPrice + this.parameters.orderStopLoss);
                lastPosition.coverAtLimit(lastPosition.entryPrice - this.parameters.orderTakeProfit); //TODO: if lastPosition.entryPrice - this.orderTakeProfit < 0 then market
            }
        } else if (highestADX < this.parameters.adxHigh) {
            const position = this.createPosition();
            position.buyAtStop(highestHighLookback);
            position.shortAtStop(lowestLowLookback);
        }
    }
}
