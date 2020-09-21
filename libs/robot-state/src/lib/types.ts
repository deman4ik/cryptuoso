import {
    AlertInfo,
    BasePosition,
    DBCandle,
    OrderType,
    PositionDirection,
    RobotPositionStatus,
    RobotTradeStatus,
    TradeAction,
    ValidTimeframe
} from "@cryptuoso/market";
import { IndicatorState } from "@cryptuoso/robot-indicators";

export const enum RobotStatus {
    pending = "pending",
    starting = "starting",
    stopping = "stopping",
    started = "started",
    stopped = "stopped",
    paused = "paused",
    failed = "failed"
}

export interface RobotTradeSettings {
    orderTimeout: number;
    slippage?: {
        entry?: {
            stepPercent: number;
            count?: number;
        };
        exit?: {
            stepPercent: number;
            count?: number;
        };
    };
    deviation?: {
        entry?: number;
        exit?: number;
    };
}

export interface StrategySettings {
    [key: string]: number | string;
}

export interface RobotSettings {
    volume: number;
    requiredHistoryMaxBars: number;
}

export interface StrategyProps {
    initialized: boolean;
    posLastNumb: { [key: string]: number };
    positions: RobotPositionState[];
    indicators: {
        [key: string]: IndicatorState;
    };
    variables: { [key: string]: any };
}

export interface RobotPostionInternalState {
    [key: string]: any;
    highestHigh?: number;
    lowestLow?: number;
    stop?: number;
}

export interface RobotPositionState extends BasePosition {
    robotId: string;
    volume: number;
    parentId?: string;
    direction?: PositionDirection;
    status?: RobotPositionStatus;
    entryStatus?: RobotTradeStatus;
    entryPrice?: number;
    entryDate?: string;
    entryOrderType?: OrderType;
    entryAction?: TradeAction;
    entryCandleTimestamp?: string;
    exitStatus?: RobotTradeStatus;
    exitPrice?: number;
    exitDate?: string;
    exitOrderType?: OrderType;
    exitAction?: TradeAction;
    exitCandleTimestamp?: string;
    alerts?: { [key: string]: AlertInfo };
    profit?: number;
    barsHeld?: number;
    fee?: number;
    backtest?: boolean;
    internalState?: RobotPostionInternalState;
}

export interface RobotState {
    id: string;
    code?: string;
    mod?: string;
    name?: string;
    exchange: string;
    asset: string;
    currency: string;
    timeframe: ValidTimeframe;
    available?: number;
    strategyName: string;
    strategySettings: StrategySettings;
    robotSettings: RobotSettings;
    tradeSettings?: RobotTradeSettings;
    lastCandle?: DBCandle;
    state?: StrategyProps;
    hasAlerts?: boolean;
    status?: RobotStatus;
    startedAt?: string;
    stoppedAt?: string;
    backtest?: boolean;
}
