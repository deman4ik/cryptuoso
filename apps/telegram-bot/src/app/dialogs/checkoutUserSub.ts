import dayjs from "@cryptuoso/dayjs";
import { gql } from "@cryptuoso/graphql-client";
import logger from "@cryptuoso/logger";
import { InlineKeyboard } from "grammy";
import { BotContext, IUserPayment } from "../types";
import { Router } from "../utils/dialogsRouter";
import { accountActions } from "./account";

export const enum checkoutUserSubActions {
    enter = "chUSub:enter",
    check = "chUSub:check"
}

const getCheckoutUserSubButtons = (ctx: BotContext) => {
    const buttons = [];

    const { userPayment } = ctx.session.dialog.current.data;
    if (["RESOLVED", "EXPIRED", "CANCELED"].includes(userPayment.status))
        buttons.push({
            text: ctx.i18n.t("dialogs.checkoutUserSub.check"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: checkoutUserSubActions.check,
                p: true
            })
        });
    buttons.push({
        text: ctx.i18n.t("keyboards.backKeyboard.back"),
        callback_data: JSON.stringify({
            d: ctx.session.dialog.current?.id || null,
            a: "back",
            p: true
        })
    });
    let keyboard = new InlineKeyboard();

    keyboard = keyboard.row(...buttons);

    return keyboard;
};

const enter = async (ctx: BotContext) => {
    const { userSub } = ctx.session;

    const {
        checkoutUserSub: { userPayment }
    }: {
        checkoutUserSub: {
            userPayment: IUserPayment;
        };
    } = await ctx.gql.request(
        ctx,
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
        }
    );

    ctx.session.dialog.current.data.userPayment = userPayment;

    await ctx.reply(
        ctx.i18n.t("dialogs.checkoutUserSub.info", {
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
        { reply_markup: getCheckoutUserSubButtons(ctx) }
    );
};

const check = async (ctx: BotContext) => {
    const { userPayment: oldUserPayment } = ctx.session.dialog.current.data;
    const { userSub } = ctx.session;
    const {
        checkPayment: { userPayment }
    }: {
        checkPayment: {
            userPayment: IUserPayment;
        };
    } = await ctx.gql.request(
        ctx,
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
        { chargeId: oldUserPayment.id, provider: "coinbase.commerce" }
    );
    ctx.session.dialog.current.data.userPayment = userPayment;

    await ctx.dialog.edit();
    await ctx.reply(
        ctx.i18n.t("dialogs.checkoutUserSub.info", {
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
        { reply_markup: getCheckoutUserSubButtons(ctx) }
    );
};

const router: Router = new Map();

router.set(checkoutUserSubActions.enter, enter);
router.set(checkoutUserSubActions.check, check);

export const checkoutUserSub = {
    name: "checkoutUserSub",
    router
};
