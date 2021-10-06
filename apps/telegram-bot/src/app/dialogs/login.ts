import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import Validator from "fastest-validator";
import { pg, sql } from "@cryptuoso/postgres";
import { sleep } from "@cryptuoso/helpers";
import { getMainKeyboard, getStartKeyboard } from "../utils/keyboard";
import { Router } from "../utils/dialogsRouter";
import { registrationActions } from "./registration";

export const enum loginActions {
    enter = "login:enter",
    input = "login:input",
    registration = "login:reg",
    anotherEmail = "login:anotherEmail"
}

const getLoginButtons = (ctx: BotContext) => {
    return new InlineKeyboard()
        .add({
            text: ctx.i18n.t("dialogs.login.register"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: loginActions.registration,
                p: true
            })
        })
        .row()
        .add({
            text: ctx.i18n.t("dialogs..login.anotherEmail"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: loginActions.anotherEmail,
                p: true
            })
        });
};

const enter = async (ctx: BotContext) => {
    ctx.session.dialog.current.data.expectInput = true;
    ctx.dialog.next(loginActions.input);
    await ctx.reply(ctx.i18n.t("dialogs.login.enter"));
};

const input = async (ctx: BotContext) => {
    const { email, secretCode, payload } = ctx.session.dialog.current.data;

    if (!secretCode) {
        const data = {
            email: email || payload
        };
        const validator = new Validator();
        const result = await validator.validate(data, { email: { type: "email", normalize: true } });

        if (result !== true) {
            await ctx.reply(
                ctx.i18n.t("dialogs.registration.wrongEmail", {
                    error: result.map((e) => e.message).join(" ")
                })
            );
            return;
        }
        const accountExists = await pg.maybeOne<{ id: string; telegramId: number }>(sql`
            SELECT id, telegram_id FROM users
            WHERE email = ${data.email};
        `);
        if (accountExists && accountExists?.telegramId) {
            await ctx.reply(ctx.i18n.t("dialogs.registration.accExists", data), { reply_markup: getLoginButtons(ctx) });
            return;
        }
        if (!accountExists) {
            await ctx.reply(ctx.i18n.t("dialogs.registration.accNotExists", data), {
                reply_markup: getLoginButtons(ctx)
            });
            return;
        }
        ctx.session.dialog.current.data.email = data.email;
        const { secretCode } = await ctx.authUtils.loginTgWithEmail(data);
        ctx.session.dialog.current.data.secretCode = secretCode;
        ctx.session.dialog.current.data.expectInput = true;
        ctx.dialog.next(loginActions.input);
        await ctx.reply(ctx.i18n.t("dialogs.registration.enterCode", data));
    } else if (secretCode && email) {
        const data = {
            secretCode: `${payload}`.trim()
        };
        const validator = new Validator();
        const result = await validator.validate(data, { secretCode: { type: "equal", value: secretCode } });
        if (result !== true) {
            await ctx.reply(
                ctx.i18n.t("dialogs.registration.wrongCode", {
                    error: result.map((e) => e.message).join(" ")
                })
            );
            ctx.session.dialog.current.data.expectInput = true;
            ctx.dialog.next(loginActions.input);
            return;
        }
        const { user, accessToken } = await ctx.authUtils.setTelegramWithEmail({
            email,
            telegramId: ctx.from.id,
            telegramUsername: ctx.from.username,
            name: ctx.utils.formatName(ctx)
        });
        ctx.session.user = { ...user, accessToken };
        await ctx.reply(ctx.i18n.t("dialogs.login.success", { email }));
        await sleep(1000);
        await ctx.reply(
            ctx.i18n.t("welcome", {
                username: ctx.utils.formatName(ctx)
            }),
            getMainKeyboard(ctx)
        );
    } else {
        await ctx.reply(ctx.i18n.t("defaultHandler"), getStartKeyboard(ctx));
    }
};

const anotherEmail = async (ctx: BotContext) => {
    ctx.session.dialog.current.data.expectInput = true;
    ctx.dialog.next(loginActions.input);
    await ctx.reply(ctx.i18n.t("dialogs.registration.enterEmail"));
};

const registration = async (ctx: BotContext) => {
    ctx.dialog.enter(registrationActions.enter);
};

const router: Router = new Map();

router.set(loginActions.enter, enter);
router.set(loginActions.input, input);
router.set(loginActions.anotherEmail, anotherEmail);
router.set(loginActions.registration, registration);

export const login = {
    name: "login",
    router
};
