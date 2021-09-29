import { sortAsc } from "@cryptuoso/helpers";
import { InlineKeyboard } from "grammy";
import { BotContext, ISubscription } from "../types";
import { Router } from "../utils/dialogsRouter";
import { gql } from "../utils/graphql-client";

export enum createUserSubActions {
    enter = "crUSub:enter",
    option = "crUSub:option"
}

const getCreateUserSubButtons = (ctx: BotContext) => {
    const { userSub } = ctx.session;
    const { sub } = ctx.session.dialog.current.data as { sub: ISubscription };
    const buttons = [
        ...sub.options
            .filter((o) => o.code !== userSub?.subscriptionOption?.code)
            .sort((a, b) => sortAsc(a.sort_order, b.sort_order))
            .map((option) => ({
                text: `${option.name} - ${option.price_total}$${
                    userSub ? "" : ctx.i18n.t("dialogs.createUserSub.trial")
                }`,
                callback_data: JSON.stringify({
                    d: ctx.session.dialog.current?.id || null,
                    a: createUserSubActions.option,
                    p: option.code
                })
            }))
    ];

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
    const {
        subscriptions
    }: {
        subscriptions: ISubscription[];
    } = await ctx.gql.request(
        ctx,
        gql`
            query subscriptions($available: Int!) {
                subscriptions(
                    where: { available: { _gte: $available } }
                    order_by: { created_at: asc_nulls_last }
                    limit: 1
                ) {
                    id
                    name
                    description
                    options: subscription_options(where: { available: { _gte: $available } }) {
                        code
                        name
                        sort_order
                        price_month
                        price_total
                        discount
                        highlight
                    }
                }
            }
        `,
        { available: ctx.session.user.access }
    );

    const [sub] = subscriptions;
    ctx.session.dialog.current.data.sub = sub;

    const { userSub } = ctx.session.dialog.current.data;

    const options = sub.options
        .sort((a, b) => sortAsc(a.sort_order, b.sort_order))
        .map((option) =>
            ctx.i18n.t("dialogs.createUserSub.option", {
                highlight: option.highlight ? " 🆒" : "",
                highlightEnd: option.highlight ? "</b> " : "",
                name: option.name,
                priceTotal: option.price_total,
                discount: option.discount ? ` (${option.price_month}$ per month) <b>-${option.discount}%</b>` : "",
                subscribed: userSub && option.code === userSub?.subscriptionOption?.code ? " ✅" : ""
            })
        )
        .join("\n");

    await ctx.reply(
        ctx.i18n.t("dialogs.createUserSub.info", {
            name: sub.name,
            description: sub.description,
            options
        }),
        { reply_markup: getCreateUserSubButtons(ctx) }
    );
};

const option = async (ctx: BotContext) => {
    const { userSub } = ctx.session;
    const { sub, payload: option } = ctx.session.dialog.current.data;

    let error;
    let id;
    try {
        ({
            createUserSub: { id }
        } = await ctx.gql.request(
            ctx,
            gql`
                mutation createUserSub($subscriptionId: uuid!, $subscriptionOption: String!) {
                    createUserSub(subscriptionId: $subscriptionId, subscriptionOption: $subscriptionOption) {
                        id
                    }
                }
            `,
            { subscriptionId: sub.id, subscriptionOption: option }
        ));
    } catch (err) {
        error = err.message;
    }

    if (error) {
        await ctx.reply(
            ctx.i18n.t("dialogscreateUserSub.failed", {
                name: userSub.subscription.name,
                error
            })
        );
    }

    if (id) {
        await ctx.reply(ctx.i18n.t("dialogs.createUserSub.success"));
    }
    ctx.dialog.return({ reload: true });
};

const router: Router = new Map();

router.set(createUserSubActions.enter, enter);
router.set(createUserSubActions.option, option);

export const createUserSub = {
    name: "createUserSub",
    router
};
