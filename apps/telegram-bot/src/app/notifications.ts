import { OrdersErrorEvent, UserExchangeAccountErrorEvent } from "@cryptuoso/connector-events";
import dayjs from "@cryptuoso/dayjs";
import { SignalType, TradeAction } from "@cryptuoso/market";
import { Signal } from "@cryptuoso/robot-events";
import { UserPositionStatus, UserRobotStatus, UserTradeEvent } from "@cryptuoso/user-robot-state";
import { Notification } from "@cryptuoso/user-state";
import { UserSubErrorEvent, UserSubPaymentStatusEvent, UserSubStatusEvent } from "@cryptuoso/user-sub-events";

export function handleSignal(notification: Notification<any> & { telegramId: number }) {
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

export function handleUserRobotTrade(notification: Notification<any> & { telegramId: number }) {
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

export function handleUserExAccError(notification: Notification<any> & { telegramId: number }) {
    const { name, error } = notification.data as UserExchangeAccountErrorEvent & { name: string };
    //TODO: Set lang from DB
    const LANG = "en";
    return {
        telegramId: notification.telegramId,
        message: this.i18n.t(LANG, `userExAcc.error`, {
            name,
            error: error.split("<html>")[0]
        })
    };
}

export function handleUserRobotError(notification: Notification<any> & { telegramId: number }) {
    const {
        userRobotId,
        robotCode: code,
        error
    } = notification.data as {
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
            error: error ? error.split("<html>")[0] : ""
        })
    };
}

export function handleUserRobotStatus(notification: Notification<any> & { telegramId: number }) {
    const {
        status,
        message,
        robotCode: code
    } = notification.data as {
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
            message: message ? message.split("<html>")[0] : "",
            status
        })
    };
}

export function handleOrderError(notification: Notification<any> & { telegramId: number }) {
    const {
        userRobotId,
        error,
        orderId,
        robotCode: code
    } = notification.data as OrdersErrorEvent & {
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
            error: error ? error.split("<html>")[0] : ""
        })
    };
}

export function handleBroadcastMessage(notification: Notification<any> & { telegramId: number }) {
    const { message } = notification.data as { message: string };

    return {
        telegramId: notification.telegramId,
        message
    };
}

export function handleMessageSupportReply(notification: Notification<any> & { telegramId: number }) {
    const {
        data: { message }
    } = notification.data as { data: { message: string } };
    const LANG = "en";
    return {
        telegramId: notification.telegramId,
        message: this.i18n.t(LANG, "scenes.support.reply", { message })
    };
}

export function handleUserSubStatus(notification: Notification<UserSubStatusEvent> & { telegramId: number }) {
    const { subscriptionName, trialEnded, activeTo, status } = notification.data;
    const LANG = "en";
    let message = "";
    if (status === "expired" || status === "canceled") {
        message = this.i18n.t(LANG, "userSubscription.expired");
    } else if (status === "expiring") {
        message = this.i18n.t(LANG, "userSubscription.expiring", {
            date: ` <b>${dayjs.utc().to(activeTo || trialEnded)}</b>!`
        });
    }
    return {
        telegramId: notification.telegramId,
        message: this.i18n.t(LANG, "userSubscription.status", {
            name: subscriptionName,
            status: this.i18n.t(LANG, `userSubStatus.${status}`),
            message
        })
    };
}

export function handleUserSubError(notification: Notification<UserSubErrorEvent> & { telegramId: number }) {
    const { error } = notification.data;
    const LANG = "en";

    return {
        telegramId: notification.telegramId,
        message: this.i18n.t(LANG, "userSubscription.error", {
            error
        })
    };
}

export function handlePaymentStatus(notification: Notification<UserSubPaymentStatusEvent> & { telegramId: number }) {
    const { subscriptionName, status, code, context } = notification.data;
    const LANG = "en";

    return {
        telegramId: notification.telegramId,
        message: this.i18n.t(LANG, "userPayment.status", {
            code,
            name: subscriptionName,
            status: this.i18n.t(LANG, `paymentStatus.${status}`),
            context: `${context || ""}`
        })
    };
}
