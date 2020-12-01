import { sql } from "@cryptuoso/postgres";
import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { getMainKeyboard, getStartKeyboard } from "../keyboard";
import { TelegramScene } from "../types";
import { addBaseActions, getConfirmMenu } from "./default";

async function registrationEnter(ctx: any) {
    try {
        return ctx.reply(ctx.i18n.t("scenes.registration.enter"), getConfirmMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function registrationEnterEmail(ctx: any) {
    try {
        ctx.scene.state.emailRequired = true;
        return ctx.reply(ctx.i18n.t("scenes.registration.enterEmail"), getStartKeyboard(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function registrationConfirm(ctx: any) {
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

async function registrationInput(ctx: any) {
    try {
        const emailRequired = ctx.scene.state.emailRequired;
        const secretCodeSent = ctx.scene.state.secretCodeSent;
        if (emailRequired && !secretCodeSent) {
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
            WHERE email = ${data.email}
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
            const { user, accessToken } = await this.registerTgWithEmail({
                email: data.email,
                telegramId: ctx.from.id,
                telegramUsername: ctx.from.username,
                name: this.formatName(ctx)
            });
            ctx.session.user = user;
            ctx.session.accessToken = accessToken;
            ctx.scene.state.secretCodeSent = true;
            return ctx.reply(ctx.i18n.t("scenes.registration.enterCode", data));
        } else if (emailRequired && secretCodeSent) {
            await this.authUtils.confirmEmailFromTg({ telegramId: ctx.from.id, secretCode: ctx.message.text });
            await ctx.reply(ctx.i18n.t("scenes.registration.success"), Extra.HTML());
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

export function registrationScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.REGISTRATION);
    scene.enter(registrationEnter.bind(service));
    scene.action(/yes/, registrationEnterEmail.bind(service));
    scene.action(/no/, registrationConfirm.bind(service));
    scene.action(/woEmail/, registrationConfirm.bind(service));
    scene.action(/anotherEmail/, registrationEnterEmail.bind(service));
    scene.hears(/(.*?)/, registrationInput.bind(service));
    addBaseActions(scene, service);
    return scene;
}
