import { Keyboard } from "grammy";
import { BotContext } from "../types";

export const getStartKeyboard = (ctx: BotContext) => {
    return new Keyboard()
        .text(ctx.i18n.t("keyboards.startKeybord.start"))
        .text(ctx.i18n.t("keyboards.startKeybord.info"));
};

export const getBackKeyboard = (ctx: BotContext) => {
    return new Keyboard()
        .text(ctx.i18n.t("keyboards.backKeyboard.back"))
        .text(ctx.i18n.t("keyboards.backKeyboard.menu"));
};

export const getMainKeyboard = (ctx: BotContext) => {
    return new Keyboard()
        .text(ctx.i18n.t("keyboards.mainKeyboard.trading"))
        .text(ctx.i18n.t("keyboards.mainKeyboard.settings"))
        .row()
        .text(ctx.i18n.t("keyboards.mainKeyboard.support"))
        .text(ctx.i18n.t("keyboards.mainKeyboard.subscription"));
};
