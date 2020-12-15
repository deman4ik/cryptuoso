import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { TelegramScene } from "../types";
import { addBaseActions } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { gql } from "@cryptuoso/graphql-client";
import { chunkArray, formatExchange } from "@cryptuoso/helpers";

function getExchangesMenu(ctx: any) {
    const exchanges: { code: string }[] = ctx.scene.state.exchanges;
    return Extra.HTML().markup((m: any) => {
        const buttons = exchanges.map(({ code }) =>
            m.callbackButton(formatExchange(code), JSON.stringify({ a: "exchange", p: code }), false)
        );
        const chunkedButtons = chunkArray(buttons, 3);
        return m.inlineKeyboard([
            ...chunkedButtons,
            [m.callbackButton(ctx.i18n.t("keyboards.backKeyboard.back"), JSON.stringify({ a: "back", p: null }), false)]
        ]);
    });
}

function getAssetsMenu(ctx: any) {
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

function getSignalsListMenu(ctx: any) {
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

async function searchSignalsEnter(ctx: any) {
    try {
        let exchanges: { code: string }[];
        if (ctx.scene.state.exchanges && !ctx.scene.state.reload) exchanges = ctx.scene.state.exchanges;
        else {
            exchanges = await this.getExchanges(ctx);
            ctx.scene.state.exchanges = exchanges;
        }
        if (!exchanges || !Array.isArray(exchanges) || exchanges.length < 0) {
            throw new Error("Failed to load trading exchanges");
        }
        ctx.scene.state.exchange = null;
        if (ctx.scene.state.edit) {
            ctx.scene.state.edit = false;
            return ctx.editMessageText(ctx.i18n.t("scenes.searchSignals.selectExchange"), getExchangesMenu(ctx));
        }
        return ctx.reply(ctx.i18n.t("scenes.searchSignals.selectExchange"), getExchangesMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function searchSignalsSelectAsset(ctx: any) {
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
                query AvailableAssets($available: Int!, $exchange: String!, $signals: Boolean!) {
                    assets: robots(
                        where: {
                            available: { _gte: $available }
                            exchange: { _eq: $exchange }
                            signals: { _eq: $signals }
                        }
                        distinct_on: [asset, currency]
                    ) {
                        asset
                        currency
                    }
                }
            `,
            { signals: true, exchange: ctx.scene.state.exchange, available: ctx.session.user.available },
            ctx
        );

        ctx.scene.state.assets = assets;

        if (!assets || !Array.isArray(assets) || assets.length < 0) {
            throw new Error("Failed to load signal assets");
        }
        ctx.scene.state.selectedAsset = null;

        return ctx.editMessageText(
            ctx.i18n.t("scenes.searchSignals.selectAsset", {
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

async function searchSignalsSelectRobot(ctx: any) {
    try {
        if (!ctx.scene.state.selectedAsset) {
            const { p: selectedAsset } = JSON.parse(ctx.callbackQuery.data);
            ctx.scene.state.selectedAsset = selectedAsset;
        }
        const [asset, currency] = ctx.scene.state.selectedAsset.split("/");
        const { robots } = await this.gqlClient.request(
            gql`
                query SignalsRobotsList(
                    $userId: uuid!
                    $available: Int!
                    $exchange: String!
                    $asset: String!
                    $currency: String!
                ) {
                    robots(
                        where: {
                            available: { _gte: $available }
                            exchange: { _eq: $exchange }
                            asset: { _eq: $asset }
                            currency: { _eq: $currency }
                            signals: { _eq: true }
                            _not: { user_signals: { user_id: { _eq: $userId } } }
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
                available: ctx.session.user.available,
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
            ctx.i18n.t("scenes.searchSignals.selectRobot", {
                exchange: formatExchange(ctx.scene.state.exchange),
                asset: ctx.scene.state.selectedAsset
            }),
            getSignalsListMenu(ctx)
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function searchSignalsOpenRobot(ctx: any) {
    try {
        const { p: robotId } = JSON.parse(ctx.callbackQuery.data);
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.ROBOT_SIGNAL, {
            robotId,
            edit: true,
            prevScene: TelegramScene.SEARCH_SIGNALS,
            prevState: { ...ctx.scene.state, stage: "selectRobot" }
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function searchSignalsBack(ctx: any) {
    try {
        if (ctx.callbackQuery && ctx.callbackQuery.data) {
            const data = JSON.parse(ctx.callbackQuery.data);
            if (data && data.p) {
                ctx.scene.state.stage = data.p;
                if (ctx.scene.state.stage === "selectAsset") return searchSignalsSelectAsset.call(this, ctx);
                if (ctx.scene.state.stage === "selectRobot") {
                    return searchSignalsSelectRobot.call(this, ctx);
                }
            }
        }
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.SIGNALS);
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function searchSignalsBackEdit(ctx: any) {
    try {
        if (ctx.callbackQuery && ctx.callbackQuery.data) {
            const data = JSON.parse(ctx.callbackQuery.data);
            if (data && data.p) {
                ctx.scene.state.stage = data.p;
                ctx.scene.state.edit = true;
                if (ctx.scene.state.stage === "selectAsset") return searchSignalsSelectAsset.call(this, ctx);
                if (ctx.scene.state.stage === "selectRobot") {
                    return searchSignalsSelectRobot.call(this, ctx);
                }
            }
        }
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.SIGNALS, { edit: true });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export function searchSignalsScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.SEARCH_SIGNALS);
    scene.enter(searchSignalsEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/exchange/, searchSignalsSelectAsset.bind(service));
    scene.action(/asset/, searchSignalsSelectRobot.bind(service));
    scene.action(/robot/, searchSignalsOpenRobot.bind(service));
    scene.action(/back/, searchSignalsBackEdit.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), searchSignalsBack.bind(service));
    scene.command("back", searchSignalsBack.bind(service));
    return scene;
}
