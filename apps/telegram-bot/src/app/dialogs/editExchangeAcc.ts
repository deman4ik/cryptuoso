import { gql } from "@cryptuoso/graphql-client";
import { BotContext } from "../types";
import { getExchangeButtons } from "../utils/buttons";
import { Router } from "../utils/dialogsRouter";

export const enum editExchangeAccActions {
    enter = "editExAcc:enter",
    handler = "editExAcc:handler"
}
const router: Router = new Map();

const chooseExchange = async (ctx: BotContext) => {
    if (!ctx.session.exchanges || ctx.session.dialog.current.data?.reload) {
        const { exchanges } = await ctx.gql.request<{ exchanges: { code: string; name: string }[] }>(
            ctx,
            gql`
                query {
                    exchanges {
                        code
                        name
                    }
                }
            `
        );
        ctx.session.exchanges = exchanges;
    }
    ctx.session.dialog.current.data.edit = true;
    ctx.session.dialog.current.data.scene = "exchange";
    ctx.dialog.next(editExchangeAccActions.handler);
    const { message_id } = await ctx.reply(ctx.i18n.t("dialogs.editExchangeAcc.chooseExchange"), {
        reply_markup: getExchangeButtons(ctx)
    });
    ctx.session.dialog.current.data.prev_message_id = message_id;
};

const handler = async (ctx: BotContext) => {
    const { data } = ctx.session.dialog.current;
    if (data.scene === "exchange") {
        if (!ctx.session.dialog.current.data.exchange) {
            const exchange = data.payload;
            ctx.session.dialog.current.data.exchange = exchange;
        }
        ctx.session.dialog.current.data.expectInput = true;
        ctx.session.dialog.current.data.scene = "key";
        if (ctx.session.dialog.current.data.prev_message_id)
            await ctx.api.deleteMessage(ctx.chat.id, ctx.session.dialog.current.data.prev_message_id);
        await ctx.reply(
            ctx.i18n.t("dialogs.editExchangeAcc.enterAPIKey", {
                exchange: ctx.session.dialog.current.data.exchange
            })
        );
        return;
    } else if (data.scene === "key") {
        ctx.session.dialog.current.data.key = data.payload;
        if (ctx.session.dialog.current.data.exchange === "kucoin") ctx.session.dialog.current.data.scene = "pass";
        else ctx.session.dialog.current.data.scene = "check";
        ctx.session.dialog.current.data.expectInput = true;
        await ctx.reply(
            ctx.i18n.t("dialogs.editExchangeAcc.enterAPISecret", {
                exchange: ctx.session.dialog.current.data.exchange
            })
        );
        return;
    } else if (data.scene === "pass") {
        ctx.session.dialog.current.data.secret = data.payload;
        ctx.session.dialog.current.data.scene = "check";
        ctx.session.dialog.current.data.expectInput = true;
        await ctx.reply(
            ctx.i18n.t("dialogs.editExchangeAcc.enterAPIPass", {
                exchange: ctx.session.dialog.current.data.exchange
            })
        );
        return;
    } else if (data.scene === "check") {
        if (ctx.session.dialog.current.data.exchange === "kucoin") ctx.session.dialog.current.data.pass = data.payload;
        else ctx.session.dialog.current.data.secret = data.payload;
        await ctx.reply(
            ctx.i18n.t("dialogs.editExchangeAcc.check", {
                exchange: ctx.session.dialog.current.data.exchange
            })
        );

        const { exchange, key, secret, pass } = ctx.session.dialog.current.data;

        let error;
        let result;
        try {
            ({
                userExchangeAccUpsert: { result }
            } = await ctx.gql.request<{ userExchangeAccUpsert: { result: string } }>(
                ctx,
                gql`
                    mutation UserExchangeAccUpsert($id: uuid, $exchange: String!, $name: String, $keys: ExchangeKeys!) {
                        userExchangeAccUpsert(id: $id, exchange: $exchange, name: $name, keys: $keys) {
                            result
                        }
                    }
                `,
                {
                    exchange,
                    keys: { key, secret, pass }
                }
            ));
        } catch (err) {
            error = err.message;
        }

        if (error) {
            await ctx.reply(
                ctx.i18n.t("dialogs.editExchangeAcc.failed", {
                    exchange: ctx.session.dialog.current.data.exchange,
                    error
                })
            );
            ctx.session.dialog.current.data.key = null;
            ctx.session.dialog.current.data.secret = null;
            ctx.session.dialog.current.data.pass = null;
            ctx.session.dialog.current.data.scene = "exchange";
            ctx.dialog.jump(editExchangeAccActions.handler);
        }

        if (result) {
            await ctx.reply(ctx.i18n.t("dialogs.editExchangeAcc.success", { exchange: exchange }));
            ctx.dialog.return({ userExAccId: result });
        }
    }
};

router.set(editExchangeAccActions.enter, chooseExchange);
router.set(editExchangeAccActions.handler, handler);

export const editExchangeAcc = {
    name: "editExchangeAcc",
    router
};
