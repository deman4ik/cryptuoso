import { TradeStatsJob } from "@cryptuoso/trade-stats";

export const TRADE_STATS_TOPIC = "in-trade-stats-runner";

export const enum TradeStatsRunnerEvents {
    ROBOT = `stats-calc.robot`,
    PORTFOLIO = `stats-calc.portfolio`,
    PORTFOLIO_ROBOT = `stats-calc.portfolio-robot`,
    USER_ROBOT = `stats-calc.user-robot`,
    USER_PORTFOLIO = `stats-calc.user-portfolio`,
    SIGNAL_SUBSCRIPTION = `stats-calc.signal-subscription`,
    RECALC_ALL_ROBOTS = `stats-calc.recalc-all-robots`,
    RECALC_ALL_PORTFOLIOS = `stats-calc.recalc-all-portfolios`,
    RECALC_ALL_USER_ROBOTS = `stats-calc.recalc-all-user-robots`,
    RECALC_ALL_USER_PORTFOLIOS = `stats-calc.recalc-all-user-portfolios`,
    RECALC_ALL_SIGNAL_SUBSCRIPTIONS = `stats-calc.recalc-all-signal-subscriptions`
}

export const OUR_TRADE_STATS_TOPIC = "out-trade-stats-worker";

export const enum TradeStatsWorkerEvents {
    ERROR = `out-trade-stats-worker.error`
}

export const TradeStatsRunnerSchema = {
    [TradeStatsRunnerEvents.ROBOT]: {
        recalc: {
            type: "boolean",
            optional: true,
            default: false
        },
        robotId: {
            type: "uuid"
        }
    },
    [TradeStatsRunnerEvents.PORTFOLIO]: {
        recalc: {
            type: "boolean",
            optional: true,
            default: false
        },
        savePositions: {
            type: "boolean",
            optional: true,
            default: false
        },
        portfolioId: {
            type: "uuid"
        }
    },
    [TradeStatsRunnerEvents.PORTFOLIO_ROBOT]: {
        recalc: {
            type: "boolean",
            optional: true,
            default: false
        },
        robotId: {
            type: "uuid"
        }
    },
    [TradeStatsRunnerEvents.USER_ROBOT]: {
        recalc: {
            type: "boolean",
            optional: true,
            default: false
        },
        userRobotId: {
            type: "uuid"
        }
    },
    [TradeStatsRunnerEvents.USER_PORTFOLIO]: {
        recalc: {
            type: "boolean",
            optional: true,
            default: false
        },
        userPortfolioId: {
            type: "uuid"
        }
    },
    [TradeStatsRunnerEvents.SIGNAL_SUBSCRIPTION]: {
        recalc: {
            type: "boolean",
            optional: true,
            default: false
        },
        signalSubscriptionId: {
            type: "uuid"
        }
    },
    [TradeStatsRunnerEvents.RECALC_ALL_ROBOTS]: {
        exchange: {
            type: "string",
            optional: true,
            default: null as string
        },
        asset: {
            type: "string",
            optional: true,
            default: null as string
        }
    },
    [TradeStatsRunnerEvents.RECALC_ALL_PORTFOLIOS]: {
        exchange: {
            type: "string",
            optional: true,
            default: null as string
        },
        savePositions: {
            type: "boolean",
            optional: true,
            default: false
        }
    },
    [TradeStatsRunnerEvents.RECALC_ALL_USER_ROBOTS]: {
        exchange: {
            type: "string",
            optional: true,
            default: null as string
        },
        asset: {
            type: "string",
            optional: true,
            default: null as string
        },
        userId: {
            type: "uuid",
            optional: true,
            default: null as string
        }
    },
    [TradeStatsRunnerEvents.RECALC_ALL_USER_PORTFOLIOS]: {
        exchange: {
            type: "string",
            optional: true,
            default: null as string
        },
        userId: {
            type: "uuid",
            optional: true,
            default: null as string
        }
    },
    [TradeStatsRunnerEvents.RECALC_ALL_SIGNAL_SUBSCRIPTIONS]: {
        exchange: {
            type: "string",
            optional: true,
            default: null as string
        }
    }
};

export interface TradeStatsRunnerRobot {
    recalc?: boolean;
    robotId: string;
}

export interface TradeStatsRunnerPortfolio {
    recalc?: boolean;
    portfolioId: string;
    savePositions?: boolean;
}

export type TradeStatsRunnerPortfolioRobot = TradeStatsRunnerRobot;

export interface TradeStatsRunnerUserRobot {
    recalc?: boolean;
    userRobotId: string;
    userPortfolioId: string;
}

export interface TradeStatsRunnerUserPortfolio {
    recalc?: boolean;
    userPortfolioId: string;
}

export interface TradeStatsRunnerSignalSubscription {
    recalc?: boolean;
    signalSubscriptionId: string;
}

export interface TradeStatsRunnerRecalcAllRobots {
    exchange?: string;
    asset?: string;
}

export interface TradeStatsRunnerRecalcAllPortfolios {
    exchange?: string;
    savePositions?: boolean;
}

export interface TradeStatsRunnerRecalcAllUserRobots {
    exchange?: string;
    asset?: string;
    userId?: string;
}

export interface TradeStatsRunnerRecalcAllUserPortfolios {
    exchange?: string;
    userId?: string;
}

export interface TradeStatsRunnerRecalcAllSignalSubscriptions {
    exchange?: string;
}

export type TradeStatsRunnerEvent =
    | TradeStatsRunnerRobot
    | TradeStatsRunnerPortfolio
    | TradeStatsRunnerUserRobot
    | TradeStatsRunnerUserPortfolio
    | TradeStatsRunnerSignalSubscription
    | TradeStatsRunnerRecalcAllRobots
    | TradeStatsRunnerRecalcAllPortfolios
    | TradeStatsRunnerRecalcAllUserRobots
    | TradeStatsRunnerRecalcAllUserPortfolios
    | TradeStatsRunnerRecalcAllSignalSubscriptions;

export interface TradeStatsWorkerErrorEvent {
    job: TradeStatsJob;
    error: string;
    timestamp: string;
}
