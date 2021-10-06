import { Keyboard } from "grammy";
import { BotContext } from "../types";

export const getStartKeyboard = (ctx: BotContext) => {
    return {
        reply_markup: {
            resize_keyboard: true,
            keyboard: new Keyboard()
                .text(ctx.i18n.t("keyboards.startKeybord.start"))
                .text(ctx.i18n.t("keyboards.startKeybord.info"))
                .build()
        }
    };
};

export const getBackKeyboard = (ctx: BotContext) => {
    return {
        reply_markup: {
            resize_keyboard: true,
            keyboard: new Keyboard()
                .text(ctx.i18n.t("keyboards.backKeyboard.back"))
                .text(ctx.i18n.t("keyboards.backKeyboard.menu"))
                .build()
        }
    };
};

export const getMainKeyboard = (ctx: BotContext) => {
    return {
        reply_markup: {
            resize_keyboard: true,
            keyboard: new Keyboard()
                .text(ctx.i18n.t("keyboards.mainKeyboard.trading"))
                .text(ctx.i18n.t("keyboards.mainKeyboard.account"))
                .text(ctx.i18n.t("keyboards.mainKeyboard.support"))
                .build()
        }
    };
};
