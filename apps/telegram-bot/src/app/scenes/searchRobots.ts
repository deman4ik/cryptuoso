import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { TelegramScene } from "../types";
import { addBaseActions, getAssetsMenu, getExchangesMenu } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { gql } from "@cryptuoso/graphql-client";
import { formatExchange } from "@cryptuoso/helpers";

function getRobotsListMenu(ctx: any) {
    const robots: { id: string; name: string }[] = ctx.scene.state.robots;
    return Extra.HTML().markup((m: any) => {
        const buttons = robots.map(({ name, id }) => [
            m.callbackButton(name, JSON.stringify({ a: "robot", p: id }), false)
        ]);

        return m.inlineKeyboard([
            ...buttons,
            [
                m.callbackButton(
                    ctx.i18n.t("keyboards.backKeyboard.back"),
                    JSON.stringify({ a: "back", p: "selectAsset" }),
                    false
                )
            ]
        ]);
    });
}

async function searchRobotsEnter(ctx: any) {
    try {
        if (ctx.scene.state.stage === "selectRobot") return searchRobotsSelectRobot.call(this, ctx);
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
            return ctx.editMessageText(ctx.i18n.t("scenes.searchRobots.selectExchange"), getExchangesMenu(ctx));
        }
        return ctx.reply(ctx.i18n.t("scenes.searchRobots.selectExchange"), getExchangesMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function searchRobotsSelectAsset(ctx: any) {
    try {
        if (!ctx.scene.state.exchange) {
            const { p: exchange } = JSON.parse(ctx.callbackQuery.data);
            ctx.scene.state.exchange = exchange;
        }

        const {
            assets
        }: {
            assets: {
                asset: string;
                currency: string;
            }[];
        } = await this.gqlClient.request(
            gql`
                query AvailableAssets($exchange: String!, $trading: Boolean!) {
                    assets: robots(
                        where: { exchange: { _eq: $exchange }, trading: { _eq: $trading } }
                        distinct_on: [asset, currency]
                    ) {
                        asset
                        currency
                    }
                }
            `,
            { trading: true, exchange: ctx.scene.state.exchange },
            ctx
        );

        ctx.scene.state.assets = assets;

        if (!assets || !Array.isArray(assets) || assets.length < 0) {
            throw new Error("Failed to load trading assets");
        }
        ctx.scene.state.selectedAsset = null;

        return ctx.editMessageText(
            ctx.i18n.t("scenes.searchRobots.selectAsset", {
                exchange: formatExchange(ctx.scene.state.exchange)
            }),
            getAssetsMenu(ctx)
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function searchRobotsSelectRobot(ctx: any) {
    try {
        if (!ctx.scene.state.selectedAsset) {
            const { p: selectedAsset } = JSON.parse(ctx.callbackQuery.data);
            ctx.scene.state.selectedAsset = selectedAsset;
        }
        const [asset, currency] = ctx.scene.state.selectedAsset.split("/");
        const { robots } = await this.gqlClient.request(
            gql`
                query UserRobotsList($userId: uuid!, $exchange: String!, $asset: String!, $currency: String!) {
                    robots(
                        where: {
                            exchange: { _eq: $exchange }
                            asset: { _eq: $asset }
                            currency: { _eq: $currency }
                            trading: { _eq: true }
                            _not: { user_robots: { user_id: { _eq: $userId } } }
                        }
                        order_by: { stats: { recovery_factor: desc_nulls_last } }
                    ) {
                        id
                        name
                    }
                }
            `,
            {
                userId: ctx.session.user.id,
                exchange: ctx.scene.state.exchange,
                asset,
                currency
            },
            ctx
        );
        ctx.scene.state.robots = robots;

        if (!ctx.scene.state.robots || !Array.isArray(ctx.scene.state.robots) || ctx.scene.state.robots.length === 0) {
            throw new Error("Failed to load signal robots");
        }

        return ctx.editMessageText(
            ctx.i18n.t("scenes.searchRobots.selectRobot", {
                exchange: formatExchange(ctx.scene.state.exchange),
                asset: ctx.scene.state.selectedAsset
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

async function searchRobotsOpenRobot(ctx: any) {
    try {
        const { p: robotId } = JSON.parse(ctx.callbackQuery.data);
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.USER_ROBOT, {
            robotId,
            edit: true,
            prevScene: TelegramScene.SEARCH_ROBOTS,
            prevState: { ...ctx.scene.state, stage: "selectRobot" }
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function searchRobotsBack(ctx: any) {
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

async function searchRobotsBackEdit(ctx: any) {
    try {
        if (ctx.callbackQuery && ctx.callbackQuery.data) {
            const data = JSON.parse(ctx.callbackQuery.data);
            if (data && data.p) {
                ctx.scene.state.stage = data.p;
                ctx.scene.state.edit = true;
                if (ctx.scene.state.stage === "selectExchange") {
                    return searchRobotsEnter.call(this, ctx);
                }
                if (ctx.scene.state.stage === "selectAsset") return searchRobotsSelectAsset.call(this, ctx);

                if (ctx.scene.state.stage === "selectRobot") return searchRobotsSelectRobot.call(this, ctx);
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

export function searchRobotScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.SEARCH_ROBOTS);
    scene.enter(searchRobotsEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/exchange/, searchRobotsSelectAsset.bind(service));
    scene.action(/asset/, searchRobotsSelectRobot.bind(service));
    scene.action(/robot/, searchRobotsOpenRobot.bind(service));
    scene.action(/back/, searchRobotsBackEdit.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), searchRobotsBack.bind(service));
    scene.command("back", searchRobotsBack.bind(service));
    return scene;
}
