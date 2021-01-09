import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { TelegramScene } from "../types";
import { addBaseActions } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { gql } from "@cryptuoso/graphql-client";
import { UserExchangeAccountInfo } from "@cryptuoso/user-state";
import { formatExchange } from "@cryptuoso/helpers";

async function editUserExAccEnter(ctx: any) {
    try {
        const { name, exchange }: UserExchangeAccountInfo = ctx.scene.state.userExAcc;
        ctx.scene.state.stage = "key";
        if (ctx.scene.state.edit) {
            return ctx.editMessageText(
                ctx.i18n.t("scenes.editUserExAcc.enterAPIKey", { name, exchange: formatExchange(exchange) }),
                Extra.HTML()
            );
        }
        return ctx.reply(
            ctx.i18n.t("scenes.editUserExAcc.enterAPIKey", { name, exchange: formatExchange(exchange) }),
            Extra.HTML()
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function editUserExAccSubmited(ctx: any) {
    try {
        const { id, name, exchange }: UserExchangeAccountInfo = ctx.scene.state.userExAcc;
        if (ctx.scene.state.stage === "key") {
            ctx.scene.state.key = ctx.message.text;
            ctx.scene.state.stage = "secret";
            return ctx.reply(
                ctx.i18n.t("scenes.editUserExAcc.enterAPISecret", { name, exchange: formatExchange(exchange) }),
                Extra.HTML()
            );
        } else if (ctx.scene.state.stage === "secret") {
            ctx.scene.state.secret = ctx.message.text;
        } else {
            await editUserExAccEnter.call(this, ctx);
        }

        await ctx.reply(ctx.i18n.t("scenes.editUserExAcc.check", { exchange: formatExchange(exchange) }), Extra.HTML());

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
                    id,
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
                ctx.i18n.t("scenes.editUserExAcc.failed", {
                    exchange,
                    error: `${error}`
                }),
                Extra.HTML()
            );
            ctx.scene.state.key = null;
            ctx.scene.state.secret = null;
            ctx.scene.state.stage = null;
            await editUserExAccEnter.call(this, ctx);
        }

        if (result) {
            await ctx.reply(
                ctx.i18n.t("scenes.editUserExAcc.success", { exchange: formatExchange(exchange) }),
                Extra.HTML()
            );
            await editUserExAccBack.call(this, ctx);
        }
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function editUserExAccBack(ctx: any) {
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

export function editUserExAccScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.EDIT_USER_EX_ACC);
    scene.enter(editUserExAccEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.hears(match("keyboards.backKeyboard.back"), editUserExAccBack.bind(service));
    scene.command("back", editUserExAccBack.bind(service));
    scene.hears(/(.*?)/, editUserExAccSubmited.bind(service));
    return scene;
}
