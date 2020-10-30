import { TemplateMailType, TemplateMailData, MailTags } from "@cryptuoso/mail-publisher-events";
import { COVER_TEMPLATE_TYPES } from "@cryptuoso/mail";
import LOCALES, { LANGS } from "./locales";
import { TradeAction } from "@cryptuoso/market";
import dayjs from "@cryptuoso/dayjs";

export const NOTIFICATIONS_AGGREGATE_SUBJECT = "🔔 Your notifications";

// May be used for all bodies if need
export const formatHTML = (htmlStr: string): string => {
    return htmlStr.replace(/(?:\r\n|\r|\n)/g, "<br />");
};

export const MAIL_TEMPLATES: {
    [T in TemplateMailType]: {
        subject: (lang: LANGS, data?: TemplateMailData[T]) => string;
        tags: MailTags[];
        /** Can be changed */
        cover_template?: COVER_TEMPLATE_TYPES;
        body: (lang: LANGS, data?: TemplateMailData[T]) => string;
    };
} = {
    [TemplateMailType.WELCOME]: {
        subject: (lang) => LOCALES[lang].subjects.welcome,
        tags: [MailTags.AUTH],
        body: (lang, data) => LOCALES[lang].bodies.welcome(data)
    },
    [TemplateMailType.USER_ACCOUNT_ACTIVATED]: {
        subject: (lang) => LOCALES[lang].subjects.userAccountActivated,
        tags: [MailTags.AUTH],
        body: (lang) => LOCALES[lang].bodies.userAccountActivated
    },
    [TemplateMailType.PASSWORD_CHANGE_CONFIRMATION]: {
        subject: (lang) => LOCALES[lang].subjects.passwordChangeConfirmation,
        tags: [MailTags.AUTH],
        body: (lang) => LOCALES[lang].bodies.passwordChangeConfirmation
    },
    [TemplateMailType.PASSWORD_RESET]: {
        subject: (lang) => LOCALES[lang].subjects.passwordReset,
        tags: [MailTags.AUTH],
        body: (lang, data) => LOCALES[lang].bodies.passwordReset(data)
    },
    [TemplateMailType.PASSWORD_RESET_CONFIRMATION]: {
        subject: (lang) => LOCALES[lang].subjects.passwordResetConfirmation,
        tags: [MailTags.AUTH],
        body: (lang) => LOCALES[lang].bodies.passwordResetConfirmation
    },
    [TemplateMailType.CHANGE_EMAIL]: {
        subject: (lang) => LOCALES[lang].subjects.changeEmail,
        tags: [MailTags.AUTH],
        body: (lang, data) => LOCALES[lang].bodies.changeEmail(data),
    },
    [TemplateMailType.CHANGE_EMAIL_CONFIRMATION]: {
        subject: (lang) => LOCALES[lang].subjects.changeEmailConfirmation,
        tags: [MailTags.AUTH],
        body: (lang, data) => LOCALES[lang].bodies.changeEmailConfirmation(data)
    },
    [TemplateMailType.SIGNAL_ALERT]: {
        // TODO: fill
        subject: (lang, signal) => LOCALES[lang].subjects.signalAlert,
        tags: [MailTags.SIGNALS],
        body: (lang, signal) => {
            const LOCALE = LOCALES[lang];

            const robotInfo = LOCALE.signal.alert({ code: signal.robotCode });
            const actionText = LOCALE.tradeAction[signal.action];
            // TODO: forceMarket
            const orderTypeText: string = (LOCALE.orderType as any)[signal.orderType];
            
            const signalText = LOCALE.robot.signal({
                code: signal.positionCode,
                timestamp: dayjs.utc(signal.timestamp).format("YYYY-MM-DD HH:mm UTC"),
                action: actionText,
                orderType: orderTypeText,
                price: +signal.price
            });

            return formatHTML(`${robotInfo}${signalText}`);
        }
    },
    [TemplateMailType.SIGNAL_TRADE]: {
        // TODO: fill
        subject: (lang, signal) => LOCALES[lang].subjects.signalTrade,
        tags: [MailTags.TRADING],
        body: (lang, signal) => {
            const LOCALE = LOCALES[lang];

            const robotInfo = LOCALE.signal.alert({ code: signal.robotCode });
            const actionText = LOCALE.tradeAction[signal.action];

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

            return formatHTML(`${robotInfo}${tradeText}`);
        }
    }
};
