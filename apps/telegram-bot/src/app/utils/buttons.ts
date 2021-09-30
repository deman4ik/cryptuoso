import { chunkArray } from "@cryptuoso/helpers";
import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";

export const getExchangeButtons = (ctx: BotContext) => {
    const buttons = ctx.session.exchanges?.map(({ code, name }) => ({
        text: name,
        callback_data: JSON.stringify({
            d: ctx.session.dialog.current?.id || null,
            a: ctx.session.dialog.move?.action || null,
            p: code
        })
    }));
    let keyboard = new InlineKeyboard();

    const chunks = chunkArray(buttons, 2);

    for (const chunk of chunks) {
        keyboard = keyboard.row(...chunk);
    }

    return keyboard;
};

export const getOptionsButtons = (ctx: BotContext) => {
    let keyboard = new InlineKeyboard();
    const selected: string[] = ctx.session.dialog.current.data.selectedOptions;
    for (const option of ctx.catalog.options.filter((o) => !selected.includes(o))) {
        keyboard = keyboard.row({
            text: ctx.i18n.t(`options.${option}`),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action || null,
                p: option
            })
        });
    }
    if (ctx.session.dialog.current.data.selectedOptions.length)
        keyboard = keyboard.row({
            text: ctx.i18n.t("options.done"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action || null,
                p: "done"
            })
        });
    return keyboard;
};

export const getPortfolioActions = (ctx: BotContext) =>
    new InlineKeyboard()
        .add({
            text: ctx.i18n.t("dialogs.listPortfolios.subscribe"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action || null,
                p: "subscribe"
            })
        })
        .row()
        .add({
            text: ctx.i18n.t("dialogs.listPortfolios.back"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action || null,
                p: "back"
            })
        });

export const getConfirmButtons = (ctx: BotContext) =>
    new InlineKeyboard()
        .add({
            text: ctx.i18n.t("keyboards.confirm.yes"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action || null,
                p: true
            })
        })
        .row()
        .add({
            text: ctx.i18n.t("keyboards.confirm.no"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action || null,
                p: false
            })
        });

export const getAmountTypeButtons = (ctx: BotContext) => {
    return new InlineKeyboard()
        .add({
            text: ctx.i18n.t("dialogs.addPortfolio.fullBalance"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action,
                p: "fullBalance"
            })
        })
        .row()
        .add({
            text: ctx.i18n.t("dialogs.addPortfolio.balancePercent"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action,
                p: "balancePercent"
            })
        })
        .row()
        .add({
            text: ctx.i18n.t("dialogs.addPortfolio.currencyFixed"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action,
                p: "currencyFixed"
            })
        });
};

export const getPercentButtons = (ctx: BotContext) => {
    return new InlineKeyboard()
        .add({
            text: "10%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action,
                p: 10
            })
        })
        .add({
            text: "20%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action,
                p: 20
            })
        })
        .add({
            text: "30%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action,
                p: 30
            })
        })
        .row()
        .add({
            text: "40%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action,
                p: 40
            })
        })
        .add({
            text: "50%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action,
                p: 50
            })
        })
        .add({
            text: "60%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action,
                p: 60
            })
        })
        .row()
        .add({
            text: "70%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action,
                p: 70
            })
        })
        .add({
            text: "80%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action,
                p: 80
            })
        })
        .add({
            text: "90%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: ctx.session.dialog.move?.action,
                p: 90
            })
        });
};
