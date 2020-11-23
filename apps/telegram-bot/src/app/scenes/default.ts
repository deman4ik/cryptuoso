import { BaseService } from "@cryptuoso/service";
import { getMainKeyboard } from "../keyboard";
import { BaseScene, Stage } from "telegraf";
import { match } from "@edjopato/telegraf-i18n";

export async function backAction(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(ctx.scene.state.prevScene, {
            ...ctx.scene.state.prevState,
            edit: false,
            reload: true
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export async function leaveAction(ctx: any) {
    if (ctx.scene.state.silent) return;
    await ctx.reply(ctx.i18n.t("menu"), getMainKeyboard(ctx));
}

export async function addBaseActions(scene: BaseScene<any>, service: BaseService) {
    scene.leave(leaveAction.bind(service));
    //scene.hears(match("keyboards.backKeyboard.back"), backAction.bind(this));
    //scene.hears(match("keyboards.backKeyboard.menu"), Stage.leave());
    scene.command("back", backAction.bind(this));
    scene.action(/back/, backAction.bind(this));
    scene.command("menu", Stage.leave());
}
