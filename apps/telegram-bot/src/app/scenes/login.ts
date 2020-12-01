import { sql } from "@cryptuoso/postgres";
import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { getMainKeyboard, getStartKeyboard } from "../keyboard";
import { TelegramScene } from "../types";
import { addBaseActions, getConfirmMenu } from "./default";

async function loginEnter(ctx: any) {
    try {
        return ctx.reply(ctx.i18n.t("scenes.login.enter"), getConfirmMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function loginInput(ctx: any) {
    try {
        const email = ctx.scene.state.email;
        const secretCode = ctx.scene.state.secretCode;
        if (!secretCode || !email) {
            const data = {
                email: ctx.message.text
            };
            const result = this.validator.validate(data, { email: { type: "email", normalize: true } });
            if (result !== true) {
                return ctx.reply(
                    ctx.i18n.t(
                        "scenes.registration.wrongEmail",
                        {
                            error: result.map((e: { message: string }) => e.message).join(" ")
                        },
                        Extra.HTML()
                    )
                );
            }
            const accountExists = await this.db.pg.maybeOne(sql`
            SELECT id FROM users
            WHERE email = ${data.email} AND telegram_id is not null;
        `);
            if (accountExists) {
                return ctx.reply(
                    ctx.i18n.t(
                        "scenes.registration.accExists",
                        data,
                        Extra.HTML().markup((m: any) => {
                            return m.inlineKeyboard([
                                [
                                    m.callbackButton(
                                        ctx.i18n.t("scenes.registration.woEmail"),
                                        JSON.stringify({ a: "woEmail" }),
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
                    )
                );
            }
            ctx.scene.state.email = data.email;
            ctx.scene.state.secretCode = await this.authUtils.loginTgWithEmail(data);
            return ctx.reply(ctx.i18n.t("scenes.registration.enterCode", data));
        } else if (secretCode && email) {
            const data = {
                secretCode: ctx.message.text.trim()
            };
            const result = this.validator.validate(data, { secretCode: { type: "equal", value: secretCode } });
            if (result !== true) {
                return ctx.reply(
                    ctx.i18n.t(
                        "scenes.registration.wrongCode",
                        {
                            error: result.map((e: { message: string }) => e.message).join(" ")
                        },
                        Extra.HTML()
                    )
                );
            }
            const { user, accessToken } = await this.setTelegramWithEmail({
                email,
                telegramId: ctx.from.id,
                telegramUsername: ctx.from.username,
                name: this.formatName(ctx)
            });
            ctx.session.user = user;
            ctx.session.accessToken = accessToken;
            await ctx.reply(ctx.i18n.t("scenes.login.success"), Extra.HTML());
            return ctx.reply(
                ctx.i18n.t("welcome", {
                    username: this.formatName(ctx)
                }),
                getMainKeyboard(ctx)
            );
        } else return ctx.reply(ctx.i18n.t("defaultHandler"), getStartKeyboard(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function loginEnterEmail(ctx: any) {
    try {
        return ctx.reply(ctx.i18n.t("scenes.registration.enterEmail"), getStartKeyboard(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function loginConfirm(ctx: any) {
    try {
        const name = this.formatName(ctx);
        const { user, accessToken } = await this.registerTg({
            telegramId: ctx.from.id,
            telegramUsername: ctx.from.username,
            name
        });
        ctx.session.user = user;
        ctx.session.accessToken = accessToken;
        await ctx.reply(ctx.i18n.t("scenes.registration.success"), Extra.HTML());
        return ctx.reply(
            ctx.i18n.t("welcome", {
                username: name
            }),
            getMainKeyboard(ctx)
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export function loginScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.REGISTRATION);
    scene.enter(loginEnter.bind(service));
    scene.action(/woEmail/, loginConfirm.bind(service));
    scene.action(/anotherEmail/, loginEnterEmail.bind(service));
    scene.hears(/(.*?)/, loginInput.bind(service));
    addBaseActions(scene, service);
    return scene;
}
