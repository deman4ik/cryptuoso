import { gql } from "@cryptuoso/graphql-client";
import { sleep } from "@cryptuoso/helpers";
import { BaseService } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { BaseScene, Extra } from "telegraf";
import { getBackKeyboard } from "../keyboard";
import { IUserSub, TelegramScene } from "../types";
import { addBaseActions } from "./default";
import { GA } from "@cryptuoso/analytics";

function getUserSubMenu(ctx: any) {
    const { userSub } = ctx.scene.state;
    return Extra.HTML().markup((m: any) => {
        const buttons = [
            [m.callbackButton(ctx.i18n.t("scenes.userSub.checkout"), JSON.stringify({ a: "checkout" }), !userSub)],
            [m.callbackButton(ctx.i18n.t("scenes.userSub.history"), JSON.stringify({ a: "history" }), false)],
            [
                m.callbackButton(
                    userSub ? ctx.i18n.t("scenes.userSub.changePlan") : ctx.i18n.t("scenes.userSub.startTrial"),
                    JSON.stringify({ a: "changePlan" }),
                    false
                )
            ],
            [m.callbackButton(ctx.i18n.t("scenes.userSub.cancel"), JSON.stringify({ a: "cancel" }), !userSub)],
            [m.callbackButton(ctx.i18n.t("keyboards.backKeyboard.back"), JSON.stringify({ a: "back" }), false)]
        ];

        return m.inlineKeyboard(buttons);
    });
}

async function userSubEnter(ctx: any) {
    try {
        GA.view(ctx.session.user.id, TelegramScene.USER_SUB);
        const {
            userSubs
        }: {
            userSubs: IUserSub[];
        } = await this.gqlClient.request(
            gql`
                query userSub($userId: uuid!) {
                    userSubs: user_subs(
                        where: { user_id: { _eq: $userId }, status: { _nin: ["canceled", "expired"] } }
                        order_by: { created_at: desc_nulls_last }
                        limit: 1
                    ) {
                        id
                        user_id
                        status
                        trial_started
                        trial_ended
                        active_from
                        active_to
                        subscription {
                            id
                            name
                            description
                        }
                        subscriptionOption {
                            code
                            name
                        }
                        userPayments: user_payments(order_by: { created_at: desc_nulls_last }, limit: 1) {
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
            { userId: ctx.session.user.id },
            ctx
        );

        let currentSub;
        if (userSubs && userSubs.length) {
            const [userSub] = userSubs;
            ctx.scene.state.userSub = userSub;
            const lastPayment = userSub.userPayments && userSub.userPayments.length && userSub.userPayments[0];
            let expires = "";
            if (userSub.status === "trial" && userSub.trial_ended)
                expires = `Expires in ${dayjs.utc().diff(userSub.trial_ended, "day")} days`;
            else if (userSub.status === "active" && userSub.active_to)
                expires = `Expires in ${dayjs.utc().diff(userSub.active_to, "day")} days`;
            currentSub = {
                name: userSub.subscription.name,
                option: userSub.subscriptionOption.name,
                description: userSub.subscription.description,
                status: ctx.i18n.t(`userSubStatus.${userSub.status}`),
                expires: expires,
                lastPayment: lastPayment
                    ? ctx.i18n.t("scenes.userSub.lastPayment", {
                          code: lastPayment.code,
                          status: ctx.i18n.t(`paymentStatus.${lastPayment.status}`),
                          price: lastPayment.price,
                          period: `${dayjs.utc(lastPayment.subscription_from).format("YYYY-MM-DD")} - ${dayjs
                              .utc(lastPayment.subscription_to)
                              .format("YYYY-MM-DD")}`
                      })
                    : ""
            };
        } else {
            currentSub = {
                name: ctx.i18n.t("freeSub.name"),
                option: ctx.i18n.t("freeSub.option"),
                description: ctx.i18n.t("freeSub.description"),
                status: ctx.i18n.t(`userSubStatus.active`),
                expires: ctx.i18n.t("freeSub.expires"),
                lastPayment: ""
            };
        }
        await ctx.reply(ctx.i18n.t("keyboards.mainKeyboard.subscription"), getBackKeyboard(ctx));
        await sleep(100);
        return ctx.reply(ctx.i18n.t("scenes.userSub.info", currentSub), getUserSubMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userSubChangePlan(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.CREATE_USER_SUB, {
            userSub: ctx.scene.state.userSub,
            prevScene: TelegramScene.USER_SUB,
            prevState: {
                ...ctx.scene.state,
                silent: false,
                reload: true,
                edit: false
            }
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        await ctx.scene.leave();
    }
}

async function userSubHistory(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.PAYMENT_HISTORY, {
            prevState: {
                ...ctx.scene.state,
                silent: false,
                reload: true,
                edit: false
            }
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        await ctx.scene.leave();
    }
}

async function userSubCheckout(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.CHECKOUT_USER_SUB, {
            userSub: ctx.scene.state.userSub,
            prevState: {
                ...ctx.scene.state,
                silent: false,
                reload: true,
                edit: false
            }
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        await ctx.scene.leave();
    }
}

async function userSubCancel(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.CANCEL_USER_SUB, {
            userSub: ctx.scene.state.userSub,
            prevState: {
                ...ctx.scene.state,
                silent: false,
                reload: true,
                edit: false
            }
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        await ctx.scene.leave();
    }
}

export function userSubScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.USER_SUB);
    scene.enter(userSubEnter.bind(service));
    addBaseActions(scene, service);
    scene.action(/changePlan/, userSubChangePlan.bind(service));
    scene.action(/history/, userSubHistory.bind(service));
    scene.action(/checkout/, userSubCheckout.bind(service));
    scene.action(/cancel/, userSubCancel.bind(service));
    return scene;
}
