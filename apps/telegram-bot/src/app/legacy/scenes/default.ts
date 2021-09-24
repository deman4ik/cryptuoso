import { BaseService } from "@cryptuoso/service";
import { Extra } from "telegraf";
import { match } from "@edjopato/telegraf-i18n";
import { chunkArray, formatExchange } from "@cryptuoso/helpers";

export function getConfirmMenu(ctx: any) {
    return Extra.HTML().markup((m: any) => {
        return m.inlineKeyboard([
            [m.callbackButton(ctx.i18n.t("keyboards.confirm.yes"), JSON.stringify({ a: "yes" }), false)],
            [m.callbackButton(ctx.i18n.t("keyboards.confirm.no"), JSON.stringify({ a: "no" }), false)]
        ]);
    });
}

export function getExchangesMenu(ctx: any) {
    const exchanges: { code: string }[] = ctx.scene.state.exchanges;
    return Extra.HTML().markup((m: any) => {
        const buttons = exchanges.map(({ code }) =>
            m.callbackButton(formatExchange(code), JSON.stringify({ a: "exchange", p: code }), false)
        );
        const chunkedButtons = chunkArray(buttons, 2);
        return m.inlineKeyboard([
            ...chunkedButtons,
            [m.callbackButton(ctx.i18n.t("keyboards.backKeyboard.back"), JSON.stringify({ a: "back", p: null }), false)]
        ]);
    });
}

export function getAssetsMenu(ctx: any) {
    const assets: {
        asset: string;
        currency: string;
    }[] = ctx.scene.state.assets;
    return Extra.HTML().markup((m: any) => {
        const buttons = assets.map((asset) =>
            m.callbackButton(
                `${asset.asset}/${asset.currency}`,
                JSON.stringify({ a: "asset", p: `${asset.asset}/${asset.currency}` }),
                false
            )
        );
        const chunkedButtons = chunkArray(buttons, 3);
        return m.inlineKeyboard([
            ...chunkedButtons,
            [
                m.callbackButton(
                    ctx.i18n.t("keyboards.backKeyboard.back"),
                    JSON.stringify({ a: "back", p: "selectExchange" }),
                    false
                )
            ]
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
