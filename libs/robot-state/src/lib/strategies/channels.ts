import { BaseStrategy, StrategyState } from "../BaseStrategy";

export class Channels extends BaseStrategy {
    constructor(state: StrategyState) {
        super(state);
    }
    get parameters() {
        return this._strategySettings as {
            adx: number;
            seriesSize: number;
            ratio: number;
            tick: number;
        };
    }
    _parametersSchema = {
        adx: {
            description: "ADX optInTimePeriod",
            type: "number",
            integer: true,
            positive: true,
            min: 5,
            max: 100
        },
        seriesSize: {
            description: "Channel series size",
            type: "number",
            integer: true,
            positive: true,
            min: 10,
            max: 100
        },
        ratio: {
            description: "Ratio",
            type: "number",
            integer: true,
            positive: true,
            min: 5,
            max: 400
        },
        tick: {
            description: "Tick",
            type: "number",
            min: 0,
            max: 10
        }
    };
    init() {
        this.log("Channels Parameters", this.parameters);
        this.addRsIndicator("channelADX", "ChanADX", {
            adxPeriod: this.parameters.adx,
            period: this.parameters.seriesSize,
            ratio: this.parameters.ratio
        });
    }
    check() {
        const { tick } = this.parameters;
        this.log(this.indicators.channelADX.result);
        const { high: channelADXHigh, low: channelADXLow } = this.indicators.channelADX.result;
        if (this.hasActivePositions) {
            const lastPosition = this.getPosition();
            if (lastPosition.direction === this.CONSTS.LONG) {
                lastPosition.sellAtStop(channelADXLow - tick);
                const position = this.createPosition({ parentId: lastPosition.id });
                position.shortAtStop(channelADXLow - tick);
            } else {
                lastPosition.coverAtStop(channelADXHigh + tick);
                const position = this.createPosition({ parentId: lastPosition.id });
                position.buyAtStop(channelADXHigh + tick);
            }
        } else {
            const position = this.createPosition();
            position.buyAtStop(channelADXHigh - tick);
            position.shortAtStop(channelADXLow - tick);
        }
    }
}
