import { UserPosition } from "./userPosition";
import { v4 as uuid } from "uuid";
import dayjs from "@cryptuoso/dayjs";
import {
    UserPositionDB,
    UserPositionState,
    UserPositionStatus,
    UserRobotDB,
    UserRobotInternalState,
    UserRobotState,
    UserRobotStatus,
    UserTradeEvent
} from "./types";
import { Order, SignalEvent, TradeAction, TradeSettings, ValidTimeframe } from "@cryptuoso/market";
import { flattenArray, GenericObject } from "@cryptuoso/helpers";
import { OrdersStatusEvent } from "@cryptuoso/connector-events";
import { BaseError } from "@cryptuoso/errors";
import { ConnectorJob } from "@cryptuoso/connector-state";
import logger from "@cryptuoso/logger";

export class UserRobot {
    _id: string;
    _userExAccId: string;
    _userId: string;
    _robotId: string;
    _settings: UserRobotDB["settings"];
    _internalState: UserRobotInternalState;
    _allocation: UserRobotDB["allocation"];
    _status: UserRobotStatus;
    _startedAt?: string;
    _stoppedAt?: string;
    _exchange: string;
    _asset: string;
    _currency: string;
    _timeframe: ValidTimeframe;
    _tradeSettings: TradeSettings;
    _positions: GenericObject<UserPosition>;
    _message?: string;
    _userPortfolioId?: string;
    _currentPrice?: number;
    _limits: UserRobotState["limits"];
    _precision: UserRobotState["precision"];

    constructor(state: UserRobotState) {
        this._id = state.id;
        this._userExAccId = state.userExAccId;
        this._userId = state.userId;
        this._robotId = state.robotId;
        this._settings = state.settings;
        this._allocation = state.allocation;
        this._status = state.status;
        this._startedAt = state.startedAt;
        this._stoppedAt = state.stoppedAt;
        this._exchange = state.exchange;
        this._asset = state.asset;
        this._currency = state.currency;
        this._timeframe = state.timeframe;
        this._tradeSettings = state.tradeSettings;
        this._message = state.message;
        this._internalState = state.internalState || {};
        this._positions = {};
        this._setPositions(state.positions);
        this._userPortfolioId = state.userPortfolioId;
        this._currentPrice = state.currentPrice;
        this._limits = state.limits;
        this._precision = state.precision;
    }

    get id() {
        return this._id;
    }

    get status() {
        return this._status;
    }

    get message() {
        return this._message;
    }

    get stoppedAt() {
        return this._stoppedAt;
    }

    get state(): UserRobotDB {
        return {
            id: this._id,
            userExAccId: this._userExAccId,
            userId: this._userId,
            robotId: this._robotId,
            userPortfolioId: this._userPortfolioId,
            internalState: this._internalState,
            status: this._status,
            allocation: this._allocation,
            startedAt: this._startedAt,
            stoppedAt: this._stoppedAt,
            message: this._message,
            settings: this._settings
        };
    }

    get positions(): UserPositionDB[] {
        return Object.values(this._positions).map((pos) => pos.state);
    }

    get ordersToCreate(): Order[] {
        return flattenArray(Object.values(this._positions).map((pos) => pos.ordersToCreate));
    }

    get recentTrades(): UserTradeEvent[] {
        return Object.values(this._positions)
            .filter((pos) => pos.hasRecentTrade)
            .map((pos) => pos.tradeEvent);
    }

    get activePositions() {
        return this.positions.filter(
            (pos) => pos.status === UserPositionStatus.new || pos.status === UserPositionStatus.open
        );
    }

    get hasActivePositions() {
        return this.activePositions.length > 0;
    }

    get canceledPositions() {
        return this.positions.filter((pos) => pos.status === UserPositionStatus.canceled);
    }

    get hasCanceledPositions() {
        return this.canceledPositions.length > 0;
    }

    get hasClosedPositions() {
        return (
            this.positions.filter(
                (pos) => pos.status === UserPositionStatus.closed || pos.status === UserPositionStatus.closedAuto
            ).length > 0
        );
    }

    get closedAndCanceledPositions() {
        return this.positions.filter(
            (pos) =>
                pos.status === UserPositionStatus.closed ||
                pos.status === UserPositionStatus.closedAuto ||
                pos.status === UserPositionStatus.canceled
        );
    }

    get connectorJobs(): ConnectorJob[] {
        return flattenArray(Object.values(this._positions).map((pos) => pos.connectorJobs));
    }

    get settings() {
        return this._settings;
    }

    set settings(settings: UserRobotDB["settings"]) {
        this._settings = settings;
        Object.keys(this._positions).forEach((pos) => {
            this._positions[pos]._settings = settings;
        });
    }

    _setPositions(positions: UserPositionState[]) {
        if (positions && Array.isArray(positions) && positions.length > 0) {
            positions.forEach((position) => {
                this._positions[position.id] = new UserPosition({
                    ...position,
                    exchange: this._exchange,
                    asset: this._asset,
                    currency: this._currency,
                    timeframe: this._timeframe,
                    userExAccId: this._userExAccId,
                    settings: this._settings,
                    tradeSettings: this._tradeSettings
                });
            });
        }
    }

    _getNextPositionCode(prefix: string) {
        if (!this._internalState.posLastNumb) this._internalState.posLastNumb = {};
        if (prefix in this._internalState.posLastNumb) {
            this._internalState.posLastNumb[prefix] += 1;
        } else {
            this._internalState.posLastNumb[prefix] = 1;
        }
        return `${prefix}_${this._internalState.posLastNumb[prefix]}`;
    }

    stop(data?: { message?: string }) {
        this._status = UserRobotStatus.stopping;
        this._message = data?.message || null;
        if (this.hasActivePositions)
            Object.keys(this._positions).forEach((key) => {
                this._positions[key].cancel();
                this._positions[key].executeJob();
            });
    }

    disable() {
        this._settings.active = false;
    }

    setStop() {
        this._status = UserRobotStatus.stopped;
        this._stoppedAt = dayjs.utc().toISOString();
        this._internalState = {};
    }

    pause(data?: { message?: string }) {
        this._status = UserRobotStatus.paused;
        this._message = data?.message || null;
    }

    handleSignal(signal: SignalEvent) {
        logger.info(`User Robot #${this._id} - Handling signal`, signal);
        if (signal.robotId !== this._robotId)
            throw new BaseError(
                "Wrong robot id",
                {
                    signal,
                    robotId: this._robotId,
                    userRobotId: this._id
                },
                "ERR_WRONG"
            );
        if (this._internalState.latestSignal && this._internalState.latestSignal.id === signal.id)
            throw new BaseError(
                "Signal already handled",
                {
                    signal,
                    userRobotId: this._id
                },
                "ERR_CONFLICT"
            );

        if (
            this._internalState.latestSignal &&
            !signal.positionParentId &&
            dayjs.utc(this._internalState.latestSignal.timestamp).valueOf() > dayjs.utc(signal.timestamp).valueOf()
        )
            throw new BaseError(
                "Wrong signal timestamp",
                {
                    signal,
                    latestSignal: this._internalState.latestSignal,
                    userRobotId: this._id
                },
                "ERR_CONFLICT"
            );

        if (signal.action === TradeAction.long || signal.action === TradeAction.short) {
            if (this._settings?.active === false) return;
            let hasPreviousActivePositions = false;

            if (signal.positionParentId) {
                const activeParents = Object.values(this._positions).filter(
                    (pos) =>
                        pos.isActive &&
                        pos.prefix === signal.positionPrefix &&
                        ((pos.direction === "long" && signal.action === TradeAction.short) ||
                            (pos.direction === "short" && signal.action === TradeAction.long))
                );
                for (const position of activeParents) {
                    position.handleSignal({
                        ...signal,
                        positionId: signal.positionParentId,
                        action: position.direction === "long" ? TradeAction.closeLong : TradeAction.closeShort
                    });
                    position.executeJob();
                }
            } else {
                const previousActivePositions = Object.values(this._positions).filter(
                    (pos) =>
                        pos.isActive &&
                        pos.prefix === signal.positionPrefix &&
                        ((pos.direction === "long" && signal.action === TradeAction.short) ||
                            (pos.direction === "short" && signal.action === TradeAction.long))
                );
                if (previousActivePositions?.length) {
                    hasPreviousActivePositions = true;
                    for (const position of previousActivePositions) {
                        position.cancel();
                        position.executeJob();
                    }
                }
            }

            const hasActivePositionWithSameDirection = Object.values(this._positions).filter(
                (pos) =>
                    pos.isActive &&
                    pos.prefix === signal.positionPrefix &&
                    pos.nextJob === null &&
                    ((pos.direction === "long" && signal.action === TradeAction.long) ||
                        (pos.direction === "short" && signal.action === TradeAction.short))
            );

            if (!hasActivePositionWithSameDirection.length) {
                const delay = hasPreviousActivePositions;

                const newPositionId = uuid();
                this._positions[newPositionId] = new UserPosition({
                    id: newPositionId,
                    prefix: signal.positionPrefix,
                    code: this._getNextPositionCode(signal.positionPrefix),
                    positionCode: signal.positionCode || null,
                    positionId: signal.positionId || null,
                    userRobotId: this._id,
                    userPortfolioId: this._userPortfolioId,
                    userId: this._userId,
                    exchange: this._exchange,
                    asset: this._asset,
                    currency: this._currency,
                    timeframe: this._timeframe,
                    status: delay ? UserPositionStatus.delayed : UserPositionStatus.new,
                    parentId: signal.positionParentId,
                    direction: signal.action === TradeAction.long ? "long" : "short",
                    userExAccId: this._userExAccId,
                    settings: this._settings,
                    tradeSettings: this._tradeSettings,
                    internalState: {
                        entrySlippageCount: 0,
                        exitSlippageCount: 0,
                        delayedSignal: delay && signal
                    }
                });

                if (!delay) {
                    this._positions[newPositionId].handleSignal(signal);
                    this._positions[newPositionId].executeJob();
                }
            }
        } else {
            const previousPositions = Object.values(this._positions).filter(
                (pos) =>
                    pos.prefix === signal.positionPrefix &&
                    pos.isActive &&
                    ((pos.direction === "long" && signal.action === TradeAction.closeLong) ||
                        (pos.direction === "short" && signal.action === TradeAction.closeShort))
            );

            for (const previousPosition of previousPositions) {
                previousPosition.handleSignal(signal);
                previousPosition.executeJob();
            }
        }

        this._internalState.latestSignal = signal;
    }

    handleDelayedPositions() {
        this.positions
            .filter((p) => p.status === UserPositionStatus.delayed)
            .forEach((pos) => {
                this._positions[pos.id].handleDelayedSignal();
                this._positions[pos.id].executeJob();
            });
    }

    handleOrder(order: OrdersStatusEvent | Order) {
        if (order.userRobotId !== this._id)
            throw new BaseError(
                "Wrong user robot id",
                {
                    order,
                    userRobotId: this._id
                },
                "ERR_WRONG"
            );

        const position = this._positions[order.userPositionId];
        if (!position)
            throw new BaseError(
                "Position not found",
                {
                    order,
                    userRobotId: this._id
                },
                "ERR_NOT_FOUND"
            );

        position.executeJob();
        if (!this.hasActivePositions) this.handleDelayedPositions();
    }

    clear() {
        for (const { id } of this.closedAndCanceledPositions) {
            delete this._positions[id];
        }
        this.positions.forEach((p) => {
            this._positions[p.id].clear();
        });
    }
}
