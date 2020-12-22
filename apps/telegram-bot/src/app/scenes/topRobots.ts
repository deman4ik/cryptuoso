import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { TelegramScene } from "../types";
import { addBaseActions, getExchangesMenu } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { gql } from "@cryptuoso/graphql-client";
import { formatExchange, round } from "@cryptuoso/helpers";

function getRobotsListMenu(ctx: any) {
    const robots: {
        id: string;
        name: string;
        profit: number;
        subscribed: boolean;
    }[] = ctx.scene.state.robots;
    return Extra.HTML().markup((m: any) => {
        const buttons = robots.map(({ name, id, profit, subscribed }) => [
            m.callbackButton(
                `${name} | ${profit > 0 ? "+" : ""}${round(profit)}$ ${subscribed === true ? "✅" : ""}`,
                JSON.stringify({ a: "robot", p: id }),
                false
            )
        ]);

        return m.inlineKeyboard([
            ...buttons,
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

async function topRobotsEnter(ctx: any) {
    try {
        if (ctx.scene.state.stage === "selectRobot") {
            return topRobotsSelectRobot.call(this, ctx);
        }
        if (!ctx.scene.state.exchanges || ctx.scene.state.reload) {
            ctx.scene.state.exchanges = await this.getExchanges(ctx);
        }
        if (
            !ctx.scene.state.exchanges ||
            !Array.isArray(ctx.scene.state.exchanges) ||
            ctx.scene.state.exchanges.length < 0
        ) {
            throw new Error("Failed to load trading exchanges");
        }
        ctx.scene.state.exchange = null;
        if (ctx.scene.state.edit) {
            ctx.scene.state.edit = false;
            return ctx.editMessageText(ctx.i18n.t("scenes.topRobots.selectExchange"), getExchangesMenu(ctx));
        }
        return ctx.reply(ctx.i18n.t("scenes.topRobots.selectExchange"), getExchangesMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function topRobotsSelectRobot(ctx: any) {
    try {
        if (!ctx.scene.state.exchange) {
            const { p: exchange } = JSON.parse(ctx.callbackQuery.data);
            ctx.scene.state.exchange = exchange;
        }
        const {
            robots
        }: {
            robots: {
                id: string;
                name: string;
                stats: {
                    profit: number;
                };
                userRobots: { id: string }[];
            }[];
        } = await this.gqlClient.request(
            gql`
                query TopUserRobotsList($userId: uuid!, $exchange: String!) {
                    robots(
                        where: { exchange: { _eq: $exchange }, trading: { _eq: true } }
                        order_by: { stats: { recovery_factor: desc_nulls_last } }
                        limit: 10
                    ) {
                        id
                        name
                        stats {
                            profit: net_profit
                        }
                        userRobots: user_robots(where: { user_id: { _eq: $userId } }) {
                            id
                        }
                    }
                }
            `,
            {
                userId: ctx.session.user.id,
                exchange: ctx.scene.state.exchange
            },
            ctx
        );
        ctx.scene.state.robots = robots.map(({ id, name, stats, userRobots }) => ({
            id,
            name,
            profit: stats?.profit || 0,
            subscribed: !!userRobots[0]?.id
        }));

        if (!ctx.scene.state.robots || !Array.isArray(ctx.scene.state.robots) || ctx.scene.state.robots.length === 0) {
            throw new Error("Failed to load trading robots");
        }

        return ctx.editMessageText(
            ctx.i18n.t("scenes.topRobots.selectRobot", {
                exchange: formatExchange(ctx.scene.state.exchange)
            }),
            getRobotsListMenu(ctx)
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function topRobotsOpenRobot(ctx: any) {
    try {
        const { p: robotId } = JSON.parse(ctx.callbackQuery.data);
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.USER_ROBOT, {
            robotId,
            edit: true,
            prevScene: TelegramScene.TOP_ROBOTS,
            prevState: { ...ctx.scene.state, stage: "selectRobot" }
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function topRobotsBack(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.ROBOTS);
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function topRobotsBackEdit(ctx: any) {
    try {
        if (ctx.callbackQuery && ctx.callbackQuery.data) {
            const data = JSON.parse(ctx.callbackQuery.data);
            if (data && data.p) {
                ctx.scene.state.stage = data.p;
                ctx.scene.state.edit = true;
                if (ctx.scene.state.stage === "selectExchange") {
                    return topRobotsEnter.call(this, ctx);
                }
                if (ctx.scene.state.stage === "selectRobot") {
                    return topRobotsSelectRobot.call(this, ctx);
                }
            }
        }
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.ROBOTS, { edit: true });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export function topRobotsScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.TOP_ROBOTS);
    scene.enter(topRobotsEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/exchange/, topRobotsSelectRobot.bind(service));
    scene.action(/robot/, topRobotsOpenRobot.bind(service));
    scene.action(/back/, topRobotsBackEdit.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), topRobotsBack.bind(service));
    scene.command("back", topRobotsBack.bind(service));
    return scene;
}
