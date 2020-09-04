export const enum StatsCalcRunnerEvents {
    USER_SIGNAL = "stats-calc.user-signal", // "in-stats-calc-runner.user-signal",
    USER_SIGNALS = "stats-calc.user-signals", // "in-stats-calc-runner.user-signals",
    ROBOT = "stats-calc.robot", // "in-stats-calc-runner.robot",
    ROBOTS = "stats-calc.robots", // "in-stats-calc-runner.robots",
    USER_ROBOT = "stats-calc.user-robot", // "in-stats-calc-runner.user-robot",
    USER_ROBOTS = "stats-calc.user-robots", // "in-stats-calc-runner.user-robots"
    RECALC_ALL_ROBOTS = "stats-calc.recalc-all-robots",
    RECALC_ALL_USER_SIGNALS = "stats-calc.recalc-all-user-signals",
    RECALC_ALL_USER_ROBOTS = "stats-calc.recalc-all-user-robots"
}

export const StatsCalcRunnerSchema = {
    [StatsCalcRunnerEvents.USER_SIGNAL]: {
        calcAll: {
            type: "boolean",
            optional: true,
            default: false
        },
        userId: {
            type: "uuid"
        },
        robotId: {
            type: "uuid"
        }
    },
    [StatsCalcRunnerEvents.USER_SIGNALS]: {
        calcAll: {
            type: "boolean",
            optional: true,
            default: false
        },
        userId: {
            type: "uuid"
        }
    },
    [StatsCalcRunnerEvents.ROBOT]: {
        calcAll: {
            type: "boolean",
            optional: true,
            default: false
        },
        robotId: {
            type: "uuid"
        }
    },
    [StatsCalcRunnerEvents.ROBOTS]: {
        calcAll: {
            type: "boolean",
            optional: true,
            default: false
        }
    },
    [StatsCalcRunnerEvents.USER_ROBOT]: {
        calcAll: {
            type: "boolean",
            optional: true,
            default: false
        },
        userRobotId: {
            type: "uuid"
        }
    },
    [StatsCalcRunnerEvents.USER_ROBOTS]: {
        calcAll: {
            type: "boolean",
            optional: true,
            default: false
        },
        userId: {
            type: "uuid"
        },
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
    [StatsCalcRunnerEvents.RECALC_ALL_ROBOTS]: {
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
        currency: {
            type: "string",
            optional: true,
            default: null as string
        },
        strategy: {
            type: "string",
            optional: true,
            default: null as string
        }
    },
    [StatsCalcRunnerEvents.RECALC_ALL_USER_SIGNALS]: {
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
        currency: {
            type: "string",
            optional: true,
            default: null as string
        },
        strategy: {
            type: "string",
            optional: true,
            default: null as string
        },
        userId: {
            type: "uuid",
            optional: true,
            default: null as string
        },
        robotId: {
            type: "uuid",
            optional: true,
            default: null as string
        }
    },
    [StatsCalcRunnerEvents.RECALC_ALL_USER_ROBOTS]: {
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
        currency: {
            type: "string",
            optional: true,
            default: null as string
        },
        strategy: {
            type: "string",
            optional: true,
            default: null as string
        },
        userId: {
            type: "uuid",
            optional: true,
            default: null as string
        },
        robotId: {
            type: "uuid",
            optional: true,
            default: null as string
        }
    }
};

export const enum StatsCalcJobType {
    robot = "robot",
    robotsAggr = "robotsAggr",
    usersRobotsAggr = "usersRobotsAggr",
    userSignal = "userSignal",
    userSignals = "userSignals",
    userRobot = "userRobot",
    userSignalsAggr = "userSignalsAggr",
    userRobotAggr = "userRobotAggr"
}

export interface StatsCalcJob {
    calcAll?: boolean;
    robotId?: string;
    userRobotId?: string;
    userId?: string;
    exchange?: string;
    asset?: string;
}
