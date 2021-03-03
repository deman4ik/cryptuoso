import { gql } from "@cryptuoso/graphql-client";
import { sortAsc } from "@cryptuoso/helpers";
import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { match } from "@edjopato/telegraf-i18n";
import { ISubscription, IUserSub, TelegramScene } from "../types";
import { addBaseActions } from "./default";
import { GA } from "@cryptuoso/analytics";

function getCreateUserSubMenu(ctx: any) {
    const { userSub, sub }: { userSub?: IUserSub; sub: ISubscription } = ctx.scene.state;
    return Extra.HTML().markup((m: any) => {
        const buttons = [
            ...sub.options
                .sort((a, b) => sortAsc(a.sort_order, b.sort_order))
                .map((option) => [
                    m.callbackButton(
                        `${option.name} - ${option.price_total}$${
                            userSub ? "" : ctx.i18n.t("scenes.createUserSub.trial")
                        }`,
                        JSON.stringify({ a: "option", p: option.code }),
                        userSub && option.code === userSub?.subscriptionOption?.code
                    )
                ]),
            [m.callbackButton(ctx.i18n.t("keyboards.backKeyboard.back"), JSON.stringify({ a: "back" }), false)]
        ];

        return m.inlineKeyboard(buttons);
    });
}

async function createUserSubEnter(ctx: any) {
    try {
        GA.view(ctx.session.user.id, TelegramScene.CREATE_USER_SUB);
        const {
            subscriptions
        }: {
            subscriptions: ISubscription[];
        } = await this.gqlClient.request(
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
            { available: ctx.session.user.access },
            ctx
        );

        const [sub] = subscriptions;
        ctx.scene.state.sub = sub;
        const { userSub }: { userSub: IUserSub } = ctx.scene.state;

        const options = sub.options
            .sort((a, b) => sortAsc(a.sort_order, b.sort_order))
            .map((option) =>
                ctx.i18n.t("scenes.createUserSub.option", {
                    highlight: option.highlight ? " 🆒" : "",
                    highlightEnd: option.highlight ? "</b> " : "",
                    name: option.name,
                    priceTotal: option.price_total,
                    discount: option.discount ? ` (${option.price_month}$ per month) <b>-${option.discount}%</b>` : "",
                    subscribed: userSub && option.code === userSub?.subscriptionOption?.code ? " ✅" : ""
                })
            )
            .join("\n");

        return ctx.reply(
            ctx.i18n.t("scenes.createUserSub.info", {
                name: sub.name,
                description: sub.description,
                options
            }),
            getCreateUserSubMenu(ctx)
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function createUserSubConfirm(ctx: any) {
    try {
        const { userSub, sub }: { userSub: IUserSub; sub: ISubscription } = ctx.scene.state;
        const { p: option } = JSON.parse(ctx.callbackQuery.data);
        let error;
        let id;
        try {
            ({
                createUserSub: { id }
            } = await this.gqlClient.request(
                gql`
                    mutation createUserSub($subscriptionId: uuid!, $subscriptionOption: String!) {
                        createUserSub(subscriptionId: $subscriptionId, subscriptionOption: $subscriptionOption) {
                            id
                        }
                    }
                `,
                { subscriptionId: sub.id, subscriptionOption: option },
                ctx
            ));
        } catch (err) {
            error = err.message;
        }

        if (error) {
            await ctx.reply(
                ctx.i18n.t("scenes.createUserSub.failed", {
                    name: userSub.subscription.name,
                    error
                }),
                Extra.HTML()
            );
            return createUserSubBack.call(this, ctx);
        }

        if (id) {
            await ctx.reply(ctx.i18n.t("scenes.createUserSub.success"), Extra.HTML());
        }
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function createUserSubBack(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(ctx.scene.state.prevScene, {
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

export function createUserSubScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.CREATE_USER_SUB);
    scene.enter(createUserSubEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/option/, createUserSubConfirm.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), createUserSubBack.bind(service));
    scene.command("back", createUserSubBack.bind(service));
    scene.action(/back/, createUserSubBack.bind(service));
    return scene;
}
