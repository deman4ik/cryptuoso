import { chunkArrayIncrEnd, validate } from "@cryptuoso/helpers";
import { ValidationSchema } from "fastest-validator";
import { CandleProps, DBCandle } from "@cryptuoso/market";
import { NewEvent } from "@cryptuoso/events";
import { RobotWorkerEvents } from "@cryptuoso/robot-events";
import tulip from "./tulip/create";
import logger from "@cryptuoso/logger";

export interface IndicatorCode {
    [key: string]: any;
    init(): void;
    calc(): void;
}

export const enum IndicatorType {
    base = "base",
    tulip = "tulip"
    /*talib = "talib",
    techind = "techind"*/
}

export interface IndicatorState {
    [key: string]: any;
    name: string;
    indicatorName: string;
    initialized?: boolean;
    parameters?: { [key: string]: number };
    robotSettings?: { [key: string]: any };
    variables?: { [key: string]: any };
    indicatorFunctions?: { [key: string]: () => any };
    parametersSchema?: ValidationSchema;
}

export class BaseIndicator {
    [key: string]: any;
    _name: string;
    _indicatorName: string;
    _initialized: boolean;
    _parameters: {
        [key: string]: number;
    };
    _robotSettings: {
        [key: string]: any;
    };
    _candle: DBCandle;
    _candles: DBCandle[];
    _candlesProps: CandleProps;
    _indicators: {
        [key: string]: any;
    };
    _parametersSchema: ValidationSchema;
    _eventsToSend: NewEvent<any>[];
    result: number | number[];
    _log = logger.info;

    constructor(state: IndicatorState) {
        this._name = state.name;
        this._indicatorName = state.indicatorName;
        this._initialized = state.initialized || false;
        this._parameters = state.parameters || {};
        this._robotSettings = state.robotSettings;
        this._candle = null;
        this._candles = [];
        this._candlesProps = {
            open: [],
            high: [],
            low: [],
            close: [],
            volume: []
        };
        this._indicators = {
            tulip: {}
            /*  tech: {},
            talib: {} */
        };
        if (state.variables) {
            Object.keys(state.variables).forEach((key) => {
                this[key] = state.variables[key];
            });
        }
        if (state.indicatorFunctions) {
            Object.getOwnPropertyNames(state.indicatorFunctions).forEach((key) => {
                this[key] = state.indicatorFunctions[key];
            });
        }
        this._parametersSchema = state.parametersSchema;
        this._eventsToSend = [];
    }

    init() {
        throw new Error("Not implemented");
    }

    calc() {
        throw new Error("Not implemented");
    }

    get log() {
        return this._log;
    }

    _logEvent(data: any) {
        this._eventsToSend.push({
            type: RobotWorkerEvents.LOG,
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

    prepareCandles(candles: DBCandle[]) {
        const candlesProps: CandleProps = {
            open: [],
            high: [],
            low: [],
            close: [],
            volume: []
        };
        candles.forEach((candle) => {
            candlesProps.open.push(candle.open);
            candlesProps.high.push(candle.high);
            candlesProps.low.push(candle.low);
            candlesProps.close.push(candle.close);
            candlesProps.volume.push(candle.volume);
        });
        return candlesProps;
    }

    highest(prop: "open" | "high" | "low" | "close" | "volume", size: number) {
        if (!["open", "high", "low", "close", "volume"].includes(prop)) throw new Error(`Invalid candle prop ${prop}`);
        const arr = this._candlesProps[prop].slice(-size);
        return Math.max(...arr);
    }

    lowest(prop: "open" | "high" | "low" | "close" | "volume", size: number) {
        if (!["open", "high", "low", "close", "volume"].includes(prop)) throw new Error(`Invalid candle prop ${prop}`);
        const arr = this._candlesProps[prop].slice(-size);
        return Math.min(...arr);
    }

    candlesChunks(chunkSize: number, chunkQuantity: number) {
        const candlesArr = chunkArrayIncrEnd(this._candles, chunkSize);
        return candlesArr.splice(-chunkQuantity);
    }

    candlesPropsChunks(chunkSize: number, chunkQuantity: number) {
        const candlesArr = this.candlesChunks(chunkSize, chunkQuantity);
        const candlesPropsArr = candlesArr.map((candles) => this.prepareCandles(candles));
        return candlesPropsArr;
    }

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

        const candlesPropsArr = candlesArr.map((candles) => this.prepareCandles(candles));
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

    async calcTulipSeries(name: string, options: { [key: string]: number }, candlesChunksQuantity: number) {
        const calculate = tulip[name].create(options);
        const candlesPropsChunks = this.candlePropsLatestChunks(candlesChunksQuantity);
        const results = await Promise.all(
            candlesPropsChunks.map(async (candlesProps) => {
                const result = await calculate(candlesProps);
                return result.result ? result.result : result;
            })
        );
        return results;
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

    _handleCandles(candle: DBCandle, candles: DBCandle[], candlesProps: CandleProps) {
        if (
            !candle ||
            !candles ||
            !candlesProps ||
            !Array.isArray(candles) ||
            candles.length === 0 ||
            Object.keys(candlesProps).length === 0
        ) {
            this.log(`Indicator ${this._name} wrong input candles`);
            this.log(candle);
            this.log(candles);
            this.log(candlesProps);
            throw new Error(`Indicator ${this._name} wrong input candles`);
        }
        this._candle = candle;
        this._candles = candles;
        this._candlesProps = candlesProps;
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
}
