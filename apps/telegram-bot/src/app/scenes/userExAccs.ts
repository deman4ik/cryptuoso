import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { TelegramScene } from "../types";
import { addBaseActions } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { UserExchangeAccountInfo, UserExchangeAccStatus } from "@cryptuoso/user-state";

function getUserExAccsMenu(ctx: any) {
    const { userExAccs }: { userExAccs: UserExchangeAccountInfo[] } = ctx.scene.state;
    return Extra.HTML().markup((m: any) => {
        const userExAccButtons = userExAccs.map(({ name, id, status }) => [
            m.callbackButton(
                `${name} ${status === UserExchangeAccStatus.enabled ? "✅" : "❌"}`,
                JSON.stringify({ a: "userExAcc", p: id }),
                false
            )
        ]);
        const buttons = [
            ...userExAccButtons,
            [m.callbackButton(ctx.i18n.t("scenes.userExAccs.add"), JSON.stringify({ a: "addUserExAcc" }), false)],
            [m.callbackButton(ctx.i18n.t("keyboards.backKeyboard.back"), JSON.stringify({ a: "back" }), false)]
        ];
        return m.inlineKeyboard(buttons);
    });
}

function getUserExAccsAddMenu(ctx: any) {
    return Extra.HTML().markup((m: any) => {
        const buttons = [
            [m.callbackButton(ctx.i18n.t("scenes.userExAccs.add"), JSON.stringify({ a: "addUserExAcc" }), false)]
        ];
        return m.inlineKeyboard(buttons);
    });
}

async function userExAccsEnter(ctx: any) {
    try {
        const userExAccs = await this.getUserExchangeAccs(ctx);
        if (!userExAccs && !Array.isArray(userExAccs) && userExAccs.length === 0) {
            if (ctx.scene.state.edit) {
                ctx.scene.state.edit = false;
                return ctx.editMessageText(ctx.i18n.t("scenes.userExAccs.none"), getUserExAccsAddMenu(ctx));
            }
            return ctx.reply(ctx.i18n.t("scenes.userExAccs.none"), getUserExAccsAddMenu(ctx));
        } else {
            ctx.scene.state.userExAccs = userExAccs;
            if (ctx.scene.state.edit) {
                ctx.scene.state.edit = false;
                return ctx.editMessageText(ctx.i18n.t("scenes.settings.userExAccs"), getUserExAccsMenu(ctx));
            }
            return ctx.reply(ctx.i18n.t("scenes.settings.userExAccs"), getUserExAccsMenu(ctx));
        }
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userExAccsSelectedAcc(ctx: any) {
    try {
        const { p: userExAccId } = JSON.parse(ctx.callbackQuery.data);
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.USER_EXCHANGE_ACC, {
            userExAcc: ctx.scene.state.userExAccs.find(({ id }: UserExchangeAccountInfo) => id === userExAccId),
            edit: true,
            prevScene: TelegramScene.USER_EXCHANGE_ACCS,
            prevState: { userExAccs: ctx.scene.state.userExAccs }
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userExAccsAddAcc(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.ADD_USER_EX_ACC, {
            edit: true,
            prevScene: TelegramScene.USER_EXCHANGE_ACCS,
            prevState: { userExAccs: ctx.scene.state.userExAccs }
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userExAccsBack(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.SETTINGS);
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userExAccsBackEdit(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.SETTINGS, { edit: true });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export function userExAccsScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.USER_EXCHANGE_ACCS);
    scene.enter(userExAccsEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/addUserExAcc/, userExAccsAddAcc.bind(service));
    scene.action(/userExAcc/, userExAccsSelectedAcc.bind(service));
    scene.action(/back/, userExAccsBackEdit.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), userExAccsBack.bind(service));
    scene.command("back", userExAccsBack.bind(service));
    return scene;
}
