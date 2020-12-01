import { sleep } from "@cryptuoso/helpers";
import { sql } from "@cryptuoso/postgres";
import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { getMainKeyboard, getStartKeyboard } from "../keyboard";
import { TelegramScene } from "../types";
import { addBaseActions } from "./default";

async function loginEnter(ctx: any) {
    try {
        if (ctx.scene.state.email) return loginInput.call(this, ctx);
        return ctx.reply(ctx.i18n.t("scenes.login.enter"), Extra.HTML());
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"), Extra.HTML());
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function loginInput(ctx: any) {
    try {
        const email = ctx.scene.state.email;
        const secretCode = ctx.scene.state.secretCode;
        if (!secretCode) {
            const data = {
                email: email || ctx.message.text
            };
            const result = this.validator.validate(data, { email: { type: "email", normalize: true } });
            if (result !== true) {
                return ctx.reply(
                    ctx.i18n.t("scenes.registration.wrongEmail", {
                        error: result.map((e: { message: string }) => e.message).join(" ")
                    }),
                    Extra.HTML()
                );
            }
            const accountExists: { id: string; telegramId: number } = await this.db.pg.maybeOne(sql`
            SELECT id, telegram_id FROM users
            WHERE email = ${data.email};
        `);
            if (accountExists && accountExists?.telegramId) {
                return ctx.reply(
                    ctx.i18n.t("scenes.registration.accExists", data),
                    Extra.HTML().markup((m: any) => {
                        return m.inlineKeyboard([
                            [
                                m.callbackButton(
                                    ctx.i18n.t("scenes.login.register"),
                                    JSON.stringify({ a: "register" }),
                                    false
                                )
                            ],
                            [
                                m.callbackButton(
                                    ctx.i18n.t("scenes.registration.anotherEmail"),
                                    JSON.stringify({ a: "anotherEmail" }),
                                    false
                                )
                            ]
                        ]);
                    })
                );
            }
            if (!accountExists) {
                return ctx.reply(
                    ctx.i18n.t("scenes.login.accNotExists", data),
                    Extra.HTML().markup((m: any) => {
                        return m.inlineKeyboard([
                            [
                                m.callbackButton(
                                    ctx.i18n.t("scenes.login.register"),
                                    JSON.stringify({ a: "register" }),
                                    false
                                )
                            ],
                            [
                                m.callbackButton(
                                    ctx.i18n.t("scenes.registration.anotherEmail"),
                                    JSON.stringify({ a: "anotherEmail" }),
                                    false
                                )
                            ]
                        ]);
                    })
                );
            }
            ctx.scene.state.email = data.email;
            const { secretCode } = await this.authUtils.loginTgWithEmail(data);
            ctx.scene.state.secretCode = secretCode;
            return ctx.reply(ctx.i18n.t("scenes.registration.enterCode", data), Extra.HTML());
        } else if (secretCode && email) {
            const data = {
                secretCode: ctx.message.text.trim()
            };
            const result = this.validator.validate(data, { secretCode: { type: "equal", value: secretCode } });
            if (result !== true) {
                return ctx.reply(
                    ctx.i18n.t("scenes.registration.wrongCode", {
                        error: result.map((e: { message: string }) => e.message).join(" ")
                    }),
                    Extra.HTML()
                );
            }
            const { user, accessToken } = await this.authUtils.setTelegramWithEmail({
                email,
                telegramId: ctx.from.id,
                telegramUsername: ctx.from.username,
                name: this.formatName(ctx)
            });
            ctx.session.user = user;
            ctx.session.accessToken = accessToken;
            await ctx.reply(ctx.i18n.t("scenes.login.success", { email }), Extra.HTML());
            await sleep(100);
            await ctx.reply(
                ctx.i18n.t("welcome", {
                    username: this.formatName(ctx)
                }),
                getMainKeyboard(ctx)
            );
            ctx.scene.state.silent = true;
            await ctx.scene.leave();
        } else return ctx.reply(ctx.i18n.t("defaultHandler"), getStartKeyboard(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"), Extra.HTML());
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function loginEnterEmail(ctx: any) {
    try {
        return ctx.reply(ctx.i18n.t("scenes.registration.enterEmail"), Extra.HTML());
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"), Extra.HTML());
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function redirectToRegistration(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.REGISTRATION);
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"), Extra.HTML());
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export function loginScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.LOGIN);
    scene.enter(loginEnter.bind(service));
    addBaseActions(scene, service);
    scene.action(/register/, redirectToRegistration.bind(service));
    scene.action(/anotherEmail/, loginEnterEmail.bind(service));
    scene.hears(/(.*?)/, loginInput.bind(service));

    return scene;
}
