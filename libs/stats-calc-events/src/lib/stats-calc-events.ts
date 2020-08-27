export const enum StatsCalcRunnerEvents {
    USER_SIGNAL = "in-stats-calc-runner.user-signal",
    USER_SIGNALS = "in-stats-calc-runner.user-signals",
    ROBOT = "in-stats-calc-runner.robot",
    ROBOTS = "in-stats-calc-runner.robots",
    USER_ROBOT = "in-stats-calc-runner.user-robot",
    USER_ROBOTS = "in-stats-calc-runner.user-robots"
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
};

export const enum StatsCalcJobType {
    robot = "robot",
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