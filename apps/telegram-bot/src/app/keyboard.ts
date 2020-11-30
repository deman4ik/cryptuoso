import { Extra } from "telegraf";

/**
 * Returns start keyboard and its buttons according to the language
 * @param ctx - telegram context
 */
export const getStartKeyboard = (ctx: any) => {
    const backKeyboardBack = ctx.i18n.t("keyboards.startKeybord.start");
    const backKeyboardMenu = ctx.i18n.t("keyboards.startKeybord.info");

    return Extra.HTML().markup((m: any) => m.resize().keyboard([[backKeyboardBack, backKeyboardMenu]]));
};

/**
 * Returns back keyboard and its buttons according to the language
 * @param ctx - telegram context
 */
export const getBackKeyboard = (ctx: any) => {
    const backKeyboardBack = ctx.i18n.t("keyboards.backKeyboard.back");
    const backKeyboardMenu = ctx.i18n.t("keyboards.backKeyboard.menu");

    return Extra.HTML().markup((m: any) => m.resize().keyboard([[backKeyboardBack, backKeyboardMenu]]));
};

/**
 * Returns main keyboard and its buttons according to the language
 * @param ctx - telegram context
 */
export const getMainKeyboard = (ctx: any) => {
    const mainKeyboardSignals = ctx.i18n.t("keyboards.mainKeyboard.signals");
    const mainKeyboardRobots = ctx.i18n.t("keyboards.mainKeyboard.robots");
    const mainKeyboardSettings = ctx.i18n.t("keyboards.mainKeyboard.settings");
    const mainKeyboardSupport = ctx.i18n.t("keyboards.mainKeyboard.support");
    const mainKeyboardDonation = ctx.i18n.t("keyboards.mainKeyboard.donation");

    return Extra.HTML().markup((m: any) =>
        m
            .resize()
            .keyboard([
                [mainKeyboardSignals, mainKeyboardRobots],
                [mainKeyboardSettings, mainKeyboardSupport],
                [mainKeyboardDonation]
            ])
    );
};
