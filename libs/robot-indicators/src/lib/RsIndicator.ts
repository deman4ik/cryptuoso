import { IndicatorState } from "@cryptuoso/robot-types";
import { BaseIndicator } from "./BaseIndicator";
import {
    TaSMA,
    RSI,
    ADX,
    ATR,
    TaMACD,
    ChanADX,
    FXHighBand,
    FXLowBand,
    MaxADX,
    TaMACDOutput,
    TaMaximum,
    TaMinimum,
    ChanADXOutput,
    RachSupTrend,
    RachSupTrendOutput
} from "ta-rs";
import { DBCandle } from "@cryptuoso/market";

export type RsNames =
    | "TaSMA"
    | "RSI"
    | "ADX"
    | "ATR"
    | "TaMACD"
    | "ChanADX"
    | "FXHighBand"
    | "FXLowBand"
    | "MaxADX"
    | "TaMaximum"
    | "TaMinimum"
    | "RachSupTrend";

export class RsIndicator extends BaseIndicator {
    indicator:
        | TaSMA
        | RSI
        | ADX
        | ATR
        | TaMACD
        | ChanADX
        | FXHighBand
        | FXLowBand
        | MaxADX
        | TaMaximum
        | TaMinimum
        | RachSupTrend;
    declare result: number | TaMACDOutput | ChanADXOutput | RachSupTrendOutput;
    declare _indicatorName: RsNames;

    constructor(state: IndicatorState) {
        super(state);
        this._parametersSchema = {
            period: {
                description: "Candles window length",
                type: "number",
                integer: "true",
                positive: "true",
                min: 1,
                max: this._strategySettings?.requiredHistoryMaxBars || 1,
                optional: true
            },
            candleProp: {
                description: "Candle prop",
                type: "string",
                enum: ["open", "high", "low", "close", "volume"],
                optional: true
            }
        };

        this.createRsIndicator();
    }

    createRsIndicator() {
        switch (this._indicatorName) {
            case "TaMaximum": {
                this.indicator = new TaMaximum(this.parameters.period);
                break;
            }
            case "TaMinimum": {
                this.indicator = new TaMinimum(this.parameters.period);
                break;
            }
            case "TaSMA": {
                this.indicator = new TaSMA(this.parameters.period);
                break;
            }
            case "RSI": {
                this.indicator = new RSI(this.parameters.period);
                break;
            }
            case "ADX": {
                this.indicator = new ADX(this.parameters.period);
                break;
            }
            case "ATR": {
                this.indicator = new ATR(this.parameters.period);
                break;
            }
            case "TaMACD": {
                this.indicator = new TaMACD(
                    this.parameters.fastPeriod,
                    this.parameters.slowPeriod,
                    this.parameters.signalPeriod
                );
                break;
            }
            case "ChanADX": {
                this.indicator = new ChanADX(this.parameters.period, this.parameters.adxPeriod, this.parameters.ratio);
                break;
            }
            case "FXHighBand": {
                this.indicator = new FXHighBand(
                    this.parameters.period,
                    this.parameters.rsiPeriod,
                    this.parameters.modifier
                );
                break;
            }
            case "FXLowBand": {
                this.indicator = new FXLowBand(
                    this.parameters.period,
                    this.parameters.rsiPeriod,
                    this.parameters.modifier
                );
                break;
            }
            case "MaxADX": {
                this.indicator = new MaxADX(this.parameters.period, this.parameters.adxPeriod);
                break;
            }
            case "RachSupTrend": {
                this.indicator = new RachSupTrend(this.parameters.period, this.parameters.factor);
                break;
            }
            default:
                throw new Error(`Indicator ${this._indicatorName} is not supported`);
        }
    }

    async init(candles: DBCandle[]) {
        for (const candle of candles) {
            await this.calc(candle);
        }
    }

    async calc(candle: DBCandle) {
        if (
            ["ATR", "ChanADX", "FXHighBand", "FXLowBand", "ADX", "MaxADX", "RachSupTrend"].includes(this._indicatorName)
        ) {
            this.result = await (this.indicator as ATR | ChanADX | FXHighBand | FXLowBand | ADX | MaxADX).next(candle);
        } else {
            this.result = await (this.indicator as TaSMA | RSI | TaMACD | TaMaximum | TaMinimum).next(
                candle[this.parameters.candleProp || "close"]
            );
        }
    }
}
