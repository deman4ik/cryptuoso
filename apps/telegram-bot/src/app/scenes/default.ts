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

export async function addBaseActions(scene: any, service: BaseService) {
    scene.leave(leaveAction.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), backAction.bind(this));
    scene.hears(match("keyboards.backKeyboard.menu"), Stage.leave());
    scene.command("back", backAction.bind(this));
    scene.action(/back/, backAction.bind(this));
    scene.command("menu", Stage.leave());
}
