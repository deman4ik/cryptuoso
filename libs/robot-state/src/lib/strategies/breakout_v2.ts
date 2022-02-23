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
        this.log("Breakoutv2 Parameters", this.parameters);
        this.adxPeriod = this.parameters.adxPeriod; // ADX period
        this.adxHigh = this.parameters.adxHigh; // ADX upper limit value
        this.lookback = this.parameters.lookback; // ADX below the limit within the lookback
        this.orderStopLoss = this.parameters.orderStopLoss; // stoppunkt
        this.orderTakeProfit = this.parameters.orderTakeProfit; // profitpunkt
        // indicators
        this.addIndicator("highestHighLookback", "highest_high", {
            seriesSize: this.lookback
        });
        this.addIndicator("lowestLowLookback", "lowest_low", {
            seriesSize: this.lookback
        });
        this.addIndicator("highestADX", "highest_adx", {
            seriesSize: this.lookback,
            optInTimePeriod: this.adxPeriod
        });
    }
    check() {
        const highestHighLookback = this.indicators.highestHighLookback.result;
        const lowestLowLookback = this.indicators.lowestLowLookback.result;
        const highestADX = this.indicators.highestADX.result;
        if (this.hasActivePositions) {
            const lastPosition = this.getPosition();
            if (lastPosition.direction === this.CONSTS.LONG) {
                lastPosition.sellAtStop(lastPosition.entryPrice - this.orderStopLoss);
                lastPosition.sellAtLimit(lastPosition.entryPrice + this.orderTakeProfit);
            } else {
                lastPosition.coverAtStop(lastPosition.entryPrice + this.orderStopLoss);
                lastPosition.coverAtLimit(lastPosition.entryPrice - this.orderTakeProfit); //TODO: if lastPosition.entryPrice - this.orderTakeProfit < 0 then market
            }
        } else if (highestADX < this.adxHigh) {
            const position = this.createPosition();
            position.buyAtStop(highestHighLookback);
            position.shortAtStop(lowestLowLookback);
        }
    }
}
