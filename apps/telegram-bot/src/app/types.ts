import { BaseUser } from "@cryptuoso/user-state";

export const enum TelegramScene {
    SIGNALS = "signals",
    SEARCH_SIGNALS = "searchSignals",
    MY_SIGNALS = "mySignals",
    TOP_SIGNALS = "topSignals",
    ROBOT_SIGNAL = "robotSignal",
    SUBSCRIBE_SIGNALS = "subscribeSignals",
    PERFORMANCE_SIGNALS = "perfSignals",
    ROBOTS = "robots",
    SEARCH_ROBOTS = "searchRobots",
    MY_ROBOTS = "myRobots",
    TOP_ROBOTS = "topRobots",
    USER_ROBOT = "userRobot",
    ADD_USER_ROBOT = "addUserRobot",
    START_USER_ROBOT = "startUserRobot",
    STOP_USER_ROBOT = "stopUserRobot",
    EDIT_USER_ROBOT = "editUserRobot",
    DELETE_USER_ROBOT = "deleteUserRobot",
    PERFORMANCE_ROBOTS = "perfRobots",
    SETTINGS = "settings",
    USER_EXCHANGE_ACCS = "userExAccs",
    USER_EXCHANGE_ACC = "userExAcc",
    ADD_USER_EX_ACC = "addUserExAcc",
    EDIT_USER_EX_ACC = "editUserExAcc",
    SUPPORT = "support",
    REGISTRATION = "registration"
}

export interface TelegramUser extends BaseUser {
    name?: string;
    email?: string;
    emailNew?: string;
    telegramId?: number;
    telegramUsername?: string;
    secretCode?: string;
    secretCodeExpireAt?: string;
}
