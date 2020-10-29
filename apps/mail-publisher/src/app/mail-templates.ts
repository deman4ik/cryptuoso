import { TemplateMailType, TemplateMailData, MailTags } from "@cryptuoso/mail-publisher-events";
import { COVER_TEMPLATE_TYPES } from "@cryptuoso/mail";
import LOCALES, { LOCALES_NAMES } from "./locales";
import { SignalType, TradeAction } from "@cryptuoso/market";
import dayjs from "@cryptuoso/dayjs";

export const NOTIFICATIONS_AGGREGATE_SUBJECT = "🔔 Your notifications";

export type stringOrFunction = string | { (locale: LOCALES_NAMES, data?: any): string };

export type arrayOrFunction = string[] | { (data?: any): string[] };

export function getStringOrFunctionValue(sof: stringOrFunction, data: any, locale: LOCALES_NAMES) {
    if (typeof sof === "string") return sof;
    if (typeof sof === "function") return sof(locale, data);

    throw new Error(`First argument is bad (${sof})`);
}

export function getArrayOrFunctionValue(aof: arrayOrFunction, data: any) {
    if (Array.isArray(aof)) return Array.from(aof);
    if (typeof aof === "function") return aof(data);

    throw new Error(`First argument is bad (${aof})`);
}

export const MAIL_TEMPLATES: {
    [T in TemplateMailType]: {
        subject: string | { (locale: LOCALES_NAMES, data?: TemplateMailData[T]): string };
        tags: MailTags[] | { (data?: TemplateMailData[T]): MailTags[] };
        /** Can be changed */
        cover_template?: COVER_TEMPLATE_TYPES;
        body: string | { (locale: LOCALES_NAMES, data?: TemplateMailData[T]): string };
    };
} = {
    [TemplateMailType.WELCOME]: {
        subject: "🚀 Welcome to Cryptuoso Platform - Please confirm your email.",
        tags: [MailTags.AUTH],
        body: (locale, { secretCode, urlData }) => `<p>Greetings!</p>
            <p>Your user account is successfully created!</p>
            <p>Activate your account by confirming your email please click <b><a href="https://cryptuoso.com/auth/activate-account/${urlData}">this link</a></b></p>
            <p>or enter this code <b>${secretCode}</b> manually on confirmation page.</p>`
    },
    [TemplateMailType.USER_ACCOUNT_ACTIVATED]: {
        subject: "🚀 Welcome to Cryptuoso Platform - User Account Activated.",
        tags: [MailTags.AUTH],
        body: `<p>Congratulations!</p>
        <p>Your user account is successfully activated!</p>
        <p>Now you can login to <b><a href="https://cryptuoso.com/auth/login">your account</a></b> using your email and password.</p>
        <p>Please check out our <b><a href="https://support.cryptuoso.com">Documentation Site</a></b> to get started!</p>`
    },
    [TemplateMailType.PASSWORD_CHANGE_CONFIRMATION]: {
        subject: "🔐 Cryptuoso - Change Password Confirmation.",
        tags: [MailTags.AUTH],
        body: `
        <p>Your password successfully changed!</p>
        <p>If you did not request this change, please contact support <a href="mailto:support@cryptuoso.com">support@cryptuoso.com</a></p>`
    },
    [TemplateMailType.PASSWORD_RESET]: {
        subject: "🔐 Cryptuoso - Password Reset Request.",
        tags: [MailTags.AUTH],
        body: (locale, { secretCode, urlData }) => `
        <p>We received a request to reset your password. Please create a new password by clicking <a href="https://cryptuoso.com/auth/confirm-password-reset/${urlData}">this link</a></p>
        <p>or enter this code <b>${secretCode}</b> manually on reset password confirmation page.</p>
        <p>This request will expire in 1 hour.</p>
        <p>If you did not request this change, no changes have been made to your user account.</p>`
    },
    [TemplateMailType.PASSWORD_RESET_CONFIRMATION]: {
        subject: "🔐 Cryptuoso - Reset Password Confirmation.",
        tags: [MailTags.AUTH],
        body: `
        <p>Your password successfully changed!</p>
        <p>If you did not request this change, please contact support <a href="mailto:support@cryptuoso.com">support@cryptuoso.com</a></p>`
    },
    [TemplateMailType.CHANGE_EMAIL]: {
        subject: "🔐 Cryptuoso - Change Email Request.",
        tags: [MailTags.AUTH],
        body: (locale, { secretCode }) => `<p>We received a request to change your email.</p>
        <p>Please enter this code <b>${secretCode}</b> to confirm.</p>
        <p>This request will expire in 1 hour.</p>
        <p>If you did not request this change, no changes have been made to your user account.</p>`
    },
    [TemplateMailType.CHANGE_EMAIL_CONFIRMATION]: {
        subject: "🔐 Cryptuoso - Email Change Confirmation.",
        tags: [MailTags.AUTH],
        body: (locale, { emailNew }) => `
        <p>Your email successfully changed to ${emailNew}!</p>
        <p>If you did not request this change, please contact support <a href="mailto:support@cryptuoso.com">support@cryptuoso.com</a></p>`
    },
    [TemplateMailType.SIGNAL]: {
        // TODO: fill
        subject: "",
        tags: (signal) => [signal.type == SignalType.alert ? MailTags.SIGNALS : MailTags.TRADING],
        body: (locale, signal) => {
            const LOCALE = LOCALES[locale];

            let message = "";
            const robotInfo = LOCALE.signal.alert({ code: signal.robotCode });
            const actionText = LOCALE.tradeAction[signal.action];
            // TODO: forceMarket
            const orderTypeText: string = (LOCALE.orderType as any)[signal.orderType];

            if (signal.type == SignalType.alert) {
                const signalText = LOCALE.robot.signal({
                    code: signal.positionCode,
                    timestamp: dayjs.utc(signal.timestamp).format("YYYY-MM-DD HH:mm UTC"),
                    action: actionText,
                    orderType: orderTypeText,
                    price: +signal.price
                });

                message = `${robotInfo}${signalText}`;
            } else if (signal.type === SignalType.trade) {
                let tradeText = "";

                if (signal.action === TradeAction.closeLong || signal.action === TradeAction.closeShort) {
                    tradeText = LOCALE.robot.positionClosed({
                        code: signal.positionCode,
                        entryAction: LOCALE.tradeAction[signal.entryAction],
                        entryPrice: signal.entryPrice,
                        entryDate: dayjs.utc(signal.entryDate).format("YYYY-MM-DD HH:mm UTC"),
                        exitAction: actionText,
                        exitPrice: signal.price,
                        exitDate: dayjs.utc(signal.timestamp).format("YYYY-MM-DD HH:mm UTC"),
                        barsHeld: signal.barsHeld,
                        profit: signal.profit
                    });
                } else {
                    tradeText = LOCALE.robot.positionOpen({
                        code: signal.positionCode,
                        entryAction: actionText,
                        entryPrice: signal.price,
                        entryDate: dayjs
                            .utc(signal.timestamp)
                            .format("YYYY-MM-DD HH:mm UTC")
                    });
                }

                message = `${robotInfo}${tradeText}`;
            }

            return message;
        }
    }
};
