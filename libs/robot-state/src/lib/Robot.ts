import dayjs from "@cryptuoso/dayjs";
import { BaseIndicator, TulipIndicator, IndicatorCode, IndicatorType } from "@cryptuoso/robot-indicators";
import { ValidTimeframe, CandleProps, DBCandle, RobotPositionStatus } from "@cryptuoso/market";
import { RobotWorkerEvents, SignalEvents } from "@cryptuoso/robot-events";
import { NewEvent } from "@cryptuoso/events";
import { CANDLES_RECENT_AMOUNT, defaultValue, sortAsc } from "@cryptuoso/helpers";
import { BaseStrategy } from "./BaseStrategy";
import { RobotPositionState, RobotState, RobotStatus, StrategyProps } from "./types";
import logger from "@cryptuoso/logger";
import { RobotSettings, StrategySettings } from "@cryptuoso/robot-settings";

export interface StrategyCode {
    [key: string]: any;
    init(): void;
    check(): void;
}

export class Robot {
    [key: string]: any;
    _id: string;
    _code: string;
    _name: string;
    _mod: string;
    _available: number;
    _exchange: string;
    _asset: string;
    _currency: string;
    _timeframe: ValidTimeframe;
    _strategyName: string;
    _settings: {
        strategySettings: StrategySettings;
        robotSettings: RobotSettings;
        activeFrom: string;
    };
    _lastCandle: DBCandle;
    _state: StrategyProps;
    _strategyInstance: BaseStrategy;
    _indicatorInstances: { [key: string]: BaseIndicator };
    _hasAlerts: boolean;
    _baseIndicatorsCode: { [key: string]: IndicatorCode };
    _candle: DBCandle;
    _candles: DBCandle[];
    _candlesProps: CandleProps;
    _status: RobotStatus;
    _startedAt: string;
    _stoppedAt: string;
    _eventsToSend: NewEvent<any>[];
    _postionsToSave: RobotPositionState[];
    _backtest: boolean;
    _error: any;

    constructor(state: RobotState) {
        /* Идентификатор робота */
        this._id = state.id;

        this._code = state.code;

        this._name = state.name;
        this._mod = state.mod;
        this._available = state.available;
        /* Код биржи */
        this._exchange = state.exchange;
        /* Базовая валюта */
        this._asset = state.asset;
        /* Котировка валюты */
        this._currency = state.currency;
        /* Таймфрейм */
        this._timeframe = state.timeframe;
        /* Имя файла стратегии */
        this._strategyName = state.strategyName;

        /* Настройки */
        this._settings = {
            strategySettings: {
                ...state.settings.strategySettings,
                requiredHistoryMaxBars: defaultValue(
                    state.settings.strategySettings.requiredHistoryMaxBars,
                    CANDLES_RECENT_AMOUNT
                )
            },
            robotSettings: state.settings.robotSettings,
            activeFrom: defaultValue(state.settings.activeFrom, state.startedAt)
        };

        /* Последняя свеча */
        this._lastCandle = state.lastCandle;
        /* Состояне стратегии */
        this._state = state.state || {
            variables: {},
            positions: [],
            posLastNumb: {},
            indicators: {},
            initialized: false
        };
        /* Действия для проверки */
        this._hasAlerts = state.hasAlerts || false;

        this._baseIndicatorsCode = {};
        /* Текущая свеча */
        this._candle = null;
        /* Текущие свечи */
        this._candles = [];

        /* Текущий статус сервиса */
        this._status = state.status || RobotStatus.pending;
        /* Дата и время запуска */
        this._startedAt = state.startedAt;
        this._stoppedAt = state.stoppedAt;
        this._backtest = state.backtest;
        this._eventsToSend = [];
        this._postionsToSave = [];
        this._indicatorInstances = {};
    }

    get eventsToSend() {
        return this._eventsToSend;
    }

    get positionsToSave() {
        return this._postionsToSave;
    }

    get hasClosedPositions() {
        return this._postionsToSave.filter(({ status }) => status === RobotPositionStatus.closed).length > 0;
    }

    get closedPositions() {
        return this._postionsToSave.filter(({ status }) => status === RobotPositionStatus.closed);
    }

    get alertEventsToSend() {
        return this._eventsToSend.filter(({ type }) => type === SignalEvents.ALERT);
    }

    get tradeEventsToSend() {
        return this._eventsToSend.filter(({ type }) => type === SignalEvents.TRADE);
    }

    get logEventsToSend() {
        return this._eventsToSend.filter(({ type }) => type === RobotWorkerEvents.LOG);
    }

    get strategyName() {
        return this._strategyName;
    }

    get exchange() {
        return this._exchange;
    }

    get asset() {
        return this._asset;
    }

    get currency() {
        return this._currency;
    }

    get timeframe() {
        return this._timeframe;
    }

    clear() {
        this._lastCandle = null;
        this._state = {
            variables: {},
            positions: [],
            posLastNumb: {},
            indicators: {},
            initialized: false
        };
        this._hasAlerts = false;
    }

    start() {
        this._status = RobotStatus.started;
        this._startedAt = dayjs.utc().toISOString();
        this._stoppedAt = null;
        this._eventsToSend.push({
            type: RobotWorkerEvents.STARTED,
            data: {
                robotId: this._id
            }
        });
    }

    stop() {
        this._status = RobotStatus.stopped;
        this._stoppedAt = dayjs.utc().toISOString();
        this._error = null;
        this._eventsToSend.push({
            type: RobotWorkerEvents.STOPPED,
            data: {
                robotId: this._id
            }
        });
    }

    pause() {
        this._status = RobotStatus.paused;
        this._eventsToSend.push({
            type: RobotWorkerEvents.PAUSED,
            data: {
                robotId: this._id
            }
        });
    }

    setError(err: any) {
        this._eventsToSend.push({
            type: RobotWorkerEvents.ERROR,
            data: {
                robotId: this._id,
                error: err.message
            }
        });
    }

    get requiredHistoryMaxBars() {
        return this._settings.strategySettings.requiredHistoryMaxBars;
    }

    get id() {
        return this._id;
    }

    get status() {
        return this._status;
    }

    set status(status) {
        this._status = status;
    }

    get lastCandle() {
        return this._lastCandle;
    }

    get strategySettings() {
        return this._settings.strategySettings;
    }

    get robotSettings() {
        return this._settings.robotSettings;
    }

    get settingsActiveFrom() {
        return this._settings.activeFrom;
    }

    get settings() {
        return this._settings;
    }

    set settings(settings: { strategySettings: StrategySettings; robotSettings: RobotSettings; activeFrom: string }) {
        this._settings = settings;
    }

    get hasActions() {
        return this._hasAlerts;
    }

    get hasBaseIndicators() {
        return Object.values(this._state.indicators).filter(({ type }) => type === IndicatorType.base);
    }

    get baseIndicatorsFileNames() {
        return Object.values(this._state.indicators)
            .filter(({ type }) => type === IndicatorType.base)
            .map(({ fileName }) => fileName);
    }

    setBaseIndicatorsCode(baseIndicators: { fileName: string; code: IndicatorCode }[]) {
        baseIndicators.forEach(({ fileName, code }) => {
            this._baseIndicatorsCode[fileName] = code;
        });
    }

    setStrategy(
        strategyCodeParam: StrategyCode = {
            init() {
                throw new Error("Not implemented");
            },
            check() {
                throw new Error("Not implemented");
            }
        },
        strategyState: StrategyProps = this._state
    ) {
        let strategyCode: { [key: string]: any } = {};
        if (strategyCodeParam) strategyCode = strategyCodeParam;
        // Функции стратегии
        const strategyFunctions: { [key: string]: () => any } = {};
        Object.getOwnPropertyNames(strategyCode)
            .filter((key) => typeof strategyCode[key] === "function")
            .forEach((key) => {
                strategyFunctions[key] = strategyCode[key];
            });
        // Схема параметров
        const { parametersSchema } = strategyCode;

        // Создаем новый инстанс класса стратегии
        this._strategyInstance = new BaseStrategy({
            initialized: strategyState.initialized,
            strategySettings: this._settings.strategySettings,
            exchange: this._exchange,
            asset: this._asset,
            currency: this._currency,
            timeframe: this._timeframe,
            robotId: this._id,
            backtest: this._backtest,
            posLastNumb: strategyState.posLastNumb,
            positions: strategyState.positions,
            parametersSchema,
            strategyFunctions, // функции стратегии
            ...strategyState // предыдущий стейт стратегии
        });
    }

    /**
     *  Загрузка индикаторов
     *
     * @memberof Adviser
     */
    setIndicators() {
        // Идем по всем свойствам в объекте индикаторов
        Object.keys(this._state.indicators).forEach((key) => {
            // Считываем индикатор по ключу
            const indicator = this._state.indicators[key];
            // В зависимости от типа индикатора
            switch (indicator.type) {
                case IndicatorType.base: {
                    // Если базовый индикатор

                    // Считываем объект индикатора

                    const indicatorCode = this._baseIndicatorsCode[`${indicator.fileName}`];
                    // Берем все функции индикатора
                    const indicatorFunctions: { [key: string]: () => any } = {};
                    Object.getOwnPropertyNames(indicatorCode)
                        .filter((ownProp) => typeof indicatorCode[ownProp] === "function")
                        .forEach((ownProp) => {
                            indicatorFunctions[ownProp] = indicatorCode[ownProp];
                        });

                    // Схема параметров
                    const { parametersSchema } = indicatorCode;
                    // Создаем новый инстанc базового индикатора
                    this._indicatorInstances[key] = new BaseIndicator({
                        exchange: this._exchange,
                        asset: this._asset,
                        currency: this._currency,
                        timeframe: this._timeframe,
                        robotId: this._id,
                        parametersSchema,
                        indicatorFunctions, // функции индикатора
                        ...indicator // стейт индикатора
                    });
                    break;
                }
                case IndicatorType.tulip: {
                    // Если внешний индикатор Tulip

                    // Создаем новый инстанc индикатора Tulip
                    this._indicatorInstances[key] = new TulipIndicator({
                        exchange: this._exchange,
                        asset: this._asset,
                        currency: this._currency,
                        timeframe: this._timeframe,
                        robotId: this._id,
                        parameters: indicator.parameters,
                        ...indicator // стейт индикатора
                    });
                    break;
                }
                /* case INDICATORS_TALIB: {
              // Если внешний индикатор Talib
  
              // Создаем новый инстанc индикатора Talib
              this._indicatorInstances[key] = new TalibIndicatorClass({
                exchange: this._exchange,
                asset: this._asset,
                currency: this._currency,
                timeframe: this._timeframe,
                robotId: this._id,
                parameters: indicator.parameters,
                ...indicator // стейт индикатора
              });
  
              break;
            }
            case INDICATORS_TECH: {
              // Если внешний индикатор Tech
  
              // Создаем новый инстанc индикатора Tech
              this._indicatorInstances[key] = new TechInicatatorClass({
                exchange: this._exchange,
                asset: this._asset,
                currency: this._currency,
                timeframe: this._timeframe,
                robotId: this._id,
                parameters: indicator.parameters,
                ...indicator // стейт индикатора
              });
  
              break;
            } */
                default:
                    // Неизвестный тип индикатора - ошибка
                    throw new Error(`Unknown indicator type ${indicator.type}`);
            }
        });
    }

    /**
     * Инициализация стратегии
     *
     * @memberof Adviser
     */
    initStrategy() {
        // Если стратегия еще не проинициализирована
        if (!this._strategyInstance.initialized) {
            // Инициализируем
            this._strategyInstance._checkParameters();
            this._strategyInstance.init();
            this._strategyInstance.initialized = true;
            // Считываем настройки индикаторов
            this._state.indicators = this._strategyInstance.indicators;
        }
        this.getStrategyState();
    }

    /**
     * Инициализация индикаторов
     *
     * @memberof Adviser
     */
    initIndicators() {
        Object.keys(this._state.indicators).forEach((key) => {
            if (!this._indicatorInstances[key].initialized) {
                this._indicatorInstances[key]._checkParameters();
                this._indicatorInstances[key].init();
                this._indicatorInstances[key].initialized = true;
            }
        });
        this.getIndicatorsState();
    }

    /**
     * Пересчет индикаторов
     *
     * @memberof Adviser
     */
    async calcIndicators() {
        await Promise.all(
            Object.keys(this._state.indicators).map(async (key) => {
                this._indicatorInstances[key]._eventsToSend = [];
                this._indicatorInstances[key]._handleCandles(this._candle, this._candles, this._candlesProps);
                await this._indicatorInstances[key].calc();
            })
        );
        this.getIndicatorsState();
    }

    /**
     * Запуск основной функции стратегии
     *
     * @memberof Adviser
     */
    runStrategy() {
        // Передать свечу и значения индикаторов в инстанс стратегии
        this._strategyInstance._handleCandles(this._candle, this._candles, this._candlesProps);
        this._strategyInstance._handleIndicators(this._state.indicators);
        // Очищаем предыдущие  задачи у позиций
        this._strategyInstance._clearAlerts();
        // Запустить проверку стратегии
        this._strategyInstance.check();
        this._strategyInstance._createAlertEvents();
        this.getStrategyState();
    }

    checkAlerts() {
        // Передать свечу и значения индикаторов в инстанс стратегии
        this._strategyInstance._handleCandles(this._candle, this._candles, this._candlesProps);
        // Запустить проверку стратегии
        this._strategyInstance._checkAlerts();
        this.getStrategyState();
    }

    handleHistoryCandles(candles: DBCandle[]) {
        this._candles = candles;
    }

    /**
     * Преобразование свечей для индикаторов
     *
     * @memberof Adviser
     */
    _prepareCandles() {
        this._candlesProps = {
            open: [],
            high: [],
            low: [],
            close: [],
            volume: []
        };
        this._candles.forEach((candle) => {
            this._candlesProps.open.push(candle.open);
            this._candlesProps.high.push(candle.high);
            this._candlesProps.low.push(candle.low);
            this._candlesProps.close.push(candle.close);
            this._candlesProps.volume.push(candle.volume);
        });
    }

    handleCandle(candle: DBCandle) {
        logger.info(`Robot ${this._id} - New candle ${candle.timestamp}`);
        if (this._lastCandle && candle.time === this._lastCandle.time) {
            return {
                success: false,
                error: `Robot #${this._id} candle ${candle.timestamp} already processed`
            };
        }
        if (!this._candles.find(({ time }) => time === candle.time)) {
            this._candles = [...this._candles, candle].sort((a, b) => sortAsc(a.time, b.time));
        }
        this._candles = this._candles.slice(-this.requiredHistoryMaxBars);
        this._candle = candle;
        if (!this._lastCandle && this._candles.length > 1) this._lastCandle = this._candles[this._candles.length - 2];
        this._prepareCandles();
        if (
            !this._candle ||
            !this._candles ||
            !this._candlesProps ||
            !Array.isArray(this._candles) ||
            this._candles.length === 0 ||
            Object.keys(this._candlesProps).length === 0
        )
            return {
                success: false,
                error: `Robot #${this._id} wrong input candles`
            };

        return { success: true };
    }

    handleCurrentCandle(candle: DBCandle) {
        this._candle = candle;
    }

    clearEvents() {
        this._eventsToSend = [];
        this._postionsToSave = [];
        this._strategyInstance._eventsToSend = [];
        this._strategyInstance._positionsToSave = [];
    }

    finalize() {
        this._lastCandle = this._candle;
    }

    /**
     * Запрос текущего состояния индикаторов
     *
     * @memberof Adviser
     */
    getIndicatorsState() {
        Object.keys(this._state.indicators).forEach((ind) => {
            this._eventsToSend = [...this._eventsToSend, ...this._indicatorInstances[ind]._eventsToSend];
            this._state.indicators[ind].initialized = this._indicatorInstances[ind].initialized;
            this._state.indicators[ind].parameters = this._indicatorInstances[ind].parameters;
            // Все свойства инстанса стратегии
            Object.keys(this._indicatorInstances[ind])
                .filter((key) => !key.startsWith("_")) // публичные (не начинаются с "_")
                .forEach((key) => {
                    if (typeof this._indicatorInstances[ind][key] !== "function")
                        this._state.indicators[ind].variables[key] = this._indicatorInstances[ind][key]; // сохраняем каждое свойство
                });
        });
    }

    /**
     * Запрос текущего состояния стратегии
     *
     * @memberof Adviser
     */
    getStrategyState() {
        this._eventsToSend = [...this._eventsToSend, ...this._strategyInstance._eventsToSend];
        this._postionsToSave = this._strategyInstance._positionsToSave;
        this._state.initialized = this._strategyInstance.initialized;
        this._state.positions = this._strategyInstance.validPositions;
        this._state.posLastNumb = this._strategyInstance.posLastNumb;
        this._hasAlerts = this._strategyInstance.hasAlerts;
        // Все свойства инстанса стратегии
        Object.keys(this._strategyInstance)
            .filter((key) => !key.startsWith("_")) // публичные (не начинаются с "_")
            .forEach((key) => {
                if (typeof this._strategyInstance[key] !== "function")
                    this._state.variables[key] = this._strategyInstance[key]; // сохраняем каждое свойство
            });
    }

    get robotState(): RobotState {
        return {
            id: this._id,
            code: this._code,
            name: this._name,
            mod: this._mod,
            available: this._available,
            exchange: this._exchange,
            asset: this._asset,
            currency: this._currency,
            timeframe: this._timeframe,
            strategyName: this._strategyName,
            settings: this._settings,
            lastCandle: this._lastCandle,
            hasAlerts: this._hasAlerts,
            status: this._status,
            startedAt: this._startedAt,
            stoppedAt: this._stoppedAt,
            state: this._state
        };
    }

    get props() {
        return {
            robotId: this._id,
            exchange: this._exchange,
            asset: this._asset,
            currency: this._currency,
            timeframe: this._timeframe,
            strategyName: this._strategyName
        };
    }

    get state() {
        return this._state;
    }
}
