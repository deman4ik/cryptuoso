export const enum UserRobotRunnerEvents {
    START = "in-user-robot-runner.start",
    STOP = "in-user-robot-runner.stop",
    PAUSE = "in-user-robot-runner.pause",
    RESUME = "in-user-robot-runner.resume"
}

const RunnerSchema = {
    userRobotId: "uuid",
    message: { type: "string", optional: true }
};

const RunnerPauseSchema = {
    userRobotId: { type: "uuid", optional: true },
    userExAccId: { type: "string", optional: true },
    message: { type: "string", optional: true }
};

export const UserRobotRunnerSchema = {
    [UserRobotRunnerEvents.START]: RunnerSchema,
    [UserRobotRunnerEvents.STOP]: RunnerSchema,
    [UserRobotRunnerEvents.PAUSE]: RunnerPauseSchema,
    [UserRobotRunnerEvents.RESUME]: RunnerPauseSchema
};
