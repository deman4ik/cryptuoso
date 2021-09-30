import dayjs from "@cryptuoso/dayjs";
import { InlineKeyboard } from "grammy";
import { BotContext, IUserPayment } from "../types";
import { Router } from "../utils/dialogsRouter";
import { gql } from "../utils/graphql-client";

export const enum paymentHistoryActions {
    enter = "payHist:enter"
}

const enter = async (ctx: BotContext) => {
    const {
        userPayments
    }: {
        userPayments: IUserPayment[];
    } = await ctx.gql.request(
        ctx,
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
        { userId: ctx.session.user.id }
    );

    let message;
    if (!userPayments?.length) message = ctx.i18n.t("dialogs.paymentHistory.none");
    else
        message = userPayments
            .map((payment) =>
                ctx.i18n.t("dialogs.paymentHistory.charge", {
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

    const text = ctx.i18n.t("dialogs.paymentHistory.info", { history: message });
    const buttons = {
        reply_markup: new InlineKeyboard().add({
            text: ctx.i18n.t("keyboards.backKeyboard.back"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: "back",
                p: true
            })
        })
    };
    await ctx.dialog.edit();
    await ctx.reply(text, buttons);
};

const router: Router = new Map();
router.set(paymentHistoryActions.enter, enter);

export const paymentHistory = {
    name: "paymentHistory",
    router
};
