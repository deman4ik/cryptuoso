import { sleep } from "@cryptuoso/helpers";
import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra, Stage } from "telegraf";
import { getBackKeyboard } from "../keyboard";
import { TelegramScene } from "../types";
import { addBaseActions } from "./default";
const { enter } = Stage;

function getStartMenu(ctx: any) {
    return Extra.HTML().markup((m: any) => {
        const buttons = [
            [m.callbackButton(ctx.i18n.t("scenes.start.registration"), JSON.stringify({ a: "registration" }), false)],
            [m.callbackButton(ctx.i18n.t("scenes.start.login"), JSON.stringify({ a: "login" }), false)]
        ];

        return m.inlineKeyboard(buttons);
    });
}

async function startEnter(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.reply(ctx.i18n.t("scenes.start.enter", { username: this.formatName(ctx) }), getBackKeyboard(ctx));
        await sleep(100);
        await ctx.reply(ctx.i18n.t("scenes.start.regOrLog"), getStartMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export function startScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.START);
    scene.enter(startEnter.bind(service));
    addBaseActions(scene, service);
    scene.action(/registration/, enter(TelegramScene.REGISTRATION));
    scene.action(/login/, enter(TelegramScene.LOGIN));

    return scene;
}
