import { BaseStrategy, StrategyState } from "../BaseStrategy";

export class DoubleReverseMM extends BaseStrategy {
    constructor(state: StrategyState) {
        super(state);
    }
    get parameters() {
        return this._strategySettings as {
            periodHigh: number;
            periodLow: number;
        };
    }
    _parametersSchema = {
        periodHigh: {
            description: "PeriodHigh",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 1000
        },
        periodLow: {
            description: "PeriodLowh",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 1000
        }
    };
    init() {
        this.log("DoubleReverseMM Parameters", this.parameters);

        this.addRsIndicator("highestHigh", "TaMaximum", {
            period: this.parameters.periodHigh,
            candleProp: "high"
        });
        this.addRsIndicator("lowestLow", "TaMinimum", {
            period: this.parameters.periodLow,
            candleProp: "low"
        });
    }
    check() {
        const highestHigh = this.indicators.highestHigh.result;
        const lowestLow = this.indicators.lowestLow.result;

        if (this.hasActivePositions) {
            const lastPosition = this.getPosition();

            if (lastPosition.direction === this.CONSTS.LONG) {
                lastPosition.sellAtStop(lowestLow);
            } else {
                lastPosition.coverAtStop(highestHigh);
            }
        } else {
            const position = this.createPosition();

            if (
                this.lastClosedPosition &&
                this.lastClosedPosition?.direction === this.CONSTS.LONG &&
                this.lastClosedPosition?.profit < 0
            ) {
                position.shortAtMarket();
            } else {
                position.buyAtStop(highestHigh);
            }
        }
    }
}
