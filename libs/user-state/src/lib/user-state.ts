export enum UserAggrStatsTypes {
    signal = "signal",
    userRobot = "userRobot"
}

export const enum UserRoles {
    admin = "admin",
    manager = "manager",
    vip = "vip",
    user = "user",
    anonymous = "anonymous"
}

export const enum UserAccessValues {
    admin = 5,
    manager = 5,
    vip = 10,
    user = 15,
    anonymous = 20
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
        news: {
            telegram: boolean;
            email: boolean;
        };
    };
}

export interface BaseUser {
    id: string;
    status: UserStatus;
    roles: UserRolesList;
    access: UserAccessValues;
    settings: UserSettings;
    lastActiveAt: string;
}
export interface User extends BaseUser {
    name?: string;
    email?: string;
    emailNew?: string;
    telegramId?: string;
    telegramUsername?: string;
    passwordHash?: string;
    passwordHashNew?: string;
    secretCode?: string;
    secretCodeExpireAt?: string;
    refreshToken?: string;
    refreshTokenExpireAt?: string;
    createdAt?: string;
}

export interface Notification<T> {
    id?: string;
    userId: string;
    timestamp: string;
    type: string;
    data: T;
    sendTelegram: boolean;
    sendEmail: boolean;
    readed?: boolean;
}
