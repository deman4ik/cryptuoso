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
    parametersSchema = {
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
        this.addIndicator("highestHigh", "highest_high", {
            seriesSize: this.parameters.periodHigh
        });
        this.addIndicator("lowestLow", "lowest_low", {
            seriesSize: this.parameters.periodLow
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
                this.stats?.fullStats?.lastPosition &&
                this.stats?.fullStats?.lastPosition.direction === this.CONSTS.LONG &&
                this.stats?.fullStats?.lastPosition.profit < 0
            ) {
                position.shortAtMarket();
            } else {
                position.buyAtStop(highestHigh);
            }
        }
    }
}
