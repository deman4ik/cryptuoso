import { ValidationSchema } from "fastest-validator";
import dayjs from "@cryptuoso/dayjs";
import { v4 as uuid } from "uuid";
import { validate, sortAsc } from "@cryptuoso/helpers";
import { RobotPosition } from "./RobotPosition";
import {
    CandleProps,
    OrderType,
    TradeAction,
    ValidTimeframe,
    SignalInfo,
    RobotPositionStatus,
    Candle
} from "@cryptuoso/market";
import { IndicatorState, IndicatorType } from "@cryptuoso/robot-indicators";
import { NewEvent } from "@cryptuoso/events";
import { RobotWorkerEvents, Signal, SignalEvents } from "@cryptuoso/robot-events";
import logger from "@cryptuoso/logger";
import { RobotPositionState, StrategyProps } from "./types";
import { StrategySettings } from "@cryptuoso/robot-settings";

export interface StrategyState extends StrategyProps {
    strategySettings: StrategySettings;
    exchange: string;
    asset: string;
    currency: string;
    timeframe: number;
    robotId: string;
    parametersSchema: ValidationSchema;
    strategyFunctions: { [key: string]: () => any };
    backtest?: boolean;
}

export class BaseStrategy {
    [key: string]: any;
    _initialized: boolean;
    _strategySettings: StrategySettings;
    _exchange: string;
    _asset: string;
    _currency: string;
    _timeframe: ValidTimeframe;
    _robotId: string;
    _posLastNumb: { [key: string]: number };
    _positions: { [key: string]: RobotPosition };
    _parametersSchema: ValidationSchema;
    _backtest?: boolean;
    _candle: Candle;
    _candles: Candle[];
    _candlesProps: CandleProps;
    _indicators: {
        [key: string]: IndicatorState;
    };
    _consts: { [key: string]: string };
    _eventsToSend: NewEvent<any>[];
    _positionsToSave: RobotPositionState[];
    _log = logger.debug.bind(logger);
    _dayjs = dayjs;

    constructor(state: StrategyState) {
        this._initialized = state.initialized || false; // стратегия инициализирована
        this._strategySettings = state.strategySettings || {};
        this._exchange = state.exchange;
        this._asset = state.asset;
        this._currency = state.currency;
        this._timeframe = state.timeframe;
        this._robotId = state.robotId;
        this._posLastNumb = state.posLastNumb || {};
        this._positions = {};
        this._setPositions(state.positions);
        this._parametersSchema = state.parametersSchema;
        this._backtest = state.backtest;
        this._candle = null;
        this._candles = []; // [{}]
        this._candlesProps = {
            open: [],
            high: [],
            low: [],
            close: [],
            volume: []
        };
        this._indicators = state.indicators || {};
        this._consts = {
            LONG: TradeAction.long,
            CLOSE_LONG: TradeAction.closeLong,
            SHORT: TradeAction.short,
            CLOSE_SHORT: TradeAction.closeShort,
            LIMIT: OrderType.limit,
            MARKET: OrderType.market,
            STOP: OrderType.stop
        };
        this._eventsToSend = [];
        this._positionsToSave = [];
        if (state.variables) {
            Object.keys(state.variables).forEach((key) => {
                this[key] = state.variables[key];
            });
        }
        if (state.strategyFunctions) {
            Object.entries(state.strategyFunctions).forEach(([key, value]) => {
                this[key] = value;
            });
        }
    }

    init() {
        throw new Error("Not implemented");
    }

    check() {
        throw new Error("Not implemented");
    }

    _checkParameters() {
        if (this._parametersSchema && Object.keys(this._parametersSchema).length > 0) {
            validate(this._strategySettings, this._parametersSchema);
        }
    }

    get log() {
        return this._log;
    }

    _logEvent(data: any) {
        this._eventsToSend.push({
            type: RobotWorkerEvents.LOG,
            data: {
                ...data,
                candle: this._candle,
                robotId: this._robotId
            }
        });
    }

    get logEvent() {
        return this._logEvent;
    }

    get hasAlerts() {
        let hasAlerts = false;
        Object.values(this._positions).forEach((position) => {
            if (position.hasAlerts) {
                hasAlerts = true;
            }
        });
        return hasAlerts;
    }

    get dayjs() {
        return dayjs;
    }

    _createAlertEvents() {
        Object.values(this._positions).forEach((position) => {
            if (position.hasAlertsToPublish) {
                position.alertsToPublish.forEach((signal) => this._createSignalEvent(signal, SignalEvents.ALERT));
                position._clearAlertsToPublish();
                this._positionsToSave.push(position.state);
            }
        });
    }

    _createTradeEvents() {
        Object.values(this._positions).forEach((position) => {
            if (position.hasTradeToPublish) {
                this._createSignalEvent(position.tradeToPublish, SignalEvents.TRADE);
                position._clearTradeToPublish();
                this._positionsToSave.push(position.state);
            }
        });
    }

    _createSignalEvent(signal: SignalInfo, type: SignalEvents.ALERT | SignalEvents.TRADE) {
        const signalData: Signal = {
            ...signal,
            id: uuid(),
            robotId: this._robotId,
            exchange: this._exchange,
            asset: this._asset,
            currency: this._currency,
            timeframe: this._timeframe,
            timestamp: this._backtest ? signal.candleTimestamp : dayjs.utc().toISOString()
        };

        this._eventsToSend.push({
            type: type,
            data: signalData
        });
    }
    /** POSITIONS */

    _positionsHandleCandle(candle: Candle) {
        if (Object.keys(this._positions).length > 0) {
            Object.keys(this._positions).forEach((key) => {
                this._positions[key]._handleCandle(candle);
            });
        }
    }

    _getNextPositionCode(prefix = "p") {
        if (Object.prototype.hasOwnProperty.call(this._posLastNumb, prefix)) {
            this._posLastNumb[prefix] += 1;
        } else {
            this._posLastNumb[prefix] = 1;
        }
        return `${prefix}_${this._posLastNumb[prefix]}`;
    }

    _createPosition(props: { prefix?: string; parentId?: string } = {}) {
        const { prefix = "p", parentId } = props;

        const position = this._getPosition(prefix, parentId);
        if (position) return position;

        const code = this._getNextPositionCode(prefix);
        this._positions[code] = new RobotPosition({
            id: uuid(),
            robotId: this._robotId,
            timeframe: this._timeframe,
            prefix,
            code,
            parentId: parentId,
            backtest: this._backtest
        });
        this._positions[code]._log = logger.debug.bind(logger);
        this._positions[code]._handleCandle(this._candle);
        return this._positions[code];
    }

    get createPosition() {
        return this._createPosition;
    }

    get hasActivePositions() {
        return Object.values(this._positions).filter((position) => position.isActive).length > 0;
    }

    _hasActivePosition(prefix = "p") {
        return !!this._getPosition(prefix);
    }

    get hasActivePosition() {
        return this._hasActivePosition;
    }

    _getPosition(prefix = "p", parentId?: string) {
        const positions = Object.values(this._positions)
            .filter((pos) => pos.prefix === prefix && ((!parentId && pos.isActive) || pos.parentId === parentId))
            .sort((a, b) => sortAsc(a.code, b.code));
        if (positions.length > 0) {
            return positions[0];
        }
        return null;
    }

    get getPosition() {
        return this._getPosition;
    }

    get positions() {
        return Object.values(this._positions).map((pos) => pos.state);
    }

    _setPositions(positions: any) {
        if (positions && Array.isArray(positions) && positions.length > 0) {
            positions.forEach((position) => {
                this._positions[position.code] = new RobotPosition(position);
                this._positions[position.code]._log = logger.debug.bind(logger);
            });
        }
    }

    get validPositions() {
        return Object.values(this._positions)
            .filter((position) => position.status !== RobotPositionStatus.closed)
            .map((pos) => pos.state);
    }

    _checkAlerts() {
        Object.keys(this._positions)
            .sort((a, b) => sortAsc(this._positions[a].code.split("_")[1], this._positions[b].code.split("_")[1]))
            .forEach((key) => {
                if (this._positions[key].hasAlerts) {
                    this._positions[key]._checkAlerts();
                    if (this._positions[key].hasTradeToPublish) {
                        this._createSignalEvent(this._positions[key].tradeToPublish, SignalEvents.TRADE);
                        this._positionsToSave.push(this._positions[key].state);
                        this._positions[key]._clearTradeToPublish();
                        if (this._positions[key].status === RobotPositionStatus.closed) {
                            delete this._positions[key];
                        }
                    }
                }
            });
    }

    _clearAlerts() {
        Object.keys(this._positions).forEach((key) => {
            if (this._positions[key].hasAlerts) {
                this._positions[key]._clearAlerts();
            }
        });
    }

    /** INDICATORS */
    _handleIndicators(indicators: { [key: string]: IndicatorState }) {
        this._indicators = indicators;
        Object.keys(this._indicators).forEach((key) => {
            if (this._indicators[key].variables)
                Object.keys(this._indicators[key].variables).forEach((variable) => {
                    this._indicators[key][variable] = this._indicators[key].variables[variable];
                });
        });
    }

    _handleCandles(candle: Candle, candles: Candle[], candlesProps: CandleProps) {
        this._candle = candle;
        this._candles = candles;
        this._candlesProps = candlesProps;
        this._positionsHandleCandle(candle);
    }

    _addIndicator(name: string, indicatorName: string, parameters: { [key: string]: any }) {
        this._indicators[name] = {
            name,
            indicatorName,
            fileName: indicatorName,
            type: IndicatorType.base,
            parameters: parameters,
            variables: {}
        };
    }

    get addIndicator() {
        return this._addIndicator;
    }

    _addTulipIndicator(name: string, indicatorName: string, parameters: { [key: string]: any }) {
        this._addIndicator(name, indicatorName, parameters);
        this._indicators[name].type = IndicatorType.tulip;
    }

    get addTulipIndicator() {
        return this._addTulipIndicator;
    }

    /*
    _addTalibIndicator(name, indicatorName, parameters) {
      this._addIndicator(name, indicatorName, parameters);
      this._indicators[name].type = INDICATORS_TALIB;
    }
  
    _addTechIndicator(name, indicatorName, parameters) {
      this._addIndicator(name, indicatorName, parameters);
      this._indicators[name].type = INDICATORS_TECH;
    }
  
  */

    /** GETTERS  */
    get initialized() {
        return this._initialized;
    }

    set initialized(value) {
        this._initialized = value;
    }

    get parameters() {
        return this._strategySettings;
    }

    get exchange() {
        return this._exchange;
    }

    get asset() {
        return this._asset;
    }

    get currency() {
        return this._сurrency;
    }

    get timeframe() {
        return this._timeframe;
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

    get indicators() {
        return this._indicators;
    }

    get CONSTS() {
        return this._consts;
    }

    get posLastNumb() {
        return this._posLastNumb;
    }
}
