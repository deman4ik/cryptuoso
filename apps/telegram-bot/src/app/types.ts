import { PositionDirection, TradeAction, TradeInfo, ValidTimeframe } from "@cryptuoso/market";
import { RobotSettings, UserRobotSettings, UserSignalSettings } from "@cryptuoso/robot-settings";
import { BaseStatistics } from "@cryptuoso/stats-calc";
import { UserRobotStatus } from "@cryptuoso/user-robot-state";
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
    START = "start",
    REGISTRATION = "registration",
    LOGIN = "login"
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

export interface CommonStats {
    netProfit: number;
    winRate: number;
    maxDrawdown: number;
    tradesCount: number;
}

export interface OpenPosition {
    id: string;
    code: string;
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

export interface ActiveSignal extends TradeInfo {
    code: string;
    timestamp: string;
}

export interface UserSignal {
    id: string;
    subscribedAt: string;
    settings: {
        currentSettings: UserSignalSettings;
    };
    stats: BaseStatistics;
    openPositions: OpenPosition[];
    closedPositions: ClosedPosition[];
    activeSignals: ActiveSignal[];
}

export interface UserRobot {
    id: string;
    userExAcc: {
        userExAccId: string;
        userExAccName: string;
    };
    status: UserRobotStatus;
    startedAt: string;
    stoppedAt: string;
    settings: {
        currentSettings: UserRobotSettings;
    };
    stats: BaseStatistics;
    openPositions: OpenPosition[];
    closedPositions: ClosedPosition[];
}

export interface Robot {
    id: string;
    code: string;
    name: string;
    mod: string;
    exchange: string;
    asset: string;
    currency: string;
    timeframe: ValidTimeframe;
    strategy: {
        description: string;
    };
    startedAt: string;
    settings: {
        currentSettings: RobotSettings;
    };
    stats: BaseStatistics;
    openPositions: OpenPosition[];
    closedPositions: ClosedPosition[];
    activeSignals: ActiveSignal[];
    userSignals?: UserSignal[];
    userRobots?: UserRobot[];
    userSignal?: UserSignal;
    userRobot?: UserRobot;
    lastInfoUpdatedAt: string;
}
