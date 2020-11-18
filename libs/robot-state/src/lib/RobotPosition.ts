import { sortAsc, round } from "@cryptuoso/helpers";
import dayjs from "@cryptuoso/dayjs";
import {
    TradeAction,
    OrderType,
    SignalType,
    AlertInfo,
    SignalInfo,
    ValidTimeframe,
    PositionDirection,
    RobotPositionStatus,
    RobotTradeStatus,
    Candle,
    DBCandle
} from "@cryptuoso/market";
import { RobotPositionState, RobotPostionInternalState } from "./types";

/**
 * Robot position
 *
 * @class RobotPosition
 */
export class RobotPosition {
    private _id: string;
    private _robotId: string;
    private _timeframe: ValidTimeframe;
    private _prefix: string;
    private _code: string;
    private _parentId?: string;
    private _direction?: PositionDirection;
    private _status: RobotPositionStatus;
    private _entryStatus?: RobotTradeStatus;
    private _entryPrice?: number;
    private _entryDate?: string;
    private _entryOrderType?: OrderType;
    private _entryAction?: TradeAction;
    private _entryCandleTimestamp?: string;
    private _exitStatus?: RobotTradeStatus;
    private _exitPrice?: number;
    private _exitDate?: string;
    private _exitOrderType?: OrderType;
    private _exitAction?: TradeAction;
    private _exitCandleTimestamp?: string;
    private _alerts?: { [key: string]: AlertInfo };
    private _profit: number;
    private _barsHeld: number;
    private _backtest?: boolean;
    private _internalState: RobotPostionInternalState;
    private _candle?: Candle;
    private _alertsToPublish: SignalInfo[];
    private _tradeToPublish: SignalInfo;
    _log = console.log;

    constructor(state: RobotPositionState) {
        this._id = state.id;
        this._robotId = state.robotId;
        this._timeframe = state.timeframe;
        this._prefix = state.prefix;
        this._code = state.code;
        this._parentId = state.parentId;
        this._direction = state.direction;
        this._status = state.status || RobotPositionStatus.new;
        this._entryStatus = state.entryStatus;
        this._entryPrice = state.entryPrice;
        this._entryDate = state.entryDate;
        this._entryOrderType = state.entryOrderType;
        this._entryAction = state.entryAction;
        this._entryCandleTimestamp = state.entryCandleTimestamp;
        this._exitStatus = state.exitStatus;
        this._exitPrice = state.exitPrice;
        this._exitDate = state.exitDate;
        this._exitOrderType = state.exitOrderType;
        this._exitAction = state.exitAction;
        this._exitCandleTimestamp = state.exitCandleTimestamp;
        this._alerts = state.alerts || {};
        this._profit = state.profit || 0;
        this._barsHeld = state.barsHeld || 0;
        this._backtest = state.backtest;
        this._internalState = state.internalState || {
            highestHigh: null,
            lowestLow: null,
            stop: null
        };
        this._alertsToPublish = [];
        this._tradeToPublish = null;
        this._candle = null;
    }

    public get id() {
        return this._id;
    }

    public get prefix() {
        return this._prefix;
    }

    public get code() {
        return this._code;
    }

    public get parentId() {
        return this._parentId;
    }

    public get direction() {
        return this._direction;
    }

    public get entryStatus() {
        return this._entryStatus;
    }

    public get entryPrice() {
        return this._entryPrice;
    }

    public get exitStatus() {
        return this._exitStatus;
    }

    public get exitPrice() {
        return this._exitPrice;
    }

    public get status() {
        return this._status;
    }

    public get isActive() {
        return this._status === RobotPositionStatus.open;
    }

    public get hasAlerts() {
        return Object.keys(this._alerts).length > 0;
    }

    public get hasAlertsToPublish() {
        return this._alertsToPublish.length > 0;
    }

    public get hasTradeToPublish() {
        return !!this._tradeToPublish;
    }

    public get alertsToPublish() {
        return this._alertsToPublish;
    }

    public get tradeToPublish() {
        return this._tradeToPublish;
    }

    public get internalState() {
        return this._internalState;
    }

    public get highestHigh() {
        return this._internalState.highestHigh;
    }

    public get lowestLow() {
        return this._internalState.lowestLow;
    }

    public get state(): RobotPositionState {
        return {
            id: this._id,
            robotId: this._robotId,
            timeframe: this._timeframe,
            prefix: this._prefix,
            code: this._code,
            parentId: this._parentId,
            direction: this._direction,
            status: this._status,
            entryStatus: this._entryStatus,
            entryPrice: this._entryPrice,
            entryDate: this._entryDate,
            entryOrderType: this._entryOrderType,
            entryAction: this._entryAction,
            entryCandleTimestamp: this._entryCandleTimestamp,
            exitStatus: this._exitStatus,
            exitPrice: this._exitPrice,
            exitDate: this._exitDate,
            exitOrderType: this._exitOrderType,
            exitAction: this._exitAction,
            exitCandleTimestamp: this._exitCandleTimestamp,
            alerts: this._alerts,
            profit: this._profit,
            barsHeld: this._barsHeld,
            internalState: this._internalState
        };
    }

    _clearAlertsToPublish() {
        this._alertsToPublish = [];
    }

    _clearTradeToPublish() {
        this._tradeToPublish = null;
    }

    /**
     * Clear alerts
     *
     * @memberof Position
     */
    _clearAlerts() {
        this._alerts = {};
    }

    _calcStats() {
        this._barsHeld = +round(
            dayjs.utc(this._exitCandleTimestamp).diff(dayjs.utc(this._entryCandleTimestamp), "minute") / this._timeframe
        );
    }

    _handleCandle(candle: Candle) {
        this._candle = candle;
        if (this._status === RobotPositionStatus.open) {
            this._internalState.highestHigh = Math.max(this._internalState.highestHigh || -Infinity, this._candle.high);
            this._internalState.lowestLow = Math.min(this._internalState.lowestLow || Infinity, this._candle.low);
        }
    }

    _checkOpen() {
        if (this._entryStatus === RobotTradeStatus.closed) {
            throw new Error(`Position ${this._code} is already open`);
        }
    }

    _checkClose() {
        if (this._entryStatus !== RobotTradeStatus.closed) {
            throw new Error(`Position ${this._code} is not open`);
        }
        if (this._exitStatus === RobotTradeStatus.closed) {
            throw new Error(`Position ${this._code} is already closed`);
        }
    }

    _addAlert(action: TradeAction, price: number, orderType: OrderType) {
        this._log(`${this._candle.timestamp} Position alert ${this._code} - ${action} - ${orderType} - ${price}`);
        const alert = {
            action,
            price: round(+price, 6),
            orderType,
            candleTimestamp: this._candle.timestamp,
            timestamp: dayjs.utc().toISOString()
        };
        this._alerts[this._nextAlertNumb] = alert;
        if (orderType !== OrderType.market)
            this._alertsToPublish.push({
                ...alert,
                type: SignalType.alert,
                positionId: this._id,
                positionPrefix: this._prefix,
                positionCode: this._code,
                positionParentId: this._parentId
            });
    }

    _createTradeSignal(alert: AlertInfo) {
        const { action, orderType, price } = alert;
        this._log(`${this._candle.timestamp} Position trade ${this._code} - ${action}.${orderType}.${price}`);
        this._alertsToPublish = [];
        this._tradeToPublish = {
            ...alert,
            type: SignalType.trade,
            positionId: this._id,
            positionPrefix: this._prefix,
            positionCode: this._code,
            positionParentId: this._parentId
        };
    }

    _open(alert: AlertInfo) {
        const { action, price, orderType } = alert;
        this._checkOpen();
        this._status = RobotPositionStatus.open;
        this._entryStatus = RobotTradeStatus.closed;
        this._entryPrice = price;
        this._entryDate = dayjs.utc().toISOString();
        this._entryOrderType = orderType;
        this._entryAction = action;
        this._entryCandleTimestamp = this._candle.timestamp;
        this._direction = action === TradeAction.long ? "long" : "short";
        this._createTradeSignal({
            ...alert,
            candleTimestamp: this._candle.timestamp
        });
    }

    _close(alert: AlertInfo) {
        const { action, price, orderType } = alert;
        this._checkClose();
        this._status = RobotPositionStatus.closed;
        this._exitStatus = RobotTradeStatus.closed;
        this._exitPrice = +price;
        this._exitDate = dayjs.utc().toISOString();
        this._exitOrderType = orderType;
        this._exitAction = action;
        this._exitCandleTimestamp = this._candle.timestamp;
        this._calcStats();
        this._createTradeSignal({
            ...alert,
            candleTimestamp: this._candle.timestamp
        });
    }

    get _nextAlertNumb() {
        return Object.keys(this._alerts).length + 1;
    }

    _checkAlerts() {
        for (const key of Object.keys(this._alerts).sort((a, b) => sortAsc(+a, +b))) {
            const alert = this._alerts[key];
            const success = this._checkAlert(alert);
            if (success) {
                this._alerts = {};
                break;
            }
        }
    }

    _checkAlert(alert: AlertInfo) {
        const { orderType, action, price } = alert;
        let nextPrice = null;
        switch (orderType) {
            case OrderType.stop: {
                nextPrice = RobotPosition.checkStop(action, price, this._candle, this._backtest);
                break;
            }
            case OrderType.limit: {
                nextPrice = RobotPosition.checkLimit(action, price, this._candle, this._backtest);
                break;
            }
            case OrderType.market: {
                nextPrice = RobotPosition.checkMarket(action, price, this._candle, this._backtest);
                break;
            }
            default:
                throw new Error(`Unknown order type ${orderType}`);
        }
        if (nextPrice) {
            if (action === TradeAction.long || action === TradeAction.short) {
                this._open({ ...alert, price: nextPrice });
                return true;
            }
            this._close({ ...alert, price: nextPrice });
            return true;
        }
        return false;
    }

    public static checkMarket(action: TradeAction, price: number, currentCandle: DBCandle, isBacktest = false) {
        if (action === TradeAction.long || action === TradeAction.closeShort) {
            if (!isBacktest) return +Math.max(+currentCandle.close, +price);
            else return +Math.max(+currentCandle.open, +price);
        }
        if (action === TradeAction.short || action === TradeAction.closeLong) {
            if (!isBacktest) return +Math.min(+currentCandle.close, +price);
            else return +Math.min(+currentCandle.open, +price);
        }
        throw new Error(`Unknown action ${action}`);
    }

    public static checkStop(action: TradeAction, price: number, currentCandle: DBCandle, isBacktest = false) {
        if (action === TradeAction.long || action === TradeAction.closeShort) {
            if (+currentCandle.high >= +price) {
                if (!isBacktest) return +Math.max(+currentCandle.close, +price);
                else return +Math.max(+currentCandle.open, +price);
            }
        } else if (action === TradeAction.short || action === TradeAction.closeLong) {
            if (+currentCandle.low <= +price) {
                if (!isBacktest) return +Math.min(+currentCandle.close, +price);
                else return +Math.min(+currentCandle.open, +price);
            }
        } else {
            throw new Error(`Unknown action ${action}`);
        }
        return null;
    }

    public static checkLimit(action: TradeAction, price: number, currentCandle: DBCandle, isBacktest = false): number {
        if (action === TradeAction.long || action === TradeAction.closeShort) {
            if (+currentCandle.high <= +price) {
                if (!isBacktest) return +Math.min(+currentCandle.close, +price);
                else return +Math.min(+currentCandle.open, +price);
            }
        } else if (action === TradeAction.short || action === TradeAction.closeLong) {
            if (+currentCandle.low >= +price) {
                if (!isBacktest) return +Math.max(+currentCandle.close, +price);
                else return +Math.max(+currentCandle.open, +price);
            }
        } else {
            throw new Error(`Unknown action ${action}`);
        }
        return null;
    }

    public buyAtMarket(price = +this._candle.open) {
        this._checkOpen();
        this._addAlert(TradeAction.long, price, OrderType.market);
    }

    public sellAtMarket(price = +this._candle.open) {
        this._checkClose();
        this._addAlert(TradeAction.closeLong, price, OrderType.market);
    }

    public shortAtMarket(price = +this._candle.open) {
        this._checkOpen();
        this._addAlert(TradeAction.short, price, OrderType.market);
    }

    public coverAtMarket(price = +this._candle.open) {
        this._checkClose();
        this._addAlert(TradeAction.closeShort, price, OrderType.market);
    }

    public buyAtStop(price = +this._candle.open) {
        this._checkOpen();
        this._addAlert(TradeAction.long, price, OrderType.stop);
    }

    public sellAtStop(price = +this._candle.open) {
        this._checkClose();
        this._addAlert(TradeAction.closeLong, price, OrderType.stop);
    }

    public sellAtTrailingStop(price = +this._candle.open) {
        this._checkClose();
        this._internalState.stop = this._internalState.stop ? Math.max(this._internalState.stop, price) : price;
        this._addAlert(TradeAction.closeLong, this._internalState.stop, OrderType.stop);
    }

    public shortAtStop(price = +this._candle.open) {
        this._checkOpen();
        this._addAlert(TradeAction.short, price, OrderType.stop);
    }

    public coverAtStop(price = +this._candle.open) {
        this._checkClose();
        this._addAlert(TradeAction.closeShort, price, OrderType.stop);
    }

    public coverAtTrailingStop(price = +this._candle.open) {
        this._checkClose();
        this._internalState.stop = this._internalState.stop ? Math.min(this._internalState.stop, price) : price;
        this._addAlert(TradeAction.closeShort, this._internalState.stop, OrderType.stop);
    }

    public buyAtLimit(price = +this._candle.open) {
        this._checkOpen();
        this._addAlert(TradeAction.long, price, OrderType.limit);
    }

    public sellAtLimit(price = +this._candle.open) {
        this._checkClose();
        this._addAlert(TradeAction.closeLong, price, OrderType.limit);
    }

    public shortAtLimit(price = +this._candle.open) {
        this._checkOpen();
        this._addAlert(TradeAction.short, price, OrderType.limit);
    }

    public coverAtLimit(price = +this._candle.open) {
        this._checkClose();
        this._addAlert(TradeAction.closeShort, price, OrderType.limit);
    }
}
