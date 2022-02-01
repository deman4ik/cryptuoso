import dayjs from "@cryptuoso/dayjs";
import { BaseIndicator, TulipIndicator, IndicatorCode, IndicatorType, indicators } from "@cryptuoso/robot-indicators";
import {
    ValidTimeframe,
    CandleProps,
    RobotPositionStatus,
    Candle,
    calcPositionProfit,
    Timeframe
} from "@cryptuoso/market";
import { RobotWorkerEvents, SignalEvents } from "@cryptuoso/robot-events";
import { NewEvent } from "@cryptuoso/events";
import { CANDLES_RECENT_AMOUNT, equals, nvl, sortAsc } from "@cryptuoso/helpers";
import { BaseStrategy } from "./BaseStrategy";
import { RobotPositionState, RobotState, RobotStatus, StrategyProps } from "./types";
import logger from "@cryptuoso/logger";
import { calcCurrencyDynamic, RobotSettings, StrategySettings } from "@cryptuoso/robot-settings";
import { periodStatsFromArray, periodStatsToArray, TradeStats, TradeStatsCalc } from "@cryptuoso/trade-stats";
import { strategies } from "./strategies";

export interface StrategyCode {
    [key: string]: any;
    init(): void;
    check(): void;
}

export class Robot {
    [key: string]: any;
    _id: string;
    _exchange: string;
    _asset: string;
    _currency: string;
    _timeframe: ValidTimeframe;
    _strategy: string;
    _settings: {
        strategySettings: StrategySettings;
        robotSettings: RobotSettings;
        activeFrom: string;
        feeRate?: number;
    };
    _lastCandle: Candle;
    _state: StrategyProps;
    _strategyInstance: BaseStrategy;
    _indicatorInstances: { [key: string]: BaseIndicator };
    _hasAlerts: boolean;
    _baseIndicatorsCode: { [key: string]: IndicatorCode };
    _candle: Candle;
    _candles: Candle[];
    _candlesProps: CandleProps;
    _status: RobotStatus;
    _startedAt: string;
    _stoppedAt: string;
    _eventsToSend: NewEvent<any>[];
    _postionsToSave: RobotPositionState[];
    _backtest: boolean;
    _error: any;
    _stats?: TradeStats;
    _emulatedStats?: TradeStats;

    constructor(state: RobotState) {
        /* Идентификатор робота */
        this._id = state.id;

        /* Код биржи */
        this._exchange = state.exchange;
        /* Базовая валюта */
        this._asset = state.asset;
        /* Котировка валюты */
        this._currency = state.currency;
        /* Таймфрейм */
        this._timeframe = state.timeframe;
        /* Имя файла стратегии */
        this._strategy = state.strategy;

        /* Настройки */
        this._settings = {
            strategySettings: {
                ...state.settings.strategySettings,
                requiredHistoryMaxBars: nvl(
                    state.settings.strategySettings.requiredHistoryMaxBars,
                    CANDLES_RECENT_AMOUNT
                )
            },
            robotSettings: state.settings.robotSettings,
            activeFrom: nvl(state.settings.activeFrom, state.startedAt),
            feeRate: state.settings.feeRate
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
        this._hasAlerts = nvl(state.hasAlerts, false);

        this._baseIndicatorsCode = {};
        /* Текущая свеча */
        this._candle = null;
        /* Текущие свечи */
        this._candles = [];

        /* Текущий статус сервиса */
        this._status = state.status;
        /* Дата и время запуска */
        this._startedAt = state.startedAt;
        this._stoppedAt = state.stoppedAt;
        this._backtest = state.backtest;
        this._eventsToSend = [];
        this._postionsToSave = [];
        this._indicatorInstances = {};

        /* Статистика */
        this._stats = { fullStats: state.fullStats, periodStats: periodStatsFromArray(nvl(state.periodStats, [])) };
        this._emulatedStats = {
            fullStats: state.emulatedFullStats,
            periodStats: periodStatsFromArray(nvl(state.emulatedPeriodStats, []))
        };
    }

    get eventsToSend() {
        return this._eventsToSend;
    }

    get positionsToSave() {
        return this._postionsToSave;
    }

    get signalsToSave() {
        return this._eventsToSend.filter(({ type }) =>
            [SignalEvents.ALERT, SignalEvents.TRADE].includes(type as SignalEvents)
        );
    }

    get alertsToSave() {
        const { amountInUnit, unit } = Timeframe.get(this._timeframe);
        return this._eventsToSend
            .filter(({ type }) => type === SignalEvents.ALERT)
            .map(({ data }) => ({
                ...data,
                activeFrom: dayjs.utc(data.candleTimestamp).add(amountInUnit, unit).toISOString(),
                activeTo: dayjs
                    .utc(data.candleTimestamp)
                    .add(amountInUnit * 2, unit)
                    .add(-1, "millisecond")
                    .toISOString()
            }));
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

    get strategy() {
        return this._strategy;
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

    get hasAlerts() {
        return this._hasAlerts;
    }

    get emulateNextPosition() {
        return nvl(this._emulatedStats?.fullStats?.emulateNextPosition, false);
    }

    get marginNextPosition() {
        return nvl(this._emulatedStats?.fullStats?.marginNextPosition, 1);
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
        this._stoppedAt = null;
        this._eventsToSend.push({
            type: RobotWorkerEvents.STARTED,
            data: {
                robotId: this._id,
                status: RobotStatus.started
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
                robotId: this._id,
                status: RobotStatus.stopped
            }
        });
    }

    pause() {
        this._status = RobotStatus.paused;
        this._eventsToSend.push({
            type: RobotWorkerEvents.PAUSED,
            data: {
                robotId: this._id,
                status: RobotStatus.paused
            }
        });
    }

    setError(err: any) {
        this._eventsToSend.push({
            type: RobotWorkerEvents.ERROR,
            data: {
                robotId: this._id,
                candle: this._candle,
                lastCandle: this._lastCandle,
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
        Object.keys(strategyCode)
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
            emulateNextPosition: this.emulateNextPosition,
            marginNextPosition: this.marginNextPosition,
            stats: this._emulatedStats,
            posLastNumb: strategyState.posLastNumb,
            positions: strategyState.positions,
            parametersSchema,
            strategyFunctions, // функции стратегии
            ...strategyState // предыдущий стейт стратегии
        });
    }

    setStrategyState(strategyState: StrategyProps = this._state) {
        this._strategyInstance = new strategies[this._strategy]({
            initialized: strategyState.initialized,
            strategySettings: this._settings.strategySettings,
            exchange: this._exchange,
            asset: this._asset,
            currency: this._currency,
            timeframe: this._timeframe,
            robotId: this._id,
            backtest: this._backtest,
            emulateNextPosition: this.emulateNextPosition,
            marginNextPosition: this.marginNextPosition,
            stats: this._emulatedStats,
            posLastNumb: strategyState.posLastNumb,
            positions: strategyState.positions,
            ...strategyState // предыдущий стейт стратегии)
        });
    }

    /**
     *  Загрузка индикаторов
     *
     * @memberof Robot
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

                    const indicatorCode = this._baseIndicatorsCode[indicator.fileName];
                    // Берем все функции индикатора
                    const indicatorFunctions: { [key: string]: () => any } = {};
                    Object.keys(indicatorCode)
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
                        strategySettings: this._settings.strategySettings,
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
                        strategySettings: this._settings.strategySettings,
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
                strategySettings: this._settings.strategySettings,
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
                strategySettings: this._settings.strategySettings,
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

    setIndicatorsState() {
        Object.keys(this._state.indicators).forEach((key) => {
            const indicator = this._state.indicators[key];

            switch (indicator.type) {
                case IndicatorType.base: {
                    // Если базовый индикатор

                    // Считываем объект индикатора

                    // Создаем новый инстанc базового индикатора

                    this._indicatorInstances[key] = new indicators[indicator.indicatorName]({
                        exchange: this._exchange,
                        asset: this._asset,
                        currency: this._currency,
                        timeframe: this._timeframe,
                        robotId: this._id,
                        strategySettings: this._settings.strategySettings,
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
                        strategySettings: this._settings.strategySettings,
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
                strategySettings: this._settings.strategySettings,
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
                strategySettings: this._settings.strategySettings,
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
     * @memberof Robot
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
     * @memberof Robot
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
     * @memberof Robot
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
     * @memberof Robot
     */
    runStrategy() {
        // Передать свечу и значения индикаторов в инстанс стратегии
        this._strategyInstance._handleCandles(this._candle, this._candles, this._candlesProps);
        this._strategyInstance._handleIndicators(this._state.indicators);
        this._strategyInstance._handleEmulation(this.emulateNextPosition);
        this._strategyInstance._handleMargin(this.marginNextPosition);
        this._strategyInstance._handleStats(this._emulatedStats);
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

    handleHistoryCandles(candles: Candle[]) {
        this._candles = candles;
    }

    /**
     * Преобразование свечей для индикаторов
     *
     * @memberof Robot
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

    handleCandle(candle: Candle) {
        logger.debug(`Robot #${this._id} - New candle ${candle.timestamp}`);
        if (this._lastCandle && candle.time <= this._lastCandle.time) {
            logger.warn(`Robot #${this._id} candle ${candle.timestamp} already processed`);
            return false;
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
        ) {
            logger.error(`Robot #${this._id} wrong input candles`);
            return false;
        }

        return true;
    }

    handleCurrentCandle(candle: Candle) {
        if (candle.time > this._lastCandle.time) {
            this._candle = candle;
            return { success: true };
        }
        return {
            success: false,
            error: `Robot #${this._id} wrong current candle ${candle.timestamp} when last candle was ${this._lastCandle.timestamp}`
        };
    }

    async calcStats() {
        if (this.hasClosedPositions) {
            logger.debug(`Calculating #${this._id} robot stats`);

            const fullPositions = this.closedPositions.map((pos) => ({
                ...pos,
                volume: pos.volume / pos.margin,
                profit: pos.profit / pos.margin,
                worstProfit: pos.worstProfit / pos.margin
            }));
            const tradeStatsCalc = new TradeStatsCalc(
                fullPositions,
                {
                    job: {
                        type: "robot",
                        robotId: this._id,
                        recalc: false,
                        SMAWindow: this._settings.robotSettings.SMAWindow,
                        margin: this._settings.robotSettings.margin
                    },
                    initialBalance: this._settings.robotSettings.initialBalance
                },
                this._emulatedStats
            );
            const newEmulatedStats = await tradeStatsCalc.calculate();

            this._strategyInstance._handleEmulation(this.emulateNextPosition);
            this._strategyInstance._handleMargin(this.marginNextPosition);

            const notEmulatedPositions = this.closedPositions.filter((p) => !p.emulated);
            let newStats = this._stats;

            if (notEmulatedPositions.length) {
                if (
                    notEmulatedPositions.length === this.closedPositions.length &&
                    equals(this._emulatedStats, this._stats)
                ) {
                    newStats = newEmulatedStats;
                } else {
                    const tradeStatsCalc = new TradeStatsCalc(
                        notEmulatedPositions,
                        {
                            job: {
                                type: "robot",
                                robotId: this._id,
                                recalc: false,
                                SMAWindow: this._settings.robotSettings.SMAWindow,
                                margin: this._settings.robotSettings.margin
                            },
                            initialBalance: this._settings.robotSettings.initialBalance
                        },
                        this._stats
                    );
                    newStats = await tradeStatsCalc.calculate();
                }
            }

            this._emulatedStats = newEmulatedStats;
            this._stats = newStats;
        }
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
     * @memberof Robot
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
     * @memberof Robot
     */
    getStrategyState() {
        this._eventsToSend = [...this._eventsToSend, ...this._strategyInstance._eventsToSend];
        let volume: number;
        let volumeInCurrency: number;
        if (this._settings.robotSettings.volumeType === "assetStatic") {
            volume = this._settings.robotSettings.volume;
        } else if (this._settings.robotSettings.volumeType === "currencyDynamic") {
            volumeInCurrency = this._settings.robotSettings.volumeInCurrency;
        }
        this._postionsToSave = this._strategyInstance._positionsToSave.map((pos) => {
            const margin = nvl(pos.margin, 1);
            const posVolume = volume * margin || calcCurrencyDynamic(volumeInCurrency, pos.entryPrice) * margin;
            let profit;
            let worstProfit;
            if (pos.status === "closed") {
                profit = calcPositionProfit(
                    pos.direction,
                    pos.entryPrice,
                    pos.exitPrice,
                    posVolume,
                    this._settings.feeRate
                );
                worstProfit = calcPositionProfit(
                    pos.direction,
                    pos.entryPrice,
                    pos.maxPrice,
                    posVolume,
                    this._settings.feeRate
                );
                if (worstProfit > 0) worstProfit = null;
            }
            return {
                ...pos,
                volume: posVolume,
                profit,
                worstProfit
            };
        });
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
            exchange: this._exchange,
            asset: this._asset,
            currency: this._currency,
            timeframe: this._timeframe,
            strategy: this._strategy,
            settings: this._settings,
            lastCandle: this._lastCandle,
            hasAlerts: this._hasAlerts,
            status: this._status,
            startedAt: this._startedAt,
            stoppedAt: this._stoppedAt,
            state: this._state,
            fullStats: this._stats?.fullStats,
            periodStats: periodStatsToArray(this._stats?.periodStats),
            emulatedFullStats: this._emulatedStats?.fullStats,
            emulatedPeriodStats: periodStatsToArray(this._emulatedStats?.periodStats)
        };
    }

    get props() {
        return {
            robotId: this._id,
            exchange: this._exchange,
            asset: this._asset,
            currency: this._currency,
            timeframe: this._timeframe,
            strategy: this._strategy
        };
    }

    get state() {
        return this._state;
    }
}
