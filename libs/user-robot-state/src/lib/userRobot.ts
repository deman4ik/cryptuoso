import { UserPosition } from "./userPosition";
import { v4 as uuid } from "uuid";
import dayjs from "@cryptuoso/dayjs";
import {
    UserPositionDB,
    UserPositionState,
    UserPositionStatus,
    UserRobotCurrentSettings,
    UserRobotDB,
    UserRobotInternalState,
    UserRobotState,
    UserRobotStatus,
    UserTradeEvent
} from "./types";
import { Order, PositionDirection, SignalEvent, TradeAction, TradeSettings, ValidTimeframe } from "@cryptuoso/market";
import { flattenArray, GenericObject } from "@cryptuoso/helpers";
import { OrdersStatusEvent } from "@cryptuoso/connector-events";
import { BaseError } from "@cryptuoso/errors";
import { ConnectorJob } from "@cryptuoso/connector-state";

export class UserRobot {
    _id: string;
    _userExAccId: string;
    _userId: string;
    _robotId: string;
    _settings: UserRobotCurrentSettings;
    _internalState: UserRobotInternalState;
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

    constructor(state: UserRobotState) {
        this._id = state.id;
        this._userExAccId = state.userExAccId;
        this._userId = state.userId;
        this._robotId = state.robotId;
        this._settings = state.settings;
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
        this._positions = {}; // key -> positionId not id
        this._setPositions(state.positions);
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
            internalState: this._internalState,
            status: this._status,
            startedAt: this._startedAt,
            stoppedAt: this._stoppedAt,
            message: this._message
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

    get hasActivePositions() {
        return (
            this.positions.filter(
                (pos) => pos.status === UserPositionStatus.new || pos.status === UserPositionStatus.open
            ).length > 0
        );
    }

    get hasCanceledPositions() {
        return this.positions.filter((pos) => pos.status === UserPositionStatus.canceled).length > 0;
    }

    get hasClosedPositions() {
        return (
            this.positions.filter(
                (pos) => pos.status === UserPositionStatus.closed || pos.status === UserPositionStatus.closedAuto
            ).length > 0
        );
    }

    get connectorJobs(): ConnectorJob[] {
        return flattenArray(Object.values(this._positions).map((pos) => pos.connectorJobs));
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

    stop({ message }: { message?: string } = { message: null }) {
        this._status = UserRobotStatus.stopping;
        this._message = message || null;
        if (this.hasActivePositions)
            Object.keys(this._positions).forEach((key) => {
                this._positions[key].cancel();
                this._positions[key].executeJob();
            });
        else this.setStop();
    }

    setStop() {
        this._status = UserRobotStatus.stopped;
        this._stoppedAt = dayjs.utc().toISOString();
    }

    pause({ message }: { message?: string } = { message: null }) {
        this._status = UserRobotStatus.paused;
        this._message = message || null;
    }

    handleSignal(signal: SignalEvent) {
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
                    positionCode: signal.positionCode,
                    positionId: signal.positionId,
                    userRobotId: this._id,
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

    handleOrder(order: OrdersStatusEvent) {
        if (order.userRobotId !== this._id)
            throw new BaseError(
                "Wrong user robot id",
                {
                    order,
                    userRobotId: this._id
                },
                "ERR_WRONG"
            );

        const position = this._positions[order.userPositionId] || this._positions[order.positionId]; //TODO: remove positionId option
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
        this.handleDelayedPositions();
    }
}
