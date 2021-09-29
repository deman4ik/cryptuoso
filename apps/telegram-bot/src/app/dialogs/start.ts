import { sleep } from "@cryptuoso/helpers";
import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { Router } from "../utils/dialogsRouter";
import { getBackKeyboard } from "../utils/keyboard";
import { registrationActions } from "./registration";

export const enum startActions {
    enter = "start:enter",
    route = "start:route"
}

const enter = async (ctx: BotContext) => {
    await ctx.reply(ctx.i18n.t("dialogs.start.enter", { username: ctx.utils.formatName(ctx) }), {
        reply_markup: getBackKeyboard(ctx)
    });
    await sleep(1000);
    ctx.session.dialog.current.data.expectInput = true;
    ctx.dialog.next(startActions.route);
    await ctx.reply(ctx.i18n.t("dialogs.start.regOrLog"), {
        reply_markup: new InlineKeyboard()
            .add({
                text: ctx.i18n.t("dialogs.start.registration"),
                callback_data: JSON.stringify({
                    d: ctx.session.dialog.current?.id || null,
                    a: startActions.route,
                    p: "reg"
                })
            })
            .add({
                text: ctx.i18n.t("dialogs.start.login"),
                callback_data: JSON.stringify({
                    d: ctx.session.dialog.current?.id || null,
                    a: startActions.route,
                    p: "log"
                })
            })
    });
};

const route = async (ctx: BotContext) => {
    const { payload } = ctx.session.dialog.current.data;

    if (payload === "reg") {
        ctx.dialog.enter(registrationActions.enter);
    } else if (payload === "log") {
        ctx.dialog.enter(registrationActions.login);
    }
};

const router: Router = new Map();

router.set(startActions.enter, enter);
router.set(startActions.route, route);

export const start = {
    name: "start",
    router
};
