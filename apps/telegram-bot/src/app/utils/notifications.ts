import { OrdersErrorEvent, UserExchangeAccountErrorEvent } from "@cryptuoso/connector-events";
import dayjs from "@cryptuoso/dayjs";
import { UserPositionStatus, UserTradeEvent } from "@cryptuoso/user-robot-state";
import { Notification } from "@cryptuoso/user-state";
import { UserSubErrorEvent, UserSubPaymentStatusEvent, UserSubStatusEvent } from "@cryptuoso/user-sub-events";
import {
    PortfolioManagerUserPortfolioBuilded,
    PortfolioManagerUserPortfolioBuildError
} from "@cryptuoso/portfolio-events";
import { SignalSubscriptionTrade } from "@cryptuoso/signal-subscription-events";
import { UserPortfolioStatus } from "@cryptuoso/user-robot-events";
import { round } from "@cryptuoso/helpers";

//TODO: Notifications typings

export function handleUserTrade(notification: Notification<any> & { telegramId: number }) {
    const {
        status,
        asset,
        entryAction,
        entryPrice,
        entryDate,
        entryExecuted,
        exitAction,
        exitPrice,
        exitDate,
        exitExecuted,
        profit
    } = notification.data as UserTradeEvent & { robotCode: string };
    //TODO: Set lang from DB
    const LANG = "en";
    const info = this.i18n.t(LANG, "userTrade.new", {
        n: ""
    });
    let tradeText;
    if (status === UserPositionStatus.open) {
        tradeText = this.i18n.t(LANG, "userTrade.open", {
            entryAction: this.i18n.t(LANG, `tradeAction.${entryAction}`),
            entryPrice: +entryPrice,
            entryDate: dayjs.utc(entryDate).format("YYYY-MM-DD HH:mm UTC"),
            volume: entryExecuted,
            asset
        });
    } else {
        tradeText = this.i18n.t(LANG, "userTrade.closed", {
            volume: exitExecuted,
            asset,
            entryAction: this.i18n.t(LANG, `tradeAction.${entryAction}`),
            entryPrice: +entryPrice,
            entryDate: dayjs.utc(entryDate).format("YYYY-MM-DD HH:mm UTC"),
            exitAction: this.i18n.t(LANG, `tradeAction.${exitAction}`),
            exitPrice: +exitPrice,
            exitDate: dayjs.utc(exitDate).format("YYYY-MM-DD HH:mm UTC"),
            profit: round(profit, 2)
        });
    }

    return {
        telegramId: notification.telegramId,
        message: `${info}${tradeText}`
    };
}

export function handleSignalSubscriptionTrade(notification: Notification<any> & { telegramId: number }) {
    const { status, asset, entryAction, entryPrice, entryDate, share, exitAction, exitPrice, exitDate, profitPercent } =
        notification.data as SignalSubscriptionTrade & { robotCode: string };
    //TODO: Set lang from DB
    const LANG = "en";
    const info = this.i18n.t(LANG, "signalSubTrade.new", {
        asset
    });
    let tradeText;
    if (status === UserPositionStatus.open) {
        tradeText = this.i18n.t(LANG, "signalSubTrade.open", {
            entryAction: this.i18n.t(LANG, `tradeAction.${entryAction}`),
            entryPrice: +entryPrice,
            entryDate: dayjs.utc(entryDate).format("YYYY-MM-DD HH:mm UTC"),
            share,
            asset
        });
    } else {
        tradeText = this.i18n.t(LANG, "signalSubTrade.closed", {
            share,
            asset,
            entryAction: this.i18n.t(LANG, `tradeAction.${entryAction}`),
            entryPrice: +entryPrice,
            entryDate: dayjs.utc(entryDate).format("YYYY-MM-DD HH:mm UTC"),
            exitAction: this.i18n.t(LANG, `tradeAction.${exitAction}`),
            exitPrice: +exitPrice,
            exitDate: dayjs.utc(exitDate).format("YYYY-MM-DD HH:mm UTC"),
            profit: profitPercent
        });
    }

    return {
        telegramId: notification.telegramId,
        message: `${info}${tradeText}${this.i18n.t(LANG, "signalSubTrade.footer")}`
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
    const { userRobotId, robotCode, error } = notification.data as {
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
            code: robotCode,
            error: error ? error.split("<html>")[0] : ""
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
        message: this.i18n.t(LANG, "dialogs.support.reply", { message })
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

export function handleUserPortfolioBuilded(
    notification: Notification<PortfolioManagerUserPortfolioBuilded> & { telegramId: number }
) {
    const LANG = "en";

    return {
        telegramId: notification.telegramId,
        message: this.i18n.t(LANG, "notifications.status", {
            status: this.i18n.t(LANG, "status.builded"),
            message: ""
        })
    };
}

export function handleUserPortfolioBuildError(
    notification: Notification<PortfolioManagerUserPortfolioBuildError> & { telegramId: number }
) {
    const LANG = "en";

    return {
        telegramId: notification.telegramId,
        message: this.i18n.t(LANG, "userPortfolio.buildError", {
            error: notification.data.error
        })
    };
}

export function handleUserPortfolioStatus(notification: Notification<UserPortfolioStatus> & { telegramId: number }) {
    const { status, message } = notification.data;
    const LANG = "en";

    return {
        telegramId: notification.telegramId,
        message: this.i18n.t(LANG, "notifications.status", {
            status: this.i18n.t(LANG, `status.${status}`),
            message: message || ""
        })
    };
}
