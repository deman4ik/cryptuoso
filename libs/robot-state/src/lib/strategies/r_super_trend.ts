import { BaseStrategy, StrategyState } from "../BaseStrategy";

export class RSuperTrend extends BaseStrategy {
    constructor(state: StrategyState) {
        super(state);
    }
    get parameters() {
        return this._strategySettings as {
            period: number;
            factor: number;
        };
    }
    _parametersSchema = {
        period: {
            description: "ATR period",
            type: "number",
            integer: true,
            positive: true,
            min: 1,
            max: 100
        },
        factor: {
            description: "Factor",
            type: "number",
            integer: true,
            positive: true,
            min: 1,
            max: 100
        }
    };

    init() {
        this.log("RSuperTrend Parameters", this.parameters);
        this.addRsIndicator("RST", "RachSupTrend", {
            period: this.parameters.period,
            factor: this.parameters.factor
        });
    }
    check() {
        if (this.hasActivePositions) {
            const lastPosition = this.getPosition();
            if (lastPosition.direction === this.CONSTS.LONG && this.indicators.RST.result.sell === 1) {
                lastPosition.sellAtMarket();
                const position = this.createPosition({ parentId: lastPosition.id });
                position.shortAtMarket();
            } else if (lastPosition.direction === this.CONSTS.SHORT && this.indicators.RST.result.buy === 1) {
                lastPosition.coverAtMarket();
                const position = this.createPosition({ parentId: lastPosition.id });
                position.buyAtMarket();
            }
        } else {
            if (this.indicators.RST.result.buy === 1) {
                const position = this.createPosition();
                position.buyAtMarket();
            } else if (this.indicators.RST.result.sell === 1) {
                const position = this.createPosition();
                position.shortAtMarket();
            }
        }
    }
}
