import { GA } from "@cryptuoso/analytics";
import { gql } from "@cryptuoso/graphql-client";
import { sleep } from "@cryptuoso/helpers";
import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { getBackKeyboard } from "../keyboard";
import { TelegramScene } from "../types";
import { addBaseActions } from "./default";

function getRobotsMenu(ctx: any) {
    return Extra.HTML().markup((m: any) => {
        const buttons = [
            [m.callbackButton(ctx.i18n.t("scenes.robots.my"), JSON.stringify({ a: "myRobots" }), false)],
            [m.callbackButton(ctx.i18n.t("scenes.robots.search"), JSON.stringify({ a: "searchRobots" }), false)],
            [m.callbackButton(ctx.i18n.t("scenes.robots.top"), JSON.stringify({ a: "topRobots" }), false)],
            [m.callbackButton(ctx.i18n.t("scenes.robots.performance"), JSON.stringify({ a: "perfRobots" }), false)],
            [m.callbackButton(ctx.i18n.t("keyboards.backKeyboard.back"), JSON.stringify({ a: "back" }), false)]
        ];

        return m.inlineKeyboard(buttons);
    });
}

async function robotsEnter(ctx: any) {
    try {
        GA.view(ctx.session.user.id, TelegramScene.ROBOTS);
        const { stats }: { stats: { profit: number }[] } = await this.gqlClient.request(
            gql`
                query UserRobotsProfit($userId: uuid!) {
                    stats: v_user_aggr_stats(
                        where: {
                            user_id: { _eq: $userId }
                            type: { _eq: "userRobot" }
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
        await ctx.reply(ctx.i18n.t("keyboards.mainKeyboard.robots"), getBackKeyboard(ctx));
        await sleep(100);
        return ctx.reply(ctx.i18n.t("scenes.robots.info", { profit: stats[0]?.profit || 0 }), getRobotsMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function robotsMyRobots(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.MY_ROBOTS, { edit: true });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function robotsSearchRobots(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.SEARCH_ROBOTS, { edit: true });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function robotsTopRobots(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.TOP_ROBOTS, { edit: true });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function robotsPerfRobots(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.PERFORMANCE_ROBOTS, { edit: true });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export function robotsScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.ROBOTS);
    scene.enter(robotsEnter.bind(service));
    addBaseActions(scene, service);
    scene.action(/myRobots/, robotsMyRobots.bind(service));
    scene.action(/searchRobots/, robotsSearchRobots.bind(service));
    scene.action(/topRobots/, robotsTopRobots.bind(service));
    scene.action(/perfRobots/, robotsPerfRobots.bind(service));
    return scene;
}
