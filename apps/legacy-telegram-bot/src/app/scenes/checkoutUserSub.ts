import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { IUserPayment, IUserSub, TelegramScene } from "../types";
import { addBaseActions } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { gql } from "@cryptuoso/graphql-client";
import dayjs from "@cryptuoso/dayjs";
import { GA } from "@cryptuoso/analytics";

export function getCheckMenu(ctx: any) {
    const { userPayment }: { userPayment: IUserPayment } = ctx.scene.state;
    return Extra.HTML().markup((m: any) => {
        return m.inlineKeyboard([
            [
                m.callbackButton(
                    ctx.i18n.t("scenes.checkoutUserSub.check"),
                    JSON.stringify({ a: "check" }),
                    ["RESOLVED", "EXPIRED", "CANCELED"].includes(userPayment.status)
                )
            ],
            [m.callbackButton(ctx.i18n.t("keyboards.backKeyboard.back"), JSON.stringify({ a: "back" }), false)]
        ]);
    });
}

async function checkoutUserSubEnter(ctx: any) {
    try {
        GA.view(ctx.session.user.id, TelegramScene.CHECKOUT_USER_SUB);
        const { userSub }: { userSub: IUserSub } = ctx.scene.state;

        const {
            checkoutUserSub: { userPayment }
        }: {
            checkoutUserSub: {
                userPayment: IUserPayment;
            };
        } = await this.gqlClient.request(
            gql`
                mutation checkoutUserSub($userSubId: uuid!) {
                    checkoutUserSub(userSubId: $userSubId) {
                        userPayment {
                            id
                            code
                            url
                            status
                            price
                            created_at
                            expires_at
                            subscription_from
                            subscription_to
                        }
                    }
                }
            `,
            {
                userSubId: userSub.id
            },
            ctx
        );
        ctx.scene.state.userPayment = userPayment;
        return ctx.reply(
            ctx.i18n.t("scenes.checkoutUserSub.info", {
                subscriptionName: userSub.subscription.name,
                subscriptionOption: userSub.subscriptionOption.name,
                subscriptionFrom: dayjs.utc(userPayment.subscription_from).format("YYYY-MM-DD"),
                subscriptionTo: dayjs.utc(userPayment.subscription_to).format("YYYY-MM-DD"),
                price: userPayment.price,
                status: ctx.i18n.t(`paymentStatus.${userPayment.status}`),
                expires: dayjs.utc(userPayment.expires_at).format("YYYY-MM-DD HH:mm UTC"),
                code: userPayment.code,
                url: userPayment.url,
                updated: dayjs.utc().format("YYYY-MM-DD HH:mm:ss UTC")
            }),
            getCheckMenu(ctx)
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function checkoutUserSubCheck(ctx: any) {
    try {
        const { userPayment, userSub }: { userPayment: IUserPayment; userSub: IUserSub } = ctx.scene.state;

        const {
            checkPayment
        }: {
            checkPayment: {
                userPayment: IUserPayment;
            };
        } = await this.gqlClient.request(
            gql`
                mutation checkPayment($chargeId: uuid!, $provider: String!) {
                    checkPayment(chargeId: $chargeId, provider: $provider) {
                        userPayment {
                            id
                            code
                            url
                            status
                            price
                            created_at
                            expires_at
                            subscription_from
                            subscription_to
                        }
                    }
                }
            `,
            { chargeId: userPayment.id, provider: "coinbase.commerce" },
            ctx
        );
        ctx.scene.state.userPayment = checkPayment.userPayment;
        return ctx.editMessageText(
            ctx.i18n.t("scenes.checkoutUserSub.info", {
                subscriptionName: userSub.subscription.name,
                subscriptionOption: userSub.subscriptionOption.name,
                subscriptionFrom: dayjs.utc(ctx.scene.state.userPayment.subscription_from).format("YYYY-MM-DD"),
                subscriptionTo: dayjs.utc(ctx.scene.state.userPayment.subscription_to).format("YYYY-MM-DD"),
                price: ctx.scene.state.userPayment.price,
                status: ctx.i18n.t(`paymentStatus.${ctx.scene.state.userPayment.status}`),
                expires: dayjs.utc(ctx.scene.state.userPayment.expires_at).format("YYYY-MM-DD HH:mm UTC"),
                code: ctx.scene.state.userPayment.code,
                url: ctx.scene.state.userPayment.url,
                updated: dayjs.utc().format("YYYY-MM-DD HH:mm:ss UTC")
            }),
            getCheckMenu(ctx)
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function checkoutUserSubBack(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.USER_SUB, {
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

export function checkoutUserSubScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.CHECKOUT_USER_SUB);
    scene.enter(checkoutUserSubEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/check/, checkoutUserSubCheck.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), checkoutUserSubBack.bind(service));
    scene.command("back", checkoutUserSubBack.bind(service));
    scene.action(/back/, checkoutUserSubBack.bind(service));
    return scene;
}
