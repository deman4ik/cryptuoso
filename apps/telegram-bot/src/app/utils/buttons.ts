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
