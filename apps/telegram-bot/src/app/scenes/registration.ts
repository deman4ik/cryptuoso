import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { getMainKeyboard } from "../keyboard";
import { TelegramScene } from "../types";
import { addBaseActions } from "./default";

function getRegisterFirstMenu(ctx: any) {
    return Extra.HTML().markup((m: any) => {
        const buttons = [
            [m.callbackButton(ctx.i18n.t("scenes.registration.create"), JSON.stringify({ a: "create" }), false)],
            [m.callbackButton(ctx.i18n.t("scenes.registration.login"), JSON.stringify({ a: "login" }), false)]
        ];

        return m.inlineKeyboard(buttons);
    });
}

function getConfirmMenu(ctx: any) {
    return Extra.HTML().markup((m: any) => {
        return m.inlineKeyboard([
            [m.callbackButton(ctx.i18n.t("keyboards.confirm.yes"), JSON.stringify({ a: "yes" }), false)],
            [m.callbackButton(ctx.i18n.t("keyboards.confirm.no"), JSON.stringify({ a: "no" }), false)]
        ]);
    });
}

async function registerEnter(ctx: any) {
    try {
        return ctx.reply(ctx.i18n.t("scenes.registration.info"), getRegisterFirstMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function registerCreate(ctx: any) {
    try {
        ctx.scene.state.mode = "create";
        return ctx.reply(ctx.i18n.t("scenes.registration.requestEmail"), getConfirmMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function registerCreateEnterEmail(ctx: any) {
    try {
        return ctx.reply(ctx.i18n.t("scenes.registration.enterEmail"), Extra.Html());
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
        await ctx.reply(ctx.i18n.t("scenes.registration.successRegistration"), Extra.Html());
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
        return ctx.reply(ctx.i18n.t("scenes.registration.enterEmail"), Extra.Html());
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
    scene.action(/create/, registerCreate.bind(this));
    scene.action(/login/, registerLogin.bind(this));
    scene.action(/yes/, registerCreateEnterEmail.bind(this));
    scene.action(/no/, registerSuccess.bind(this));
    addBaseActions(scene, service);
    return scene;
}
