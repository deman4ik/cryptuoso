import {
    AlertInfo,
    BasePosition,
    Candle,
    ExchangeCandle,
    ExchangePrice,
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
    barsHeld?: number;
    backtest?: boolean;
    internalState?: RobotPostionInternalState;
}

export interface RobotState {
    id: string;
    exchange: string;
    asset: string;
    currency: string;
    timeframe: ValidTimeframe;
    strategy: string;
    settings: {
        strategySettings: StrategySettings;
        robotSettings: RobotSettings;
        activeFrom: string;
    };
    lastCandle?: Candle;
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

export const enum RobotJobType {
    stop = "stop",
    candle = "candle",
    tick = "tick"
}

export interface RobotJob {
    id?: string;
    robotId: string;
    type: RobotJobType;
    data?: ExchangeCandle | ExchangePrice | { robotId: string };
    retries?: number;
    error?: string;
}

export const enum Queues {
    robot = "robot",
    robotRunner = "robot-runner"
}

export const enum RobotRunnerJobType {
    alerts = "alerts",
    newCandles = "newCandles",
    idleCandles = "idleCandles",
    idleRobotJobs = "idleRobotJobs"
}
