import { addPercent, chunkArrayIncrEnd, round, validate } from "@cryptuoso/helpers";
import { ValidationSchema } from "fastest-validator";
import { CandleProps, DBCandle } from "@cryptuoso/market";
import { NewEvent } from "@cryptuoso/events";
import tulip from "./tulip/create";
import logger from "@cryptuoso/logger";
import { StrategySettings } from "@cryptuoso/robot-settings";
import { IndicatorState } from "@cryptuoso/robot-types";

export class BaseIndicator {
    [key: string]: any;
    _name: string;
    _indicatorName: string;
    _initialized: boolean;
    _parameters: {
        [key: string]: any;
    };
    _candle: DBCandle;
    _candles: DBCandle[];

    _indicators: {
        [key: string]: any;
    };
    _parametersSchema: ValidationSchema;
    _eventsToSend: NewEvent<any>[] = [];
    //result: number | number[];
    _log = logger.debug.bind(logger);
    _strategySettings: StrategySettings;
    _utils: {
        round: (x: number, numPrecisionDigits?: number) => number;
        addPercent: (num: number, perc: number) => number;
    };

    constructor(state: IndicatorState) {
        this._name = state.name;
        this._indicatorName = state.indicatorName;
        this._initialized = state.initialized || false;
        this._parameters = state.parameters || {};
        this._candle = null;
        this._candles = [];

        this._indicators = {
            tulip: {}
            /*  tech: {},
            talib: {} */
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
    }

    init() {
        return;
    }

    calc() {
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

    prepareCandles(candles: DBCandle[]) {
        const candlesProps: CandleProps = {
            open: [],
            high: [],
            low: [],
            close: [],
            volume: []
        };
        for (let i = 0; i < candles.length; i += 1) {
            candlesProps.open.push(candles[i].open);
            candlesProps.high.push(candles[i].high);
            candlesProps.low.push(candles[i].low);
            candlesProps.close.push(candles[i].close);
            candlesProps.volume.push(candles[i].volume);
        }
        return candlesProps;
    }

    getHighest(prop: "open" | "high" | "low" | "close" | "volume", size: number) {
        if (!["open", "high", "low", "close", "volume"].includes(prop)) throw new Error(`Invalid candle prop ${prop}`);
        const arr = this._candlesProps[prop].slice(-size);
        return Math.max(...arr);
    }

    getLowest(prop: "open" | "high" | "low" | "close" | "volume", size: number) {
        if (!["open", "high", "low", "close", "volume"].includes(prop)) throw new Error(`Invalid candle prop ${prop}`);
        const arr = this._candlesProps[prop].slice(-size);
        return Math.min(...arr);
    }

    candlesChunks(chunkSize: number, chunkQuantity: number) {
        const candlesArr = chunkArrayIncrEnd(this._candles, chunkSize);
        return candlesArr.splice(-chunkQuantity);
    } //TODO: deprecate ?

    candlesPropsChunks(chunkSize: number, chunkQuantity: number) {
        const candlesArr = this.candlesChunks(chunkSize, chunkQuantity);
        const candlesPropsArr = [];

        for (let i = 0; i < candlesArr.length; i += 1) {
            candlesPropsArr.push(this.prepareCandles(candlesArr[i]));
        }

        return candlesPropsArr;
    } //TODO: deprecate ?

    candlePropsLatestChunks(chunkQuantity: number) {
        let candlesArr = [];
        for (let i = 0; i < chunkQuantity; i += 1) {
            if (i === 0) candlesArr.push(this._candles);
            else {
                const arr = this._candles.slice(0, -i);
                candlesArr.push(arr);
            }
        }

        candlesArr = candlesArr.reverse();

        const candlesPropsArr = [];

        for (let i = 0; i < candlesArr.length; i += 1) {
            candlesPropsArr.push(this.prepareCandles(candlesArr[i]));
        }
        return candlesPropsArr;
    }

    addTulip(name: string, options: { [key: string]: number }) {
        this._indicators.tulip[name] = tulip[name].create(options);
    }

    get tulip() {
        return this._indicators.tulip;
    }

    async calcTulip(name: string, options: { [key: string]: number }, candlesProps: CandleProps) {
        const calculate = tulip[name].create(options);
        const result = await calculate(candlesProps);
        return result.result ? result.result : result;
    }

    async calcTulipSeries(
        name: string,
        indicatorName: string,
        options: { [key: string]: number },
        candlesChunksQuantity: number
    ) {
        const calculate = tulip[indicatorName].create(options);
        if (
            this[`tulip_${name}_series`] &&
            Array.isArray(this[`tulip_${name}_series`]?.results) &&
            this[`tulip_${name}_series`]?.results?.length &&
            this[`tulip_${name}_series`]?.lastCandleTime === this.candles[this.candles.length - 2].time
        ) {
            const candlesPropsChunks = this.candlePropsLatestChunks(1);
            const calcResult = await calculate(candlesPropsChunks[0]);
            const result = calcResult.result ? calcResult.result : calcResult;

            this[`tulip_${name}_series`].lastCandleTime = this.candle.time;
            this[`tulip_${name}_series`].results = [...this[`tulip_${name}_series`].results.splice(1), result];
        } else {
            const candlesPropsChunks = this.candlePropsLatestChunks(candlesChunksQuantity);
            const results = await Promise.all(
                candlesPropsChunks.map(async (candlesProps) => {
                    const result = await calculate(candlesProps);
                    return result.result ? result.result : result;
                })
            );
            this[`tulip_${name}_series`] = {
                lastCandleTime: this.candle.time,
                results
            };
        }
        return this[`tulip_${name}_series`].results;
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

    /*
    addTalib(name, options) {
      this._indicators.talib[name] = createTalib[name].create(options);
    }
  
    get talib() {
      return this._indicators.talib;
    }
  
    async calcTalib(name, options, candlesProps) {
      const calculate = createTalib[name].create(options);
      const result = await calculate(candlesProps);
      return result.result ? result.result : result;
    }
  
    async calcTalibSeries(
      name,
      options,
      candlesChunkSize,
      candlesChunksQuantity
    ) {
      const calculate = createTalib[name].create(options);
      const candlesPropsChunks = this.candlesPropsChunks(
        candlesChunkSize,
        candlesChunksQuantity
      );
      const results = await Promise.all(
        candlesPropsChunks.map(async candlesProps => {
          const result = await calculate(candlesProps);
          return result.result ? result.result : result;
        })
      );
      return results;
    }
  
    addTech(name, options) {
      this._indicators.tech[name] = createTech[name].create(options);
    }
  
    get tech() {
      return this._indicators.tech;
    }
  
    async calcTech(name, options, candlesProps) {
      const calculate = createTech[name].create(options);
      const result = await calculate(candlesProps);
      return result.result ? result.result : result;
    }
  
    async calcTechSeries(name, options, candlesChunkSize, candlesChunksQuantity) {
      const calculate = createTech[name].create(options);
      const candlesPropsChunks = this.candlesPropsChunks(
        candlesChunkSize,
        candlesChunksQuantity
      );
      const results = await Promise.all(
        candlesPropsChunks.map(async candlesProps => {
          const result = await calculate(candlesProps);
          return result.result ? result.result : result;
        })
      );
      return results;
    }
    */

    _handleCandles(candle: DBCandle, candles: DBCandle[]) {
        if (!candle || !candles || !Array.isArray(candles) || candles.length === 0) {
            this.log(`Indicator ${this._name} wrong input candles`);
            this.log(candle);
            this.log(candles);

            throw new Error(`Indicator ${this._name} wrong input candles`);
        }
        this._candle = candle;
        this._candles = candles;
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

    get candle() {
        return this._candle;
    }

    get candles() {
        return this._candles;
    }

    get candlesProps() {
        return this._candlesProps;
    }

    get strategySettings() {
        return this._strategySettings;
    }
}
