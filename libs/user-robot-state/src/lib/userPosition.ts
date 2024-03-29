import { v4 as uuid } from "uuid";
import dayjs from "@cryptuoso/dayjs";
import {
    Order,
    OrderDirection,
    OrderJobType,
    OrderStatus,
    OrderType,
    PositionDirection,
    SignalEvent,
    Timeframe,
    TradeAction,
    TradeInfo,
    TradeSettings,
    ValidTimeframe
} from "@cryptuoso/market";
import {
    UserTradeEvent,
    UserPositionState,
    UserPositionInternalState,
    UserPositionJob,
    UserPositionOrderStatus,
    UserPositionStatus,
    UserPositionDB,
    UserRobotDB
} from "./types";
import { ConnectorJob, Priority } from "@cryptuoso/connector-state";
import { addPercent, average, round, sortAsc, sum } from "@cryptuoso/helpers";
import { BaseError } from "@cryptuoso/errors";

const ORDER_OPEN_TIMEOUT = 120; //TODO: env var

export class UserPosition {
    _id: string;
    _prefix: string;
    _code: string;
    _positionCode: string;
    _positionId: string;
    _userRobotId: string;
    _userPortfolioId: string;
    _userId: string;
    _userExAccId: string;
    _settings: UserRobotDB["settings"];
    _exchange: string;
    _asset: string;
    _currency: string;
    _timeframe: ValidTimeframe;
    _status: UserPositionStatus;
    _parentId?: string;
    _direction: PositionDirection;
    _entryAction?: TradeAction;
    _entryStatus?: UserPositionOrderStatus;
    _entrySignalPrice?: number;
    _entryPrice?: number;
    _entryDate?: string;
    _entryCandleTimestamp?: string;
    _entryVolume?: number;
    _entryExecuted?: number;
    _entryRemaining?: number;
    _exitAction?: TradeAction;
    _exitStatus?: UserPositionOrderStatus;
    _exitSignalPrice?: number;
    _exitPrice?: number;
    _exitDate?: string;
    _exitCandleTimestamp?: string;
    _exitVolume?: number;
    _exitExecuted?: number;
    _exitRemaining?: number;
    _reason?: string; //TODO ENUM
    _profit?: number;
    _barsHeld?: number;
    _internalState: UserPositionInternalState;
    _entryOrders?: Order[];
    _exitOrders?: Order[];
    _nextJobAt?: string;
    _nextJob?: UserPositionJob;
    _tradeSettings: TradeSettings;
    _ordersToCreate: Order[];
    _connectorJobs: ConnectorJob[];
    _hasRecentTrade: boolean;
    _meta?: {
        currentBalance?: number;
    };

    constructor(state: UserPositionState) {
        this._id = state.id;
        this._prefix = state.prefix;
        this._code = state.code;
        this._positionCode = state.positionCode;
        this._positionId = state.positionId;
        this._userRobotId = state.userRobotId;
        this._userPortfolioId = state.userPortfolioId;
        this._userId = state.userId;
        this._userExAccId = state.userExAccId;
        this._settings = state.settings;
        this._tradeSettings = state.tradeSettings;
        this._exchange = state.exchange;
        this._asset = state.asset;
        this._currency = state.currency;
        this._timeframe = state.timeframe;
        this._status = state.status;
        this._parentId = state.parentId || null;
        this._direction = state.direction;
        this._entryAction = state.entryAction;
        this._entryStatus = state.entryStatus;
        this._entrySignalPrice = state.entrySignalPrice;
        this._entryPrice = state.entryPrice;
        this._entryDate = state.entryDate;
        this._entryCandleTimestamp = state.entryCandleTimestamp;
        this._entryVolume = state.entryVolume;
        this._entryExecuted = state.entryExecuted;
        this._entryRemaining = state.entryRemaining;
        this._exitAction = state.exitAction;
        this._exitStatus = state.exitStatus;
        this._exitSignalPrice = state.exitSignalPrice;
        this._exitPrice = state.exitPrice;
        this._exitDate = state.exitDate;
        this._exitCandleTimestamp = state.exitCandleTimestamp;
        this._exitVolume = state.exitVolume;
        this._exitExecuted = state.exitExecuted;
        this._exitRemaining = state.exitRemaining;
        this._internalState = state.internalState || {
            entrySlippageCount: 0,
            exitSlippageCount: 0
        };
        this._reason = state.reason;
        this._profit = state.profit;
        this._barsHeld = state.barsHeld;
        this._nextJobAt = state.nextJobAt;
        this._nextJob = state.nextJob;
        this._entryOrders = state.entryOrders || [];
        this._exitOrders = state.exitOrders || [];
        this._meta = state.meta || { currentBalance: null };
        this._ordersToCreate = [];
        this._connectorJobs = [];
        this._hasRecentTrade = false;
        this._updateEntry();
        this._updateExit();
        this._setStatus();
    }

    get id() {
        return this._id;
    }

    get prefix() {
        return this._prefix;
    }

    get positionNumber() {
        return +this._positionCode.split(`${this._prefix}_`)[1];
    }

    get code() {
        return this._code;
    }

    get positionId() {
        return this._positionId;
    }

    get direction() {
        return this._direction;
    }

    get status() {
        return this._status;
    }

    get parentId() {
        return this._parentId;
    }

    get isActive() {
        return (
            this._status !== UserPositionStatus.closed &&
            this._status !== UserPositionStatus.closedAuto &&
            this._status !== UserPositionStatus.canceled
        );
    }

    get entryStatus() {
        return this._entryStatus;
    }

    get exitStatus() {
        return this._exitStatus;
    }

    get hasRecentTrade() {
        return this._hasRecentTrade;
    }

    get nextJob() {
        return this._nextJob;
    }

    cancel() {
        this._nextJob = UserPositionJob.cancel;
        this._nextJobAt = dayjs.utc().toISOString();
    }

    _setStatus() {
        if (
            this._status === UserPositionStatus.closed ||
            this._status === UserPositionStatus.closedAuto ||
            this._status === UserPositionStatus.canceled
        )
            return;
        if (this._entryStatus === UserPositionOrderStatus.new || this._entryStatus === UserPositionOrderStatus.open)
            this._status = UserPositionStatus.new;
        else if (this._entryStatus === UserPositionOrderStatus.canceled) {
            this._status = UserPositionStatus.canceled;
            this._nextJob = null;
            this._nextJobAt = null;
        } else if (this._entryStatus === UserPositionOrderStatus.partial) {
            this._status = UserPositionStatus.open;
        } else if (this._entryStatus === UserPositionOrderStatus.closed && !this._exitStatus) {
            this._status = UserPositionStatus.open;
            if (this._nextJob === UserPositionJob.open) {
                this._nextJob = null;
                this._nextJobAt = null;
            }
        } else if (
            this._exitStatus === UserPositionOrderStatus.new ||
            this._exitStatus === UserPositionOrderStatus.open ||
            this._exitStatus === UserPositionOrderStatus.partial ||
            this._exitStatus === UserPositionOrderStatus.canceled
        ) {
            this._status = UserPositionStatus.open;
        } else if (this._exitStatus === UserPositionOrderStatus.closed) {
            if (this._nextJob === UserPositionJob.cancel) this._status = UserPositionStatus.closedAuto;
            else this._status = UserPositionStatus.closed;

            this._nextJob = null;
            this._nextJobAt = null;
            this._calcStats();
        }
    }

    _updateEntry() {
        if (
            this._entryStatus !== UserPositionOrderStatus.closed &&
            this._entryStatus !== UserPositionOrderStatus.canceled &&
            this._entryOrders &&
            this._entryOrders.length
        ) {
            const order = this.lastEntryOrder;
            if (order && order.exLastTradeAt) {
                this._entryDate = dayjs.utc(order.exLastTradeAt).toISOString();
            } else if (order && order.exTimestamp) {
                this._entryDate = dayjs.utc(order.exTimestamp).toISOString();
            }

            if (this._entryDate) {
                this._entryCandleTimestamp = Timeframe.validTimeframeDatePrev(this._entryDate, this._timeframe);
            }

            this._entryPrice =
                round(
                    average(
                        ...this._entryOrders
                            .filter((o) => o.status === OrderStatus.closed)
                            .map((o) => +o.price || 0)
                            .filter((p) => p > 0)
                    ),
                    6
                ) || null;
            this._entryExecuted =
                round(
                    sum(
                        ...this._entryOrders.filter((o) => o.status === OrderStatus.closed).map((o) => +o.executed || 0)
                    ),
                    6
                ) || 0;
            this._entryRemaining = round(this._entryVolume - this._entryExecuted, 6);

            if (this._entryRemaining < 0)
                throw new BaseError(
                    "Wrong entry remaining value",
                    {
                        userPositionId: this._id
                    },
                    "ERR_CONFLICT"
                );

            if (!this._entryOrders.filter((o) => o.status === OrderStatus.closed).length) {
                this._entryStatus = UserPositionOrderStatus.new;
            } else if (
                this._entryOrders.filter((o) => o.status === OrderStatus.closed).length &&
                this._entryExecuted === 0
            ) {
                this._entryStatus = UserPositionOrderStatus.open;
            } else if (this._entryExecuted > 0) {
                this._hasRecentTrade = true;

                this._entryStatus = UserPositionOrderStatus.closed;
            }
        }
    }

    _updateExit() {
        if (
            this._exitStatus !== UserPositionOrderStatus.closed &&
            this._exitStatus !== UserPositionOrderStatus.canceled &&
            this._exitOrders &&
            this._exitOrders.length
        ) {
            const order = this.lastExitOrder;
            if (order && order.exLastTradeAt) {
                this._exitDate = dayjs.utc(order.exLastTradeAt).toISOString();
            } else if (order && order.exTimestamp) {
                this._exitDate = dayjs.utc(order.exTimestamp).toISOString();
            }
            if (this._exitDate) {
                this._exitCandleTimestamp = Timeframe.validTimeframeDatePrev(this._exitDate, this._timeframe);
            }

            this._exitPrice =
                round(
                    average(
                        ...this._exitOrders
                            .filter((o) => o.status === OrderStatus.closed)
                            .map((o) => +o.price || 0)
                            .filter((p) => p > 0)
                    ),
                    6
                ) || null;
            this._exitExecuted =
                round(
                    sum(
                        ...this._exitOrders.filter((o) => o.status === OrderStatus.closed).map((o) => +o.executed || 0)
                    ),
                    6
                ) || 0;
            this._exitRemaining = round(this._exitVolume - this._exitExecuted, 6);

            if (this._exitRemaining < 0)
                throw new BaseError(
                    "Wrong exit remaining value",
                    {
                        userPositionId: this._id
                    },
                    "ERR_CONFLICT"
                );
            if (!this._exitExecuted) {
                this._exitStatus = UserPositionOrderStatus.new;
            } else if (this._exitExecuted && this._exitExecuted === 0) {
                this._exitStatus = UserPositionOrderStatus.open;
            } else if (this._exitExecuted > 0 && this._exitExecuted !== this._exitVolume) {
                this._exitStatus = UserPositionOrderStatus.partial;
            } else if (this._exitExecuted === this._exitVolume) {
                this._hasRecentTrade = true;
                this._exitStatus = UserPositionOrderStatus.closed;
            }
        }
    }

    _calcStats() {
        const entryBalance = +round(
            sum(...this._entryOrders.filter((o) => o.status === OrderStatus.closed).map((o) => +o.price * +o.executed)),
            6
        );
        const entryFee = sum(
            ...this._entryOrders.filter((o) => o.status === OrderStatus.closed).map((o) => (o.fee && +o.fee) || 0)
        );

        const exitBalance = +round(
            sum(...this._exitOrders.filter((o) => o.status === OrderStatus.closed).map((o) => +o.price * +o.executed)),
            6
        );
        const exitFee = sum(
            ...this._exitOrders.filter((o) => o.status === OrderStatus.closed).map((o) => (o.fee && +o.fee) || 0)
        );

        const fee = entryFee + exitFee;

        if (this._direction === "long") {
            this._profit = +round(exitBalance - entryBalance, 6);
        } else {
            this._profit = +round(entryBalance - exitBalance, 6);
        }

        this._profit = +round(this._profit - fee, 6);

        this._barsHeld = +round(
            dayjs.utc(this._exitCandleTimestamp).diff(dayjs.utc(this._entryCandleTimestamp), "minute") / this._timeframe
        );
    }

    get tradeEvent(): UserTradeEvent {
        return {
            id: this._id,
            code: this._code,
            exchange: this._exchange,
            asset: this._asset,
            currency: this._currency,
            userRobotId: this._userRobotId,
            userPositionId: this._id,
            userPortfolioId: this._userPortfolioId,
            userId: this._userId,
            status: this._status,
            entryAction: this._entryAction,
            entryStatus: this._entryStatus,
            entryPrice: this._entryPrice,
            entryDate: this._entryDate,
            entryCandleTimestamp: this._entryCandleTimestamp,
            entryExecuted: this._entryExecuted,
            exitAction: this._exitAction,
            exitStatus: this._exitStatus,
            exitPrice: this._exitPrice,
            exitDate: this._exitDate,
            exitCandleTimestamp: this._exitCandleTimestamp,
            exitExecuted: this._exitExecuted,
            reason: this._reason,
            profit: this._profit,
            barsHeld: this._barsHeld
        };
    }

    get state(): UserPositionDB {
        return {
            id: this._id,
            prefix: this._prefix,
            code: this._code,
            positionCode: this._positionCode,
            positionId: this._positionId,
            userRobotId: this._userRobotId,
            userPortfolioId: this._userPortfolioId,
            userId: this._userId,
            exchange: this._exchange,
            asset: this._asset,
            currency: this._currency,
            status: this._status,
            parentId: this._parentId,
            direction: this._direction,
            entryAction: this._entryAction,
            entryStatus: this._entryStatus,
            entrySignalPrice: this._entrySignalPrice,
            entryPrice: this._entryPrice,
            entryDate: this._entryDate,
            entryCandleTimestamp: this._entryCandleTimestamp,
            entryVolume: this._entryVolume,
            entryExecuted: this._entryExecuted,
            entryRemaining: this._entryRemaining,
            exitAction: this._exitAction,
            exitStatus: this._exitStatus,
            exitSignalPrice: this._exitSignalPrice,
            exitPrice: this._exitPrice,
            exitDate: this._exitDate,
            exitCandleTimestamp: this._exitCandleTimestamp,
            exitVolume: this._exitVolume,
            exitExecuted: this._exitExecuted,
            exitRemaining: this._exitRemaining,
            internalState: this._internalState,
            reason: this._reason,
            profit: this._profit,
            barsHeld: this._barsHeld,
            nextJobAt: this._nextJobAt,
            nextJob: this._nextJob,
            meta: this._meta
        };
    }

    get ordersToCreate() {
        return this._ordersToCreate;
    }

    get connectorJobs() {
        return this._connectorJobs;
    }

    get hasOpenEntryOrders() {
        return (
            this._entryOrders &&
            Array.isArray(this._entryOrders) &&
            this._entryOrders.filter((o) => o.status !== OrderStatus.canceled && o.status !== OrderStatus.closed)
                .length > 0
        );
    }

    get hasOpenExitOrders() {
        return (
            this._exitOrders &&
            Array.isArray(this._exitOrders) &&
            this._exitOrders.filter((o) => o.status !== OrderStatus.canceled && o.status !== OrderStatus.closed)
                .length > 0
        );
    }

    get lastEntryOrder() {
        return (
            this._entryOrders &&
            Array.isArray(this._entryOrders) &&
            this._entryOrders.length > 0 &&
            this._entryOrders.sort((a, b) => sortAsc(a.createdAt, b.createdAt))[this._entryOrders.length - 1]
        );
    }

    get lastExitOrder() {
        return (
            this._exitOrders &&
            Array.isArray(this._exitOrders) &&
            this._exitOrders.length > 0 &&
            this._exitOrders.sort((a, b) => sortAsc(a.createdAt, b.createdAt))[this._exitOrders.length - 1]
        );
    }

    get hasEntrySlippage() {
        return this._tradeSettings.slippage && this._tradeSettings.slippage.entry;
    }

    get hasExitSlippage() {
        return this._tradeSettings.slippage && this._tradeSettings.slippage.exit;
    }

    _isActionEntry(action: TradeAction) {
        return action === TradeAction.long || action === TradeAction.short;
    }

    _isActionExit(action: TradeAction) {
        return action === TradeAction.closeLong || action === TradeAction.closeShort;
    }

    _isActionLong(action: TradeAction) {
        return action === TradeAction.long || action === TradeAction.closeLong;
    }

    _isActionShort(action: TradeAction) {
        return action === TradeAction.short || action === TradeAction.closeShort;
    }

    _isActionBuy(action: TradeAction) {
        return action === TradeAction.long || action === TradeAction.closeShort;
    }

    _isActionSell(action: TradeAction) {
        return action === TradeAction.short || action === TradeAction.closeLong;
    }

    _setPrice(trade: TradeInfo) {
        if (!trade.price) return trade.price;
        let price: number = trade.price;
        let slippage: number;
        if (this._isActionEntry(trade.action)) {
            if (
                this._tradeSettings.slippage &&
                this._tradeSettings.slippage.entry &&
                this._tradeSettings.slippage.entry.stepPercent > 0
            ) {
                this._internalState.entrySlippageCount += 1;
                slippage = this._tradeSettings.slippage.entry.stepPercent * this._internalState.entrySlippageCount;
            }
        } else {
            if (
                this._tradeSettings.slippage &&
                this._tradeSettings.slippage.exit &&
                this._tradeSettings.slippage.exit.stepPercent > 0
            ) {
                this._internalState.exitSlippageCount += 1;
                slippage = this._tradeSettings.slippage.exit.stepPercent * this._internalState.exitSlippageCount;
            }
        }

        if (slippage && slippage > 0) {
            if (this._isActionBuy(trade.action)) price = addPercent(price, slippage);
            else price = addPercent(price, -slippage);
        }

        if (
            this._isActionEntry(trade.action) &&
            this._tradeSettings.deviation &&
            this._tradeSettings.deviation.entry &&
            this._tradeSettings.deviation.entry > 0
        ) {
            if (this._isActionBuy(trade.action)) price += this._tradeSettings.deviation.entry;
            else price -= this._tradeSettings.deviation.entry;
        } else if (
            this._isActionExit(trade.action) &&
            this._tradeSettings.deviation &&
            this._tradeSettings.deviation.exit &&
            this._tradeSettings.deviation.exit > 0
        ) {
            if (this._isActionBuy(trade.action)) price += this._tradeSettings.deviation.exit;
            else price -= this._tradeSettings.deviation.exit;
        }
        return price;
    }

    _createOrder(trade: TradeInfo) {
        const order: Order = {
            id: uuid(),
            userExAccId: this._userExAccId,
            userRobotId: this._userRobotId,
            positionId: this._positionId,
            userPositionId: this._id,
            userPortfolioId: this._userPortfolioId,
            exchange: this._exchange,
            asset: this._asset,
            currency: this._currency,
            action: trade.action,
            direction: this._isActionBuy(trade.action) ? OrderDirection.buy : OrderDirection.sell,
            type: trade.orderType,
            signalPrice: trade.price,
            price: this._setPrice(trade),
            volume: this._isActionExit(trade.action)
                ? this._exitRemaining || this._entryExecuted
                : this._settings.volume,
            executed: 0,
            params: {
                orderTimeout: this._tradeSettings.orderTimeout || ORDER_OPEN_TIMEOUT,
                useOrderBookPrice: this._tradeSettings.useOrderBookPrice || false
            },
            createdAt: dayjs.utc().toISOString(),
            status: OrderStatus.new,
            nextJob: {
                type: OrderJobType.create
            }
        };
        if (order.volume <= 0)
            throw new BaseError(
                "Wrong order volume value",
                {
                    userPositionId: this._id,
                    orderId: order.id,
                    volume: order.volume
                },
                "ERR_CONFLICT"
            );

        order.remaining = order.volume;

        return order;
    }

    _open(trade: TradeInfo & { timestamp?: string }) {
        const order = this._createOrder(trade);
        this._ordersToCreate.push(order);
        this._connectorJobs.push({
            id: uuid(),
            type: OrderJobType.create,
            priority: Priority.high,
            userExAccId: this._userExAccId,
            orderId: order.id,
            nextJobAt: dayjs.utc().toISOString()
        });
        this._entryOrders.push(order);

        this._entryVolume = this._settings.volume;
        this._entryAction = trade.action;

        this._updateEntry();
        this._setStatus();
    }

    _close(trade: TradeInfo & { timestamp?: string }) {
        const order = this._createOrder(trade);
        this._ordersToCreate.push(order);
        this._connectorJobs.push({
            id: uuid(),
            type: OrderJobType.create,
            priority: Priority.high,
            userExAccId: this._userExAccId,
            orderId: order.id,
            nextJobAt: dayjs.utc().toISOString()
        });
        this._exitOrders.push(order);

        if (!this._exitVolume) this._exitVolume = this._entryExecuted;
        this._exitAction = trade.action;

        this._updateExit();
        this._setStatus();
    }

    handleSignal(signal: SignalEvent) {
        if (this._isActionEntry(signal.action)) {
            if (this._entryStatus || this._nextJob === UserPositionJob.open)
                throw new BaseError(
                    "Position already open",
                    {
                        userPositionId: this._id
                    },
                    "ERR_CONFLICT"
                );

            this._entrySignalPrice = signal.price;
            this._nextJob = UserPositionJob.open;
            this._nextJobAt = dayjs.utc().toISOString();
            this._open(signal);
        } else if (this._isActionExit(signal.action)) {
            if (this._exitStatus || this._nextJob === UserPositionJob.close) return;

            if (this._entryStatus !== UserPositionOrderStatus.closed) {
                this.cancel();
                return;
            }

            if (this._nextJob === UserPositionJob.cancel) return;

            this._exitSignalPrice = signal.price;
            this._nextJob = UserPositionJob.close;
            this._nextJobAt = dayjs.utc().toISOString();
            this._close(signal);
        }
    }

    handleDelayedSignal() {
        this.handleSignal(this._internalState.delayedSignal);
    }

    handleOrder(order: Order) {
        if (order.userRobotId !== this._userRobotId)
            throw new BaseError(
                "Wrong user robot id",
                {
                    order,
                    userRobotId: this._userRobotId
                },
                "ERR_WRONG"
            );
        if (order.userPositionId !== this._id)
            throw new BaseError(
                "Wrong user position id",
                {
                    order,
                    userPositionId: this._id
                },
                "ERR_WRONG"
            );
        if (this._isActionEntry(order.action)) {
            this._entryOrders = [...this._entryOrders.filter(({ id }) => id !== order.id), order];
            this._updateEntry();
        } else {
            this._exitOrders = [...this._exitOrders.filter(({ id }) => id !== order.id), order];
            this._updateExit();
        }

        this._setStatus();
    }

    _tryToOpen() {
        if (
            this._entryStatus === UserPositionOrderStatus.closed ||
            (this._entryExecuted && this._entryExecuted === this._entryVolume) ||
            this.hasOpenEntryOrders
        )
            return;

        const lastOrder = this.lastEntryOrder;
        if (!lastOrder) return;

        if (
            this.hasEntrySlippage &&
            this._internalState.entrySlippageCount < this._tradeSettings.slippage.entry.count
        ) {
            if (lastOrder.status === OrderStatus.canceled) {
                this._connectorJobs.push({
                    id: uuid(),
                    type: OrderJobType.recreate,
                    priority: Priority.medium,
                    userExAccId: this._userExAccId,
                    orderId: lastOrder.id,
                    nextJobAt: dayjs.utc().toISOString(),
                    data: {
                        price: this._setPrice({
                            action: lastOrder.action,
                            orderType: lastOrder.type,
                            price: lastOrder.signalPrice
                        })
                    }
                });
            } else if (lastOrder.status === OrderStatus.closed) {
                this._open({
                    action: lastOrder.action,
                    orderType: lastOrder.type,
                    price: this._entrySignalPrice
                });
            }
        } else {
            if (this._entryExecuted && this._entryExecuted > 0) {
                this._entryStatus = UserPositionOrderStatus.closed;
                this._setStatus();
            } else {
                this._reason = "Entry slippage exceeded";
                this._entryStatus = UserPositionOrderStatus.canceled;
                this._setStatus();
            }
        }
    }

    _tryToClose() {
        if (
            this._exitStatus === UserPositionOrderStatus.closed ||
            (this._exitExecuted && this._exitExecuted === this._exitVolume) ||
            this.hasOpenExitOrders
        )
            return;

        const lastOrder = this.lastExitOrder;
        if (!lastOrder) return;

        if (this.hasExitSlippage && this._internalState.exitSlippageCount < this._tradeSettings.slippage.exit.count) {
            if (lastOrder.status === OrderStatus.canceled) {
                this._connectorJobs.push({
                    id: uuid(),
                    type: OrderJobType.recreate,
                    priority: Priority.medium,
                    userExAccId: this._userExAccId,
                    orderId: lastOrder.id,
                    nextJobAt: dayjs.utc().toISOString(),
                    data: {
                        price: this._setPrice({
                            action: lastOrder.action,
                            orderType: lastOrder.type,
                            price: lastOrder.signalPrice
                        })
                    }
                });
            } else if (lastOrder.status === OrderStatus.closed) {
                this._close({
                    action: lastOrder.action,
                    orderType: lastOrder.type,
                    price: this._exitSignalPrice
                });
            }
        } else {
            this._tryToCancel();
        }
    }

    _tryToCancel() {
        // Position entry not closed
        if (this._entryStatus && this._entryStatus !== UserPositionOrderStatus.closed) {
            // Entry not execute
            if (
                this._entryStatus === UserPositionOrderStatus.new ||
                this._entryStatus === UserPositionOrderStatus.open
            ) {
                const orders =
                    this._entryOrders &&
                    Array.isArray(this._entryOrders) &&
                    this._entryOrders.filter(
                        (o) =>
                            (o.status === OrderStatus.new || o.status === OrderStatus.open) &&
                            (!o.nextJob || (o.nextJob && o.nextJob.type !== OrderJobType.cancel)) &&
                            o.type !== OrderType.forceMarket
                    );
                // Entry has open orders
                if (orders && orders.length > 0) {
                    // Cancel all open orders
                    orders.forEach((o) => {
                        this._connectorJobs.push({
                            id: uuid(),
                            type: OrderJobType.cancel,
                            priority: Priority.high,
                            userExAccId: this._userExAccId,
                            orderId: o.id,
                            nextJobAt: dayjs.utc().toISOString()
                        });
                    });
                } else if (!this.hasOpenEntryOrders) {
                    this._entryStatus = UserPositionOrderStatus.canceled;
                    this._status = UserPositionStatus.canceled;
                    this._nextJob = null;
                    this._nextJobAt = null;
                }
            } else if (this._entryStatus === UserPositionOrderStatus.partial) {
                // Entry already executed
                // Getting entry signal orders
                const orders =
                    this._entryOrders &&
                    Array.isArray(this._entryOrders) &&
                    this._entryOrders.filter(
                        (o) =>
                            (o.status === OrderStatus.new || o.status === OrderStatus.open) &&
                            (!o.nextJob || (o.nextJob && o.nextJob.type !== OrderJobType.cancel)) &&
                            o.type !== OrderType.forceMarket
                    );
                // Entry has open signal orders
                if (orders && orders.length > 0) {
                    // Cancel all entry signal orders
                    orders.forEach((o) => {
                        this._connectorJobs.push({
                            id: uuid(),
                            type: OrderJobType.cancel,
                            priority: Priority.high,
                            userExAccId: this._userExAccId,
                            orderId: o.id,
                            nextJobAt: dayjs.utc().toISOString()
                        });
                    });
                }
                // Entry hasn't any open signal orders
                if (!this.hasOpenEntryOrders) {
                    // Creating new exit order to close position
                    this._close({
                        action: this._direction === "long" ? TradeAction.closeLong : TradeAction.closeShort,
                        orderType: OrderType.forceMarket
                    });
                }
            }
        } else if (this._entryStatus === UserPositionOrderStatus.closed && !this._exitStatus) {
            // Position is open, but there is no exit signal
            // Creating new exit order to close position
            this._close({
                action: this._direction === "long" ? TradeAction.closeLong : TradeAction.closeShort,
                orderType: OrderType.forceMarket
            });
        } else if (this._exitStatus && this._exitStatus !== UserPositionOrderStatus.closed) {
            // Position is open, and there was an exit signal
            // Getting exit open signal orders
            const orders =
                this._exitOrders &&
                Array.isArray(this._exitOrders) &&
                this._exitOrders.filter(
                    (o) =>
                        (o.status === OrderStatus.new || o.status === OrderStatus.open) &&
                        (!o.nextJob || (o.nextJob && o.nextJob.type !== OrderJobType.cancel)) &&
                        o.type !== OrderType.forceMarket
                );
            // Exit has open signal orders
            if (orders && orders.length > 0) {
                // Cancel all exit signal orders
                orders.forEach((o) => {
                    this._connectorJobs.push({
                        id: uuid(),
                        type: OrderJobType.cancel,
                        priority: Priority.high,
                        userExAccId: this._userExAccId,
                        orderId: o.id,
                        nextJobAt: dayjs.utc().toISOString()
                    });
                });
            }

            const canceledOrders =
                this._exitOrders &&
                Array.isArray(this._exitOrders) &&
                this._exitOrders.filter((o) => o.status === OrderStatus.canceled);
            // Exit hasn't any open signal orders
            if (!this.hasOpenExitOrders) {
                if (canceledOrders.length > 5) {
                    throw new BaseError("Can't close position.");
                }

                // Creating new exit order to close position
                this._close({
                    action: this._direction === "long" ? TradeAction.closeLong : TradeAction.closeShort,
                    orderType: OrderType.forceMarket
                });
            }
        } else if (!this._entryStatus && !this._exitStatus && !this.hasOpenEntryOrders && !this.hasOpenExitOrders) {
            this._status = UserPositionStatus.canceled;
            this._nextJob = null;
            this._nextJobAt = null;
        }
    }

    executeJob() {
        if (this._nextJob === UserPositionJob.open) {
            this._tryToOpen();
        } else if (this._nextJob === UserPositionJob.close) {
            this._tryToClose();
        } else if (this._nextJob === UserPositionJob.cancel) {
            this._tryToCancel();
        }
        const lastOrder = this.lastExitOrder || this.lastEntryOrder;
        if (lastOrder) this._meta.currentBalance = lastOrder.meta?.currentBalance;
    }

    clear() {
        this._ordersToCreate = [];
        this._connectorJobs = [];
        this._hasRecentTrade = false;
    }
}
