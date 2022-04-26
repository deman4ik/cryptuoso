import { BasePosition, OrderType, PositionDirection, SignalEvent, TradeAction } from "@cryptuoso/market";
import { BaseStats, FullStats, PerformanceVals, PeriodStats } from "@cryptuoso/trade-stats";

export interface PortfolioOptions {
    // diversification: boolean;
    profit: boolean;
    risk: boolean;
    moneyManagement: boolean;
    winRate: boolean;
    efficiency: boolean;
}

export type PortfolioOptionWeights = { [Weight in keyof PortfolioOptions]: number };

export interface PortfolioSettings {
    options: PortfolioOptions;
    optionWeights?: PortfolioOptionWeights;
    tradingAmountType?: "currencyFixed" | "balancePercent";
    balancePercent?: number;
    tradingAmountCurrency?: number;
    initialBalance: number;
    leverage: number;
    feeRate?: number;
    maxRobotsCount?: number;
    minRobotsCount?: number;
    includeTimeframes?: number[];
    excludeTimeframes?: number[];
    includeAssets?: string[];
    excludeAssets?: string[];
    includeRobots?: string[];
    excludeRobots?: string[];
    custom?: boolean;
    robotsShare?: {
        [key: string]: number;
    };
    dateFrom?: string;
    dateTo?: string;
}

export interface PortfolioDB {
    id: string;
    code: string;
    name?: string;
    exchange: string;
    available: number;
    status: "started" | "stopped";
    settings: PortfolioSettings;
    fullStats?: FullStats;
    periodStats?: PeriodStats<BaseStats>[];
    base: boolean;
}

export interface PortfolioRobotDB {
    robotId: string;
    active: boolean;
    share: number;
    priority: number;
}
export interface PortfolioRobot extends PortfolioRobotDB {
    amountInCurrency?: number;
}

export interface PortfolioContext {
    minTradeAmount: number;
    feeRate: number;
    currentBalance: number;
    minBalance?: number;
    robotsCount?: number;
}

export interface PortfolioState extends PortfolioDB {
    context: PortfolioContext;
    variables?: {
        portfolioBalance: number;
        minBalance: number;
        maxRobotsCount: number;
        minRobotsCount: number;
    };
    robots?: PortfolioRobot[];
    positions?: BasePosition[];
}

export interface PortfolioInfo {
    code: string;
    exchange: string;
    stats: {
        currentBalance: number;
        netProfit: number;
        percentNetProfit: number;
        winRate: number;
        maxDrawdown: number;
        maxDrawdownDate: string;
        payoffRatio: number;
        sharpeRatio: number;
        recoveyFactor: number;
        avgTradesCount: number;
        equityAvg: PerformanceVals;
        firstPosition: {
            entryDate: string;
        };
    };
    limits: {
        minBalance: number;
        recommendedBalance: number;
    };
    settings: PortfolioSettings;
}

export interface PortfolioBuilderJob {
    portfolioId: string;
    type: "portfolio";
    saveSteps?: boolean;
    dateFrom?: string;
}

export interface UserPortfolioBuilderJob {
    userPortfolioId: string;
    type: "userPortfolio";
}

export interface UserPortfolioDB {
    id: string;
    userId: string;
    userExAccId?: string;
    exchange: string;
    allocation: "shared" | "dedicated";
    status: "starting" | "started" | "stopping" | "stopped" | "error" | "buildError";
    startedAt?: string;
    stoppedAt?: string;
    message?: string;
    fullStats?: FullStats;
    periodStats?: PeriodStats<BaseStats>[];
}

export interface UserPortfolioState extends UserPortfolioDB {
    userPortfolioSettingsId?: string;
    userPortfolioSettingsActiveFrom?: string;
    settings: PortfolioSettings;
    context: PortfolioContext;
    variables?: {
        portfolioBalance: number;
        minBalance: number;
        maxRobotsCount: number;
        minRobotsCount: number;
    };
    robots?: PortfolioRobotDB[];
    currentExchangeBalance?: number;
}

export interface OpenPosition {
    id: string;
    direction: PositionDirection;
    entryAction: TradeAction;
    entryPrice: number;
    entryDate: string;
    volume: number;
    profit: number;
}

export interface ClosedPosition extends OpenPosition {
    exitAction: TradeAction;
    exitPrice: number;
    exitDate: string;
    barsHeld: number;
}

export interface UserPortfolioInfo {
    id: UserPortfolioDB["id"];
    userExAccId?: UserPortfolioDB["userExAccId"];
    exchange: UserPortfolioDB["exchange"];
    status: UserPortfolioDB["status"];
    startedAt?: UserPortfolioDB["startedAt"];
    stoppedAt?: UserPortfolioDB["stoppedAt"];
    settings?: PortfolioSettings;
    activeFrom?: string;
    nextSettings?: PortfolioSettings;
    stats?: FullStats;
    unrealizedProfit?: number;
    openTradesCount?: number;
    lastInfoUpdatedAt?: string;
    openPositions: OpenPosition[];
    closedPositions: ClosedPosition[];
}

export interface SignalSubscriptionDB {
    id: string;
    userId?: string;
    exchange: string;
    type: "zignaly" | "telegram";
    status: "started" | "stopped" | "stopping";
    fullStats?: FullStats;
    periodStats?: PeriodStats<BaseStats>[];
    url?: string;
    token?: string;
}

export interface SignalSubscriptionState extends SignalSubscriptionDB {
    settings: PortfolioSettings;
    robots?: PortfolioRobotDB[];
}

export interface SignalRobotDB {
    id: string;
    signalSubscriptionId: string;
    robotId: string;
    active: boolean;
    share: number;
    state?: {
        latestSignal?: SignalEvent;
    };
}

export interface SignalSubscriptionPosition {
    id: string;
    signalSubscriptionId: string;
    subscriptionRobotId: string;
    robotId: string;
    exchange: string;
    asset: string;
    currency: string;
    direction: PositionDirection;
    entryPrice: number;
    entryDate: string;
    entryAction: TradeAction;
    entryOrderType: OrderType;
    exitPrice?: number;
    exitDate?: string;
    exitAction?: TradeAction;
    exitOrderType?: OrderType;
    leverage?: number;
    volume?: number;
    status?: "open" | "canceled" | "closed" | "closedAuto";
    profit?: number;
    profitPercent?: number;
    providerPositionId?: string;
    share?: number;
    error?: string;
}
