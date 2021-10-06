import { sleep } from "@cryptuoso/helpers";
import { BotContext } from "../types";
import { Router } from "../utils/dialogsRouter";
import { gql } from "../utils/graphql-client";
import { getBackKeyboard } from "../utils/keyboard";

export const enum supportActions {
    enter = "sup:enter",
    message = "sup:msg"
}

const enter = async (ctx: BotContext) => {
    await ctx.reply(ctx.i18n.t("keyboards.mainKeyboard.support"), getBackKeyboard(ctx));
    await sleep(1000);
    ctx.session.dialog.current.data.expectInput = true;
    ctx.dialog.next(supportActions.message);
    await ctx.reply(
        ctx.i18n.t("dialogs.support.combine", {
            info1: ctx.i18n.t("dialogs.support.info1"),
            info2: ctx.i18n.t("dialogs.support.info2"),
            info3: ctx.i18n.t("dialogs.support.info3"),
            info4: ctx.i18n.t("dialogs.support.info4")
        })
    );
};

const message = async (ctx: BotContext) => {
    const { payload } = ctx.session.dialog.current.data;

    const {
        supportMessage: { result }
    } = await ctx.gql.request(
        ctx,
        gql`
            mutation SupportMessage($message: String!) {
                supportMessage(message: $message) {
                    result
                }
            }
        `,
        {
            message: payload
        }
    );

    if (result) await ctx.reply(ctx.i18n.t("dialogs.support.success"));

    ctx.dialog.reset();
};

const router: Router = new Map();
router.set(supportActions.enter, enter);
router.set(supportActions.message, message);

export const support = {
    name: "support",
    router
};
