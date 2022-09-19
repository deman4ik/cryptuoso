import { addPercent, round, validate } from "@cryptuoso/helpers";
import { ValidationSchema } from "fastest-validator";
import { DBCandle } from "@cryptuoso/market";
import { NewEvent } from "@cryptuoso/events";
import logger, { LeveledLogMethod } from "@cryptuoso/logger";
import { StrategySettings } from "@cryptuoso/robot-settings";
import { IndicatorState } from "@cryptuoso/robot-types";

export class BaseIndicator {
    [key: string]: any;
    _name: string;
    _indicatorName: string;
    _initialized: boolean;
    _parameters: {
        [key: string]: any;
        candleProp?: "open" | "high" | "low" | "close" | "volume";
    };
    _indicators: {
        [key: string]: any;
    };
    _parametersSchema: ValidationSchema;
    _eventsToSend: NewEvent<any>[];
    //result: number | number[];
    _log: LeveledLogMethod;
    _strategySettings: StrategySettings;
    _utils: {
        round: (x: number, numPrecisionDigits?: number) => number;
        addPercent: (num: number, perc: number) => number;
    };
    result: any;

    constructor(state: IndicatorState) {
        this._log = logger.debug.bind(logger);
        this._name = state.name;
        this._indicatorName = state.indicatorName;
        this._initialized = state.initialized || false;
        this._parameters = state.parameters || {};
        this._indicators = {
            rs: {}
        };
        if (state.variables) {
            Object.entries(state.variables).forEach(([key, value]) => {
                this[key] = value;
            });
        }
        if (state.indicatorFunctions) {
            Object.entries(state.indicatorFunctions).forEach(([key, value]) => {
                this[key] = value;
            });
        }
        this._strategySettings = state.strategySettings || {};
        this._utils = {
            round,
            addPercent
        };
        this._eventsToSend = [];
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async init(candles: DBCandle[]) {
        return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async calc(candle: DBCandle) {
        throw new Error("Not implemented");
    }

    get log() {
        return this._log;
    }

    _logEvent(data: any) {
        this._eventsToSend.push({
            type: "out-robot-worker.log",
            data: { ...data, name: this._name, indicatorName: this._indicatorName }
        });
    }

    get logEvent() {
        return this._logEvent;
    }

    _checkParameters() {
        if (this._parametersSchema && Object.keys(this._parametersSchema).length > 0) {
            validate(this._parameters, this._parametersSchema);
        }
    }

    done() {
        return Promise.resolve();
    }

    get utils() {
        return this._utils;
    }

    get needWarmup() {
        return this._needWarmup;
    }

    candlesProp(candles: DBCandle[], prop: "open" | "high" | "low" | "close" | "volume") {
        if (!["open", "high", "low", "close", "volume"].includes(prop)) throw new Error(`Invalid candle prop ${prop}`);
        return candles.map((candle) => candle[prop]);
    }

    getHighest(candles: DBCandle[], prop: "open" | "high" | "low" | "close" | "volume", size: number) {
        return Math.max(...this.candlesProp(candles, prop).slice(-size));
    }

    getLowest(candles: DBCandle[], prop: "open" | "high" | "low" | "close" | "volume", size: number) {
        return Math.min(...this.candlesProp(candles, prop).slice(-size));
    }

    standardDeviation(arr: number[]): number {
        let sum = 0;
        for (let i = 0; i < arr.length; i += 1) {
            sum += arr[i];
        }
        const mean = sum / arr.length;

        const concat = [];
        for (let i = 0; i < arr.length; i += 1) {
            concat.push((arr[i] - mean) ** 2);
        }

        let concatSum = 0;
        for (let i = 0; i < concat.length; i += 1) {
            concatSum += concat[i];
        }

        return Math.sqrt(concatSum / arr.length);
    }

    get initialized() {
        return this._initialized;
    }

    set initialized(value) {
        this._initialized = value;
    }
    get parameters() {
        return this._parameters;
    }

    get strategySettings() {
        return this._strategySettings;
    }
}
