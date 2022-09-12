import {
    AlertInfo,
    BasePosition,
    Candle,
    OrderType,
    PositionDirection,
    RobotPositionStatus,
    RobotTradeStatus,
    TradeAction,
    ValidTimeframe
} from "@cryptuoso/market";
import { RobotSettings, StrategySettings } from "@cryptuoso/robot-settings";

import { BaseStats, FullStats, PeriodStats } from "@cryptuoso/trade-stats";

export const enum RobotStatus {
    starting = "starting",
    started = "started",
    stopping = "stopping",
    stopped = "stopped"
}

export type RobotStatusCommand = "start" | "restart" | "stop";

export interface IndicatorCode {
    [key: string]: any;
    init(): void;
    calc(): void;
}

export const enum IndicatorType {
    base = "base",
    rs = "rs"
}

export interface IndicatorState {
    [key: string]: any;
    name: string;
    indicatorName: string;
    initialized?: boolean;
    parameters?: { [key: string]: number | string };
    variables?: { [key: string]: any };
    indicatorFunctions?: { [key: string]: () => any };
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
        feeRate?: number;
    };
    lastCandle?: Candle;
    state?: StrategyProps;
    hasAlerts?: boolean;
    status?: RobotStatus;
    startedAt?: string;
    stoppedAt?: string;
    backtest?: boolean;
    fullStats?: FullStats;
    periodStats?: PeriodStats<BaseStats>[];
    emulatedFullStats?: FullStats;
    emulatedPeriodStats?: PeriodStats<BaseStats>[];
}
