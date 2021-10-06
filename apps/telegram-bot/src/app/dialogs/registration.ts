import { sleep } from "@cryptuoso/helpers";
import { pg, sql } from "@cryptuoso/postgres";
import Validator from "fastest-validator";
import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { Router } from "../utils/dialogsRouter";
import { getMainKeyboard, getStartKeyboard } from "../utils/keyboard";
import { loginActions } from "./login";

export const enum registrationActions {
    enter = "reg:enter",
    email = "reg:email",
    confirm = "reg:confirm",
    login = "reg:login",
    input = "reg:input"
}

const enter = async (ctx: BotContext) => {
    await ctx.reply(ctx.i18n.t("dialogs.registration.enter"), {
        reply_markup: new InlineKeyboard()
            .add({
                text: ctx.i18n.t("keyboards.confirm.yes"),
                callback_data: JSON.stringify({
                    d: ctx.session.dialog.current?.id || null,
                    a: registrationActions.email,
                    p: true
                })
            })
            .add({
                text: ctx.i18n.t("keyboards.confirm.no"),
                callback_data: JSON.stringify({
                    d: ctx.session.dialog.current?.id || null,
                    a: registrationActions.confirm,
                    p: true
                })
            })
    });
};

const email = async (ctx: BotContext) => {
    ctx.session.dialog.current.data.emailRequired = true;
    ctx.session.dialog.current.data.expectInput = true;
    ctx.dialog.next(registrationActions.input);
    await ctx.reply(ctx.i18n.t("dialogs.registration.enterEmail"));
};

const login = async (ctx: BotContext) => {
    ctx.dialog.enter(loginActions.enter);
};

const confirm = async (ctx: BotContext) => {
    const name = ctx.utils.formatName(ctx);
    const { user, accessToken } = await ctx.authUtils.registerTg({
        telegramId: ctx.from.id,
        telegramUsername: ctx.from.username,
        name
    });
    ctx.session.user = { ...user, accessToken };
    await ctx.reply(ctx.i18n.t("dialogs.registration.success"));
    await ctx.reply(
        ctx.i18n.t("welcome", {
            username: name
        }),
        getMainKeyboard(ctx)
    );
};

const input = async (ctx: BotContext) => {
    const { emailRequired, secretCodeSent, payload } = ctx.session.dialog.current.data;
    if (emailRequired && !secretCodeSent) {
        const data = {
            email: payload
        };
        const validator = new Validator();
        const result = await validator.validate(data, { email: { type: "email", normalize: true } });
        if (result !== true) {
            await ctx.reply(
                ctx.i18n.t("dialogs.registration.wrongEmail", {
                    error: result.map((e) => e.message).join(" ")
                })
            );
            ctx.session.dialog.current.data.expectInput = true;
            ctx.dialog.next(registrationActions.input);
            return;
        }
        const accountExists = await pg.maybeOne<{ id: string; telegramId: number }>(sql`
        SELECT id, telegram_id FROM users
        WHERE email = ${data.email}
    `);
        if (accountExists && !accountExists.telegramId) {
            ctx.session.dialog.current.data.email = data.email;
            await ctx.reply(ctx.i18n.t("dialogs.registration.accExists", data), {
                reply_markup: new InlineKeyboard()
                    .add({
                        text: ctx.i18n.t("dialogs.registration.woEmail"),
                        callback_data: JSON.stringify({
                            d: ctx.session.dialog.current?.id || null,
                            a: registrationActions.confirm,
                            p: true
                        })
                    })
                    .add({
                        text: ctx.i18n.t("dialogs.registration.login"),
                        callback_data: JSON.stringify({
                            d: ctx.session.dialog.current?.id || null,
                            a: registrationActions.login,
                            p: true
                        })
                    })
                    .add({
                        text: ctx.i18n.t("dialogs.registration.anotherEmail"),
                        callback_data: JSON.stringify({
                            d: ctx.session.dialog.current?.id || null,
                            a: registrationActions.email,
                            p: true
                        })
                    })
            });
        } else if (accountExists && accountExists.telegramId) {
            await ctx.reply(ctx.i18n.t("dialogs.registration.accLinked", data), {
                reply_markup: new InlineKeyboard()
                    .add({
                        text: ctx.i18n.t("dialogs.registration.woEmail"),
                        callback_data: JSON.stringify({
                            d: ctx.session.dialog.current?.id || null,
                            a: registrationActions.confirm,
                            p: true
                        })
                    })
                    .add({
                        text: ctx.i18n.t("dialogs.registration.anotherEmail"),
                        callback_data: JSON.stringify({
                            d: ctx.session.dialog.current?.id || null,
                            a: registrationActions.email,
                            p: true
                        })
                    })
            });
        }

        const { user, accessToken } = await ctx.authUtils.registerTgWithEmail({
            email: data.email,
            telegramId: ctx.from.id,
            telegramUsername: ctx.from.username,
            name: ctx.utils.formatName(ctx)
        });
        ctx.session.user = { ...user, accessToken };
        ctx.session.dialog.current.data.secretCodeSent = true;
        ctx.session.dialog.current.data.expectInput = true;
        ctx.dialog.next(registrationActions.input);
        await ctx.reply(ctx.i18n.t("dialogs.registration.enterCode", data));
    } else if (emailRequired && secretCodeSent) {
        try {
            await ctx.authUtils.confirmEmailFromTg({ telegramId: ctx.from.id, secretCode: payload });
        } catch (error) {
            await ctx.reply(
                ctx.i18n.t("dialogs.registration.wrongCode", {
                    error: error.message
                })
            );
            ctx.session.dialog.current.data.expectInput = true;
            ctx.dialog.next(registrationActions.input);
            return;
        }
        await ctx.reply(ctx.i18n.t("dialogs.registration.success"));
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

const router: Router = new Map();
router.set(registrationActions.enter, enter);
router.set(registrationActions.email, email);
router.set(registrationActions.login, login);
router.set(registrationActions.confirm, confirm);
router.set(registrationActions.input, input);

export const registration = {
    name: "registration",
    router
};
