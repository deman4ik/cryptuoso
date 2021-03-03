import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { IUserPayment, TelegramScene } from "../types";
import { addBaseActions } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { gql } from "@cryptuoso/graphql-client";
import dayjs from "@cryptuoso/dayjs";
import { GA } from "@cryptuoso/analytics";

function getPaymentHistoryMenu(ctx: any) {
    return Extra.HTML().markup((m: any) => {
        const buttons = [
            [m.callbackButton(ctx.i18n.t("keyboards.backKeyboard.back"), JSON.stringify({ a: "back" }), false)]
        ];

        return m.inlineKeyboard(buttons);
    });
}

async function paymentHistoryEnter(ctx: any) {
    try {
        GA.view(ctx.session.user.id, TelegramScene.PAYMENT_HISTORY);
        const {
            userPayments
        }: {
            userPayments: IUserPayment[];
        } = await this.gqlClient.request(
            gql`
                query userPayments($userId: uuid!) {
                    userPayments: user_payments(where: { user_id: { _eq: $userId } }) {
                        id
                        code
                        url
                        status
                        price
                        created_at
                        expires_at
                        subscription_from
                        subscription_to
                        userSub: user_sub {
                            subscriptionOption {
                                name
                            }
                            subscription {
                                name
                            }
                        }
                    }
                }
            `,
            { userId: ctx.session.user.id },
            ctx
        );
        let message;
        if (!userPayments?.length) message = ctx.i18n.t("scenes.paymentHistory.none");
        else
            message = userPayments
                .map((payment) =>
                    ctx.i18n.t("scenes.paymentHistory.charge", {
                        code: payment.url ? `<a href='${payment.url}'>${payment.code}</a>` : payment.code,
                        price: payment.price,
                        status: ctx.i18n.t(`paymentStatus.${payment.status}`),
                        created: dayjs.utc(payment.created_at).format("YYYY-MM-DD HH:mm UTC"),
                        expires: dayjs.utc(payment.expires_at).format("YYYY-MM-DD HH:mm UTC"),
                        subscription: `${payment.userSub.subscription.name} ${payment.userSub.subscriptionOption.name}`,
                        subscriptionPeriod: `${dayjs.utc(payment.subscription_from).format("YYYY-MM-DD")} - ${dayjs
                            .utc(payment.subscription_to)
                            .format("YYYY-MM-DD")}`
                    })
                )
                .join("\n");
        return ctx.reply(`${ctx.i18n.t("scenes.paymentHistory.info")}${message}`, getPaymentHistoryMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function paymentHistoryBack(ctx: any) {
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

export function paymentHistoryScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.PAYMENT_HISTORY);
    scene.enter(paymentHistoryEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.hears(match("keyboards.backKeyboard.back"), paymentHistoryBack.bind(service));
    scene.command("back", paymentHistoryBack.bind(service));
    scene.action(/back/, paymentHistoryBack.bind(service));
    return scene;
}
