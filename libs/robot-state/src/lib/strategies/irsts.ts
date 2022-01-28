import { BaseStrategy, StrategyState } from "../BaseStrategy";

export class IRSTS extends BaseStrategy {
    constructor(state: StrategyState) {
        super(state);
    }
    get parameters() {
        return this._strategySettings as {
            reversal: number;
            profitTarget: number;
            stopLoss: number;
        };
    }
    parametersSchema = {
        reversal: {
            description: "Reversal %",
            type: "number",
            integer: true,
            positive: true,
            min: 1,
            max: 100
        },
        profitTarget: {
            description: "Profit Targe %",
            type: "number",
            integer: true,
            positive: true,
            min: 1,
            max: 100
        },
        stopLoss: {
            description: "Stop loss %",
            type: "number",
            integer: true,
            positive: true,
            min: 1,
            max: 100
        }
    };
    init() {
        this.log("IRSTS Parameters", this.parameters);
        this.addIndicator("peak", "peak", {
            reversalAmount: this.parameters.reversal
        });
        this.addIndicator("trough", "trough", {
            reversalAmount: this.parameters.reversal
        });
        this.detected = false;
        this.prevZZ = {
            candle: null,
            magnitude: 0,
            isMoveUp: null,
            zigBar: null,
            zagBar: null,
            inPrice: 0,
            outPrice: 0,
            wave: null,
            leg3Count: 0
        };
        this.currentZZ = {
            candle: null,
            magnitude: 0,
            isMoveUp: null,
            zigBar: null,
            zagBar: null,
            inPrice: 0,
            outPrice: 0,
            wave: null,
            leg3Count: 0
        };
        this.c = 1;
    }
    buildZZ() {
        this.detected = false;

        if (!this.indicators.peak.peak.candle || !this.indicators.trough.trough.candle) return;

        if (
            this.indicators.trough.trough.result > this.indicators.trough.prevTrough.result &&
            this.indicators.trough.trough.candle
        ) {
            this.detected = true;
        }

        if (
            this.indicators.peak.peak.result > this.indicators.peak.prevPeak.result &&
            this.indicators.peak.peak.candle
        ) {
            this.detected = true;
        }

        if (this.detected) {
            this.prevZZ = { ...this.currentZZ };
            this.currentZZ.isMoveUp = this.indicators.trough.trough.candle.time < this.indicators.peak.peak.candle.time;
            this.currentZZ.magnitude = Math.abs(
                this.indicators.peak.peak.candle.high - this.indicators.trough.trough.candle.low
            );

            if (this.currentZZ.isMoveUp) {
                this.currentZZ.zigBar = this.indicators.trough.trough.candle;
                this.currentZZ.zagBar = this.indicators.peak.peak.candle;
                this.currentZZ.inPrice = this.indicators.trough.trough.result;
                this.currentZZ.outPrice = this.indicators.peak.peak.result;
            } else {
                this.currentZZ.zigBar = this.indicators.peak.peak.candle;
                this.currentZZ.zagBar = this.indicators.trough.trough.candle;
                this.currentZZ.inPrice = this.indicators.peak.peak.result;
                this.currentZZ.outPrice = this.indicators.trough.trough.result;
            }
            this.currentZZ.candle = this.candle;
        }
    }
    buildWaves() {
        if (this.detected && this.prevZZ.candle) {
            if (!this.prevZZ.wave) this.prevZZ.wave = 1;
            switch (this.prevZZ.wave) {
                case 1: {
                    if (this.prevZZ.isMoveUp) {
                        // W2 breaks down through W1's base = new W1 down
                        this.currentZZ.wave = this.currentZZ.outPrice < this.currentZZ.inPrice ? 1 : 2;
                    } else {
                        // W2 breaks out through W1's base = new W1 up
                        this.currentZZ.wave = this.currentZZ.outPrice > this.currentZZ.inPrice ? 1 : 2;
                    }
                    break;
                }
                case 2: {
                    if (this.currentZZ.isMoveUp) {
                        // prev Up, W1 = Down
                        if (this.currentZZ.outPrice >= this.prevZZ.outPrice) this.currentZZ.wave = 3;
                    } else {
                        // prev Down, W1 = Up
                        if (this.currentZZ.outPrice < this.prevZZ.outPrice) this.currentZZ.wave = 3;
                    }
                    break;
                }
                case 3: {
                    if (this.currentZZ.isMoveUp) {
                        // prev Up, W1 = Down
                        if (this.currentZZ.outPrice > this.prevZZ.outPrice) this.currentZZ.wave = 2;

                        if (this.currentZZ.outPrice > this.prevZZ.inPrice) this.currentZZ.wave = 1;
                    } else {
                        // prev Down, W1 = Up
                        if (this.currentZZ.outPrice < this.prevZZ.outPrice) this.currentZZ.wave = 2;

                        if (this.currentZZ.outPrice < this.prevZZ.inPrice) this.currentZZ.wave = 1;
                    }
                    break;
                }
                default: {
                    if (this.prevZZ.magnitude > this.currentZZ.magnitude) this.currentZZ.wave = 1;
                    break;
                }
            }

            if (this.currentZZ.wave === 3) {
                this.currentZZ.leg3Count = this.c;
                this.c += 1;
            } else if (this.currentZZ.wave === 1) {
                this.c = 1;
            }
        }
    }
    check() {
        this.buildZZ();
        this.buildWaves();

        if (this.hasActivePositions) {
            const lastPosition = this.getPosition();
            let profitTgt = 0,
                stopPrice = 0;
            if (lastPosition.direction === this.CONSTS.LONG) {
                profitTgt = lastPosition.entryPrice * (1 + this.parameters.profitTarget / 100);
                stopPrice = lastPosition.entryPrice * (1 - this.parameters.stopLoss / 100);
            } else {
                profitTgt = lastPosition.entryPrice * (1 - this.parameters.profitTarget / 100);
                stopPrice = lastPosition.entryPrice * (1 + this.parameters.stopLoss / 100);
            }
            lastPosition.sellAtStop(stopPrice);
            lastPosition.sellAtLimit(profitTgt);
        } else if (this.detected && this.currentZZ.wave === 2) {
            const position = this.createPosition();
            if (this.currentZZ.isMoveUp) {
                position.buyAtMarket();
            } else {
                position.shortAtMarket();
            }
        }
    }
}
