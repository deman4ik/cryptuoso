import { UserPosition } from "./userPosition";
import { v4 as uuid } from "uuid";
import dayjs from "@cryptuoso/dayjs";
import {
    TradeSettings,
    UserPositionState,
    UserPositionStatus,
    UserRobotCurrentSettings,
    UserRobotInternalState,
    UserRobotState,
    UserRobotStatus
} from "./types";
import { Order, PositionDirection, SignalEvent, TradeAction, ValidTimeframe } from "@cryptuoso/market";
import { flattenArray, GenericObject } from "@cryptuoso/helpers";
import { NewEvent } from "@cryptuoso/events";
import { BaseError } from "@cryptuoso/errors";

class UserRobot {
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
    _eventsToSend: NewEvent<any>[];
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
        this._eventsToSend = [];
    }

    get id() {
        return this._id;
    }

    get status() {
        return this._status;
    }

    get state() {
        const positions = Object.values(this._positions);
        return {
            userRobot: {
                id: this._id,
                userExAccId: this._userExAccId,
                userId: this._userId,
                robotId: this._robotId,
                settings: this._settings,
                internalState: this._internalState,
                status: this._status,
                startedAt: this._startedAt,
                stoppedAt: this._stoppedAt
            },
            positions: positions.map((pos) => pos.state),
            ordersToCreate: flattenArray(positions.map((pos) => pos.ordersToCreate)),
            connectorJobs: flattenArray(positions.map((pos) => pos.connectorJobs)),
            recentTrades: positions.filter((pos) => pos.hasRecentTrade).map((pos) => pos.tradeEvent),
            eventsToSend: this._eventsToSend
        };
    }

    get positions() {
        return Object.values(this._positions).map((pos) => pos.state);
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

    _setPositions(positions: UserPositionState[]) {
        if (positions && Array.isArray(positions) && positions.length > 0) {
            positions.forEach((position) => {
                this._positions[position.positionId] = new UserPosition({
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
        if (Object.prototype.hasOwnProperty.call(this._internalState.posLastNumb, prefix)) {
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
        /*  this._eventsToSend.push({
            type: Event.USER_ROBOT_STOPPED,
            data: {
                userRobotId: this._id,
                message: this._message
            }
        }); */
    }

    pause({ message }: { message?: string } = { message: null }) {
        this._status = UserRobotStatus.paused;
        this._message = message || null;
        /*   this._eventsToSend.push({
            type: Event.USER_ROBOT_PAUSED,
            data: {
                userRobotId: this._id,
                message: this._message
            }
        }); */
    }

    _cancelPreviousParentPositions(parentId: string) {
        if (this._positions[parentId] && this._positions[parentId].isActive) {
            if (this._positions[parentId].status === UserPositionStatus.delayed) {
                this._positions[parentId].cancel();
                this._positions[parentId].executeJob();
            }
            const previousParentId = this._positions[parentId].parentId;
            if (previousParentId && this._positions[previousParentId] && this._positions[previousParentId].isActive) {
                this._positions[previousParentId].cancel();
                this._positions[previousParentId].executeJob();
                if (this._positions[previousParentId].parentId) {
                    this._cancelPreviousParentPositions(this._positions[previousParentId].parentId);
                }
            }
        }
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
        if (this._internalState.latestSignal && this._internalState.latestSignal.id === signal.id) {
            throw new BaseError(
                "Signal already handled",
                {
                    signal,
                    userRobotId: this._id
                },
                "ERR_CONFLICT"
            );
        }

        if (signal.action === TradeAction.long || signal.action === TradeAction.short) {
            const hasActiveParent =
                signal.positionParentId &&
                this._positions[signal.positionParentId] &&
                this._positions[signal.positionParentId].isActive;
            let hasPreviousActivePositions = false;
            if (hasActiveParent) {
                this._positions[signal.positionParentId].handleSignal({
                    ...signal,
                    positionId: signal.positionParentId,
                    action:
                        this._positions[signal.positionParentId].direction === PositionDirection.long
                            ? TradeAction.closeLong
                            : TradeAction.closeShort
                });
                this._positions[signal.positionParentId].executeJob();
            } else {
                const previousActivePositions = Object.values(this._positions).filter(
                    (pos) =>
                        pos.isActive &&
                        pos.prefix === signal.positionPrefix &&
                        pos.positionNumber < +signal.positionCode.split(`${signal.positionPrefix}_`)[1]
                );
                if (
                    previousActivePositions &&
                    Array.isArray(previousActivePositions) &&
                    previousActivePositions.length > 0
                ) {
                    hasPreviousActivePositions = true;
                    previousActivePositions.forEach((p) => {
                        this._positions[p.positionId].cancel();
                        this._positions[p.positionId].executeJob();
                    });
                }
            }

            const delay = hasPreviousActivePositions;

            this._positions[signal.positionId] = new UserPosition({
                id: uuid(),
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
                direction: signal.action === TradeAction.long ? PositionDirection.long : PositionDirection.short,
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
                this._positions[signal.positionId].handleSignal(signal);
                this._positions[signal.positionId].executeJob();
            }
        } else {
            if (!this._positions[signal.positionId]) {
                const previousPositions = Object.values(this._positions).filter(
                    (pos) =>
                        pos.isActive &&
                        pos.prefix === signal.positionPrefix &&
                        /*  pos.positionNumber <
              +signal.positionCode.split(`${signal.positionPrefix}_`)[1] && */
                        ((pos.direction === PositionDirection.long && signal.action === TradeAction.closeLong) ||
                            (pos.direction === PositionDirection.short && signal.action === TradeAction.closeShort))
                );

                if (previousPositions && Array.isArray(previousPositions) && previousPositions.length > 0) {
                    const [previousPosition] = previousPositions;
                    this._positions[previousPosition.positionId].handleSignal(signal);
                    this._positions[previousPosition.positionId].executeJob();
                }
            } else {
                if (this._positions[signal.positionId].isActive && !this._positions[signal.positionId].exitStatus) {
                    this._positions[signal.positionId].handleSignal(signal);
                    this._positions[signal.positionId].executeJob();
                }
            }
        }

        this._internalState.latestSignal = signal;
    }

    handleDelayedPositions() {
        this.positions
            .filter((p) => p.status === UserPositionStatus.delayed)
            .forEach((pos) => {
                if (
                    !this._positions[pos.parentId] ||
                    (this._positions[pos.parentId] && !this._positions[pos.parentId].isActive)
                ) {
                    this._positions[pos.positionId].handleDelayedSignal();
                    this._positions[pos.positionId].executeJob();
                }
            });
    }

    handleOrder(order: Order) {
        if (order.userRobotId !== this._id)
            throw new BaseError(
                "Wrong user robot id",
                {
                    order,
                    userRobotId: this._id
                },
                "ERR_WRONG"
            );

        if (!this._positions[order.positionId])
            throw new BaseError(
                "Position not found",
                {
                    order,
                    userRobotId: this._id
                },
                "ERR_NOT_FOUND"
            );

        // this._positions[order.positionId].handleOrder(order);
        this._positions[order.positionId].executeJob();
        this.handleDelayedPositions();
    }
}

export = UserRobot;
