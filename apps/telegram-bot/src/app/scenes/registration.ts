import { BaseService } from "@cryptuoso/service";
import { BaseScene } from "telegraf";
import { TelegramScene } from "../types";
import { addBaseActions } from "./default";

async function registerEnter(ctx: any) {
    try {
        return ctx.reply("register");
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export function registrationScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.REGISTRATION);
    scene.enter(registerEnter.bind(service));
    addBaseActions(scene, service);
    return scene;
}
