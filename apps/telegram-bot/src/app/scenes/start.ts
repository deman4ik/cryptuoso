import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra, Stage } from "telegraf";
import { getMainKeyboard } from "../keyboard";
import { TelegramScene } from "../types";
import { addBaseActions } from "./default";
const { enter, leave } = Stage;

function getStartMenu(ctx: any) {
    return Extra.HTML().markup((m: any) => {
        const buttons = [
            [m.callbackButton(ctx.i18n.t("scenes.registration.create"), JSON.stringify({ a: "create" }), false)],
            [m.callbackButton(ctx.i18n.t("scenes.registration.login"), JSON.stringify({ a: "login" }), false)]
        ];

        return m.inlineKeyboard(buttons);
    });
}

async function startEnter(ctx: any) {
    try {
        return ctx.reply(ctx.i18n.t("scenes.start.enter"), getStartMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function registerCreateEnterEmail(ctx: any) {
    try {
        return ctx.reply(ctx.i18n.t("scenes.registration.enterEmail"), Extra.HTML());
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function registerSuccess(ctx: any) {
    try {
        //TODO: create account
        await ctx.reply(ctx.i18n.t("scenes.registration.successRegistration"), Extra.HTML());
        return ctx.reply(
            ctx.i18n.t("welcome", {
                username: this.formatName(ctx)
            }),
            getMainKeyboard(ctx)
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function registerLogin(ctx: any) {
    try {
        ctx.scene.state.mode = "login";
        return ctx.reply(ctx.i18n.t("scenes.registration.enterEmail"), Extra.HTML());
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export function registrationScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.START);
    scene.enter(startEnter.bind(service));
    scene.action(/registration/, enter(TelegramScene.REGISTRATION));
    scene.action(/login/, enter(TelegramScene.LOGIN));
    addBaseActions(scene, service);
    return scene;
}
