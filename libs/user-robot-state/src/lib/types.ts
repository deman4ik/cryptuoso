import { RobotStatus } from "@cryptuoso/robot-state";

// TODO: typing or delete
export interface UserRobotSettings {
    volume: number;
    kraken?: {
        leverage?: number;
    };
}

export interface UserRobotDB {
    id: string;
    userExAccId: string;
    userId: string;
    robotId: string;
    settings: UserRobotSettings;
    //internalState: UserRobotInternalState;
    status: RobotStatus;
    startedAt?: string;
    stoppedAt?: string;
    //statistics?: RobotStats;
    //equity?: RobotEquity;
    message?: string;
}

export interface UserRobotState {
    id: string;
}