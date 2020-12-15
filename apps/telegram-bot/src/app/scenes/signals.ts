import { gql } from "@cryptuoso/graphql-client";
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
        const { stats }: { stats: { profit: number }[] } = await this.gqlClient.request(
            gql`
                query UserSignalsProfit($userId: uuid!) {
                    stats: v_user_aggr_stats(
                        where: {
                            user_id: { _eq: $userId }
                            type: { _eq: "signal" }
                            exchange: { _is_null: true }
                            asset: { _is_null: true }
                        }
                    ) {
                        profit: net_profit
                    }
                }
            `,
            { userId: ctx.session.user.id },
            ctx
        );
        await ctx.reply(ctx.i18n.t("keyboards.mainKeyboard.signals"), getBackKeyboard(ctx));
        await sleep(100);
        return ctx.reply(ctx.i18n.t("scenes.signals.info", { profit: stats[0]?.profit || 0 }), getSignalsMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function signalsMySignals(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.MY_SIGNALS, { edit: true });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function signalsSearchSignals(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.SEARCH_SIGNALS, { edit: true });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function signalsTopSignals(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.TOP_SIGNALS, { edit: true });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function signalsPerfSignals(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.PERFORMANCE_SIGNALS, {
            edit: true
        });
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
    scene.action(/mySignals/, signalsMySignals.bind(service));
    scene.action(/searchSignals/, signalsSearchSignals.bind(service));
    scene.action(/topSignals/, signalsTopSignals.bind(service));
    scene.action(/perfSignals/, signalsPerfSignals.bind(service));
    return scene;
}
