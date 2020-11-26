import { sleep } from "@cryptuoso/helpers";
import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { getBackKeyboard } from "../keyboard";
import { TelegramScene } from "../types";
import { addBaseActions } from "./default";

function getSignalsMenu(ctx: any) {
    return Extra.HTML().markup((m: any) => {
        const buttons = [
            [m.callbackButton(ctx.i18n.t("scenes.signals.my"), JSON.stringify({ a: "mySignals" }), false)],
            [m.callbackButton(ctx.i18n.t("scenes.signals.search"), JSON.stringify({ a: "searchSignals" }), false)],
            [m.callbackButton(ctx.i18n.t("scenes.signals.top"), JSON.stringify({ a: "topSignals" }), false)],
            [m.callbackButton(ctx.i18n.t("scenes.signals.performance"), JSON.stringify({ a: "perfSignals" }), false)],
            [m.callbackButton(ctx.i18n.t("keyboards.backKeyboard.back"), JSON.stringify({ a: "back" }), false)]
        ];

        return m.inlineKeyboard(buttons);
    });
}

async function signalsEnter(ctx: any) {
    try {
        await ctx.reply(ctx.i18n.t("keyboards.mainKeyboard.signals"), getBackKeyboard(ctx));
        await sleep(100);
        return ctx.reply(ctx.i18n.t("scenes.signals.info"), getSignalsMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export function signalsScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.SIGNALS);
    scene.enter(signalsEnter.bind(service));
    addBaseActions(scene, service);
    return scene;
}
