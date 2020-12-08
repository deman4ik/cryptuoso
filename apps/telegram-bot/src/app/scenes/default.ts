import { BaseService } from "@cryptuoso/service";
import { Extra, Stage } from "telegraf";
import { match } from "@edjopato/telegraf-i18n";

export function getConfirmMenu(ctx: any) {
    return Extra.HTML().markup((m: any) => {
        return m.inlineKeyboard([
            [m.callbackButton(ctx.i18n.t("keyboards.confirm.yes"), JSON.stringify({ a: "yes" }), false)],
            [m.callbackButton(ctx.i18n.t("keyboards.confirm.no"), JSON.stringify({ a: "no" }), false)]
        ]);
    });
}

export async function backAction(ctx: any) {
    try {
        if (ctx.scene.state.prevScene) {
            ctx.scene.state.silent = true;
            await ctx.scene.enter(ctx.scene.state.prevScene, {
                ...ctx.scene.state.prevState,
                edit: false,
                reload: true
            });
        } else {
            ctx.scene.state.silent = false;
            await ctx.scene.leave();
        }
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export async function leaveAction(ctx: any) {
    if (ctx.scene.state.silent) return;
    await this.mainMenu(ctx);
}

export async function menuAction(ctx: any) {
    ctx.scene.state.silent = false;
    await ctx.scene.leave();
}

export async function addBaseActions(scene: any, service: BaseService, handleBackAction = true) {
    scene.leave(leaveAction.bind(service));
    scene.hears(match("keyboards.backKeyboard.menu"), menuAction.bind(this));
    scene.command("menu", menuAction.bind(this));
    if (handleBackAction) {
        scene.hears(match("keyboards.backKeyboard.back"), backAction.bind(service));
        scene.command("back", backAction.bind(service));
        scene.action(/back/, backAction.bind(service));
    }
}
