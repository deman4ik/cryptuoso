export interface GenericObject<T> {
    [key: string]: T;
}

declare namespace UserState {
    const enum TimeUnit {
        second = "second",
        minute = "minute",
        hour = "hour",
        day = "day"
    }

    const enum UserRoles {
        admin = "admin",
        manager = "manager",
        vip = "vip",
        user = "user",
        anonymous = "anonymous"
    }

    const enum UserStatus {
        blocked = -1,
        new = 0,
        enabled = 1
    }

    interface UserRolesList {
        allowedRoles: UserState.UserRoles[];
        defaultRole: UserState.UserRoles;
    }

    interface UserSettings {
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

    interface User {
        id: string;
        name?: string;
        email?: string;
        emailNew?: string;
        telegramId?: number;
        telegramUsername?: string;
        status: UserState.UserStatus;
        passwordHash?: string;
        passwordHashNew?: string;
        secretCode?: string;
        secretCodeExpireAt?: string;
        refreshToken?: string;
        refreshTokenExpireAt?: string;
        roles: UserState.UserRolesList;
        settings: UserState.UserSettings;
    }
}