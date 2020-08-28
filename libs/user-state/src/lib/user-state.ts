import { PositionDataForStats, RobotStats } from "@cryptuoso/trade-statistics";

export interface UserSignalPosition extends PositionDataForStats {
    entryDate: string;
    exchange?: string;
    asset?: string;
    currency?: string;
    userId?: string;
    userSignalVolume?: number;
    exitPrice: number;
    entryPrice: number;
    fee: number;
}

export interface RobotStatsWithExists extends RobotStats {
    statsExists: any;
}

export interface UserSignals {
    id: string;
    robotId?: string;
    userId?: string;
    subscribedAt?: string;
    volume?: number;
}

export interface UserAggrStats {
    id: string;
    userId: string;
    exchange?: string;
    asset?: string;
    type: "signal" | "userRobot";
}

export interface UserSignalsWithExists extends UserSignals, RobotStatsWithExists {}
export interface UserAggrStatsWithExists extends UserAggrStats, RobotStatsWithExists {}

export const enum UserRoles {
    admin = "admin",
    manager = "manager",
    vip = "vip",
    user = "user",
    anonymous = "anonymous"
}

export const enum UserStatus {
    blocked = -1,
    new = 0,
    enabled = 1
}

export interface UserRolesList {
    allowedRoles: UserRoles[];
    defaultRole: UserRoles;
}

export interface UserSettings {
    notifications: {
        signals: {
            telegram: boolean;
            email: boolean;
        };
        trading: {
            telegram: boolean;
            email: boolean;
        };
    };
}

export interface User {
    id: string;
    name?: string;
    email?: string;
    emailNew?: string;
    telegramId?: number;
    telegramUsername?: string;
    status: UserStatus;
    passwordHash?: string;
    passwordHashNew?: string;
    secretCode?: string;
    secretCodeExpireAt?: string;
    refreshToken?: string;
    refreshTokenExpireAt?: string;
    roles: UserRolesList;
    settings: UserSettings;
}
