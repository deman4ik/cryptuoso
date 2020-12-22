import { OrdersErrorEvent, UserExchangeAccountErrorEvent } from "@cryptuoso/connector-events";
import dayjs from "@cryptuoso/dayjs";
import { SignalType, TradeAction } from "@cryptuoso/market";
import { Signal } from "@cryptuoso/robot-events";
import { UserPositionStatus, UserRobotStatus, UserTradeEvent } from "@cryptuoso/user-robot-state";
import { Notification } from "@cryptuoso/user-state";

export function handleSignal(notification: Notification & { telegramId: number }) {
    const signal = notification.data as Signal & {
        robotCode: string;
        volume: number;
        profit: number;
        entryAction: TradeAction;
        entryPrice: number;
        entryDate: string;
        exitAction: TradeAction;
        exitPrice: number;
        exitDate: string;
        barsHeld: number;
    };
    //TODO: Set lang from DB
    const LANG = "en";
    const {
        profit,
        timestamp,
        type,
        action,
        orderType,
        price,
        robotCode: code,
        positionCode,
        entryAction,
        entryPrice,
        entryDate,
        exitAction,
        exitPrice,
        exitDate,
        barsHeld
    } = signal;

    let message = "";
    const robotInfo = this.i18n.t(LANG, `signal.${type}`, { code });

    if (type === SignalType.alert) {
        const signalText = this.i18n.t(LANG, "robot.signal", {
            code: positionCode,
            timestamp: dayjs.utc(timestamp).format("YYYY-MM-DD HH:mm UTC"),
            action: this.i18n.t(LANG, `tradeAction.${action}`),
            orderType: this.i18n.t(LANG, `orderType.${orderType}`),
            price: +price
        });

        message = `${robotInfo}${signalText}`;
    } else {
        let tradeText = "";

        if (action === TradeAction.closeLong || action === TradeAction.closeShort) {
            tradeText = this.i18n.t(LANG, "robot.positionClosed", {
                code: positionCode,
                entryAction: this.i18n.t(LANG, `tradeAction.${entryAction}`),
                entryPrice,
                entryDate: dayjs.utc(entryDate).format("YYYY-MM-DD HH:mm UTC"),
                exitAction: this.i18n.t(LANG, `tradeAction.${exitAction}`),
                exitPrice,
                exitDate: dayjs.utc(exitDate).format("YYYY-MM-DD HH:mm UTC"),
                barsHeld,
                profit
            });
        } else {
            tradeText = this.i18n.t(LANG, "robot.positionOpenNotif", {
                code: positionCode,
                entryAction: this.i18n.t(LANG, `tradeAction.${entryAction}`),
                entryPrice,
                entryDate: dayjs.utc(entryDate).format("YYYY-MM-DD HH:mm UTC")
            });
        }
        message = `${robotInfo}${tradeText}`;
    }

    return {
        telegramId: notification.telegramId,
        message
    };
}

export function handleUserRobotTrade(notification: Notification & { telegramId: number }) {
    const {
        robotCode,
        status,
        code,
        asset,
        entryAction,
        entryPrice,
        entryDate,
        entryExecuted,
        exitAction,
        exitPrice,
        exitDate,
        exitExecuted,
        barsHeld,
        profit
    } = notification.data as UserTradeEvent & { robotCode: string };
    //TODO: Set lang from DB
    const LANG = "en";
    const info = this.i18n.t(LANG, "userTrade.new", {
        code: robotCode
    });
    let tradeText;
    if (status === UserPositionStatus.open) {
        tradeText = this.i18n.t(LANG, "userTrade.open", {
            code,
            entryAction: this.i18n.t(LANG, `tradeAction.${entryAction}`),
            entryPrice: +entryPrice,
            entryDate: dayjs.utc(entryDate).format("YYYY-MM-DD HH:mm UTC"),
            volume: entryExecuted,
            asset
        });
    } else {
        tradeText = this.i18n.t(LANG, "userTrade.closed", {
            code,
            volume: exitExecuted,
            asset,
            entryAction: this.i18n.t(LANG, `tradeAction.${entryAction}`),
            entryPrice: +entryPrice,
            entryDate: dayjs.utc(entryDate).format("YYYY-MM-DD HH:mm UTC"),
            exitAction: this.i18n.t(LANG, `tradeAction.${exitAction}`),
            exitPrice: +exitPrice,
            exitDate: dayjs.utc(exitDate).format("YYYY-MM-DD HH:mm UTC"),
            barsHeld,
            profit
        });
    }

    return {
        telegramId: notification.telegramId,
        message: `${info}${tradeText}`
    };
}

export function handleUserExAccError(notification: Notification & { telegramId: number }) {
    const { name, error } = notification.data as UserExchangeAccountErrorEvent & { name: string };
    //TODO: Set lang from DB
    const LANG = "en";
    return {
        telegramId: notification.telegramId,
        message: this.i18n.t(LANG, `userExAcc.error`, {
            name,
            error
        })
    };
}

export function handleUserRobotError(notification: Notification & { telegramId: number }) {
    const { userRobotId, robotCode: code, error } = notification.data as {
        userRobotId: string;
        robotCode: string;
        error: string;
    };
    //TODO: Set lang from DB
    const LANG = "en";
    return {
        telegramId: notification.telegramId,
        message: this.i18n.t(LANG, `userRobot.error`, {
            id: userRobotId,
            code,
            error
        })
    };
}

export function handleUserRobotStatus(notification: Notification & { telegramId: number }) {
    const { status, message, robotCode: code } = notification.data as {
        status: UserRobotStatus;
        message?: string;
        robotCode: string;
    };
    //TODO: Set lang from DB
    const LANG = "en";
    return {
        telegramId: notification.telegramId,
        message: this.i18n.t(LANG, `userRobot.status`, {
            code,
            message: message || "",
            status
        })
    };
}

export function handleOrderError(notification: Notification & { telegramId: number }) {
    const { userRobotId, error, orderId, robotCode: code } = notification.data as OrdersErrorEvent & {
        robotCode: string;
    };
    //TODO: Set lang from DB
    const LANG = "en";
    return {
        telegramId: notification.telegramId,
        message: this.i18n.t(LANG, `userRobot.orderError`, {
            id: userRobotId,
            code,
            orderId,
            error
        })
    };
}

export function handleBroadcastMessage(notification: Notification & { telegramId: number }) {
    const { message } = notification.data as { message: string };

    return {
        telegramId: notification.telegramId,
        message
    };
}

export function handleMessageSupportReply(notification: Notification & { telegramId: number }) {
    const { message } = notification.data as { message: string };
    const LANG = "en";
    return {
        telegramId: notification.telegramId,
        message: this.i18n.t(LANG, "scenes.support.reply", { message })
    };
}
