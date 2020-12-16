import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { TelegramScene } from "../types";
import { addBaseActions } from "./default";
import { gql } from "@cryptuoso/graphql-client";
import { User } from "@cryptuoso/user-state";
import { getBackKeyboard } from "../keyboard";
import { sleep } from "@cryptuoso/helpers";

function getSettingsMenu(ctx: any) {
    const {
        //email,
        settings: {
            notifications: {
                news: { telegram: notifNewsTelegram },
                signals: { telegram: notifSignalsTelegram },
                trading: { telegram: notifTradingTelegram }
            }
        }
    }: User = ctx.session.user;

    return Extra.HTML().markup((m: any) => {
        /*  const emailButton = email
        ? [
            m.callbackButton(
              ctx.i18n.t("scenes.settings.changeEmail"),
              JSON.stringify({ a: "changeEmail" }),
              false
            )
          ]
        : [
            m.callbackButton(
              ctx.i18n.t("scenes.settings.setEmail"),
              JSON.stringify({ a: "setEmail" }),
              false
            )
          ]; */
        const notifNewsTelegramButton = notifNewsTelegram
            ? [
                  m.callbackButton(
                      ctx.i18n.t("scenes.settings.telegramNewsNotifOn"),
                      JSON.stringify({ a: "notif", p: "telegram.news.off" }),
                      false
                  )
              ]
            : [
                  m.callbackButton(
                      ctx.i18n.t("scenes.settings.telegramNewsNotifOff"),
                      JSON.stringify({ a: "notif", p: "telegram.news.on" }),
                      false
                  )
              ];
        const notifSignalsTelegramButton = notifSignalsTelegram
            ? [
                  m.callbackButton(
                      ctx.i18n.t("scenes.settings.telegramSingalsNotifOn"),
                      JSON.stringify({ a: "notif", p: "telegram.signals.off" }),
                      false
                  )
              ]
            : [
                  m.callbackButton(
                      ctx.i18n.t("scenes.settings.telegramSingalsNotifOff"),
                      JSON.stringify({ a: "notif", p: "telegram.signals.on" }),
                      false
                  )
              ];
        const notifTradingTelegramButton = notifTradingTelegram
            ? [
                  m.callbackButton(
                      ctx.i18n.t("scenes.settings.telegramTradingNotifOn"),
                      JSON.stringify({ a: "notif", p: "telegram.trading.off" }),
                      false
                  )
              ]
            : [
                  m.callbackButton(
                      ctx.i18n.t("scenes.settings.telegramTradingNotifOff"),
                      JSON.stringify({ a: "notif", p: "telegram.trading.on" }),
                      false
                  )
              ];
        const buttons = [
            [m.callbackButton(ctx.i18n.t("scenes.settings.userExAccs"), JSON.stringify({ a: "userExAccs" }), false)],
            //emailButton,
            notifNewsTelegramButton,
            notifSignalsTelegramButton,
            notifTradingTelegramButton,
            [m.callbackButton(ctx.i18n.t("keyboards.backKeyboard.back"), JSON.stringify({ a: "back" }), false)]
        ];

        return m.inlineKeyboard(buttons);
    });
}

async function settingsEnter(ctx: any) {
    try {
        if (ctx.scene.state.reload) {
            const settings = await this.getUserSettings(ctx);
            ctx.session.user.settings = settings;
        }

        const { email }: User = ctx.session.user;

        if (ctx.scene.state.edit) {
            ctx.scene.state.edit = false;
            await ctx.editMessageText(
                ctx.i18n.t("scenes.settings.info", {
                    email: email || ctx.i18n.t("scenes.settings.emailNotSet")
                }),
                getSettingsMenu(ctx)
            );
        } else {
            await ctx.reply(ctx.i18n.t("keyboards.mainKeyboard.settings"), getBackKeyboard(ctx));
            await sleep(100);
            await ctx.reply(
                ctx.i18n.t("scenes.settings.info", {
                    email: email || ctx.i18n.t("scenes.settings.emailNotSet")
                }),
                getSettingsMenu(ctx)
            );
        }
    } catch (e) {
        this.logger.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function settingsUserExAccs(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.USER_EXCHANGE_ACCS, { edit: true });
    } catch (e) {
        this.logger.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function settingsNotif(ctx: any) {
    try {
        const { p: type } = JSON.parse(ctx.callbackQuery.data);

        let params;
        if (type === "telegram.news.off") params = { newsTelegram: false };
        else if (type === "telegram.news.on") params = { newsTelegram: true };
        else if (type === "telegram.signals.off") params = { signalsTelegram: false };
        else if (type === "telegram.signals.on") params = { signalsTelegram: true };
        else if (type === "telegram.trading.off") params = { tradingTelegram: false };
        else if (type === "telegram.trading.on") params = { tradingTelegram: true };

        let error: string;
        let result;
        try {
            ({
                setNotificationSettings: { result }
            } = await this.gqlClient.request(
                gql`
                    mutation SetNotificationSettings(
                        $signalsTelegram: Boolean
                        $signalsEmail: Boolean
                        $tradingTelegram: Boolean
                        $tradingEmail: Boolean
                        $newsTelegram: Boolean
                        $newsEmail: Boolean
                    ) {
                        setNotificationSettings(
                            signalsTelegram: $signalsTelegram
                            signalsEmail: $signalsEmail
                            tradingTelegram: $tradingTelegram
                            tradingEmail: $tradingEmail
                            newsTelegram: $newsTelegram
                            newsEmail: $newsEmail
                        ) {
                            result
                        }
                    }
                `,
                params,
                ctx
            ));
        } catch (err) {
            error = err.message;
        }
        if (error) {
            await ctx.reply(
                ctx.i18n.t("scenes.settings.notifError", {
                    error
                }),
                Extra.HTML()
            );
            ctx.scene.state.edit = false;
        }

        if (result) {
            ctx.scene.state.edit = true;
        }
        ctx.scene.state.reload = true;
        return settingsEnter.call(this, ctx);
    } catch (e) {
        this.logger.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export function settingsScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.SETTINGS);
    scene.enter(settingsEnter.bind(service));
    addBaseActions(scene, service);
    scene.action(/userExAccs/, settingsUserExAccs.bind(service));
    scene.action(/notif/, settingsNotif.bind(service));
    return scene;
}
