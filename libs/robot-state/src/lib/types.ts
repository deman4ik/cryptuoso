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
import { RobotSettings, StrategySettings } from "@cryptuoso/robot-settings";
import { IndicatorState } from "@cryptuoso/robot-indicators";
import { TradeStats } from "@cryptuoso/stats-calc";

export const enum RobotStatus {
    pending = "pending",
    starting = "starting",
    stopping = "stopping",
    started = "started",
    stopped = "stopped",
    paused = "paused",
    failed = "failed"
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
    volume?: number;
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
    settings: {
        strategySettings: StrategySettings;
        robotSettings: RobotSettings;
        activeFrom: string;
    };
    lastCandle?: DBCandle;
    state?: StrategyProps;
    hasAlerts?: boolean;
    status?: RobotStatus;
    startedAt?: string;
    stoppedAt?: string;
    backtest?: boolean;
}

export interface RobotStats extends TradeStats {
    robotId: string;
}
