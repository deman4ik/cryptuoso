import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { TelegramScene } from "../types";
import { addBaseActions, getExchangesMenu } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { gql } from "@cryptuoso/graphql-client";
import { formatExchange } from "@cryptuoso/helpers";

async function addUserExAccEnter(ctx: any) {
    try {
        if (ctx.scene.state.selectedExchange) return addUserExAccSelectedExchange.call(this, ctx);
        if (!ctx.scene.state.exchanges) ctx.scene.state.exchanges = await this.getExchanges(ctx);
        if (ctx.scene.state.edit) {
            return ctx.editMessageText(ctx.i18n.t("scenes.addUserExAcc.chooseExchange"), getExchangesMenu(ctx));
        }
        return ctx.reply(ctx.i18n.t("scenes.addUserExAcc.chooseExchange"), getExchangesMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function addUserExAccSelectedExchange(ctx: any) {
    try {
        let exchange: string;

        if (ctx.scene.state.selectedExchange) exchange = ctx.scene.state.selectedExchange;
        else {
            ({ p: exchange } = JSON.parse(ctx.callbackQuery.data));
            ctx.scene.state.selectedExchange = exchange;
        }
        ctx.scene.state.stage = "key";
        if (ctx.scene.state.edit) {
            ctx.scene.state.edit = false;
            return ctx.editMessageText(
                ctx.i18n.t("scenes.addUserExAcc.enterAPIKey", { exchange: formatExchange(exchange) }),
                Extra.HTML()
            );
        }
        return ctx.reply(
            ctx.i18n.t("scenes.addUserExAcc.enterAPIKey", { exchange: formatExchange(exchange) }),
            Extra.HTML()
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function addUserExAccSubmited(ctx: any) {
    try {
        const exchange: string = ctx.scene.state.selectedExchange;
        if (ctx.scene.state.stage === "key") {
            ctx.scene.state.key = ctx.message.text;
            ctx.scene.state.stage = "secret";
            return ctx.reply(
                ctx.i18n.t("scenes.addUserExAcc.enterAPISecret", { exchange: formatExchange(exchange) }),
                Extra.HTML()
            );
        } else if (ctx.scene.state.stage === "secret") {
            ctx.scene.state.secret = ctx.message.text;
        } else {
            return addUserExAccSelectedExchange.call(this, ctx);
        }

        await ctx.reply(ctx.i18n.t("scenes.addUserExAcc.check", { exchange: formatExchange(exchange) }), Extra.HTML());

        const {
            key,
            secret
        }: {
            key: string;
            secret: string;
        } = ctx.scene.state;

        let error;
        let result;
        try {
            ({
                userExchangeAccUpsert: { result }
            } = await this.gqlClient.request(
                gql`
                    mutation UserExchangeAccUpsert($id: uuid, $exchange: String!, $name: String, $keys: ExchangeKeys!) {
                        userExchangeAccUpsert(id: $id, exchange: $exchange, name: $name, keys: $keys) {
                            result
                        }
                    }
                `,
                {
                    exchange,
                    keys: { key, secret }
                },
                ctx
            ));
        } catch (err) {
            error = err.message;
        }

        if (error) {
            await ctx.reply(
                ctx.i18n.t("scenes.addUserExAcc.failed", {
                    exchange,
                    error
                }),
                Extra.HTML()
            );
            ctx.scene.state.key = null;
            ctx.scene.state.secret = null;
            ctx.scene.state.stage = null;
            await addUserExAccSelectedExchange.call(this, ctx);
        }

        if (result) {
            await ctx.reply(ctx.i18n.t("scenes.addUserExAcc.success", { name: result }), Extra.HTML());
            await addUserExAccBack.call(this, ctx);
        }
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function addUserExAccBack(ctx: any) {
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

export function addUserExAccScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.ADD_USER_EX_ACC);
    scene.enter(addUserExAccEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/exchange/, addUserExAccSelectedExchange.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), addUserExAccBack.bind(service));
    scene.command("back", addUserExAccBack.bind(service));
    scene.hears(/(.*?)/, addUserExAccSubmited.bind(service));
    return scene;
}
