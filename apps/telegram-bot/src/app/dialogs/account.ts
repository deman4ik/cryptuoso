import dayjs from "@cryptuoso/dayjs";
import { User, UserExchangeAccountInfo } from "@cryptuoso/user-state";
import { InlineKeyboard } from "grammy";
import { BotContext, IUserSub } from "../types";
import { Router } from "../utils/dialogsRouter";
import { getBackKeyboard } from "../utils/keyboard";
import { editExchangeAccActions } from "./editExchangeAcc";
import { checkoutUserSubActions } from "./checkoutUserSub";
import { createUserSubActions } from "./createUserSub";
import { paymentHistoryActions } from "./paymentHistory";
import { gql } from "../utils/graphql-client";

export const enum accountActions {
    enter = "a:enter",
    notifications = "a:notif",
    checkExAcc = "a:checkEA",
    editExAcc = "a:editEA",
    checkout = "a:checkout",
    paymentHistory = "a:payHist",
    changePlan = "a:chPlan"
}

const getAccountButtons = (ctx: BotContext) => {
    let keyboard = new InlineKeyboard();
    const buttons = [];
    const { user, userExAcc, userSub } = ctx.session;
    if (user.settings.notifications.trading.telegram) {
        buttons.push({
            text: ctx.i18n.t("dialogs.account.notifOn"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: accountActions.notifications,
                p: false
            })
        });
    } else {
        buttons.push({
            text: ctx.i18n.t("dialogs.account.notifOff"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: accountActions.notifications,
                p: true
            })
        });
    }

    if (!userExAcc) {
        buttons.push({
            text: ctx.i18n.t("dialogs.exchangeAccount.add"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: accountActions.editExAcc,
                p: "add"
            })
        });
    } else {
        buttons.push({
            text: ctx.i18n.t("dialogs.exchangeAccount.edit"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: accountActions.editExAcc,
                p: "edit"
            })
        });
        /*    buttons.push({
            text: ctx.i18n.t("dialogs.exchangeAccount.check"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: accountActions.checkExAcc,
                p: true
            })
        }); */ //TODO!
    }

    if (userSub) {
        buttons.push({
            text: ctx.i18n.t("dialogs.userSub.checkout"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: accountActions.checkout,
                p: true
            })
        });
        buttons.push({
            text: ctx.i18n.t("dialogs.userSub.history"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: accountActions.paymentHistory,
                p: true
            })
        });
        buttons.push({
            text: ctx.i18n.t("dialogs.userSub.changePlan"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: accountActions.changePlan,
                p: true
            })
        });
    } else {
        buttons.push({
            text: ctx.i18n.t("dialogs.userSub.startTrial"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: accountActions.changePlan,
                p: true
            })
        });
    }

    for (const button of buttons) {
        keyboard = keyboard.row(button);
    }
    return keyboard;
};

const getAccountInfo = async (ctx: BotContext) => {
    if (
        !ctx.session.userExAcc ||
        !ctx.session.userSub ||
        !ctx.session.updatedAt ||
        ctx.session.dialog.current?.data?.reload ||
        dayjs.utc().diff(dayjs.utc(ctx.session.updatedAt), "second") > 5
    ) {
        const { myUser, myUserExAcc, myUserSub } = await ctx.gql.request<{
            myUser: User[];
            myUserExAcc: UserExchangeAccountInfo[];
            myUserSub: IUserSub[];
        }>(
            ctx,
            gql`
                query accountInfo($userId: uuid!) {
                    myUser: users(where: { id: { _eq: $userId } }) {
                        id
                        email
                        name
                        telegramId: telegram_id
                        telegramUsername: telegram_username
                        roles
                        access
                        status
                        settings
                    }
                    myUserExAcc: v_user_exchange_accs(
                        where: { user_id: { _eq: $userId } }
                        limit: 1
                        order_by: { created_at: desc }
                    ) {
                        id
                        exchange
                        name
                        status
                        error
                        balance: total_balance_usd
                    }
                    myUserSub: user_subs(
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
            {
                userId: ctx.session.user.id
            }
        );

        if (myUser && Array.isArray(myUser) && myUser.length) {
            const [user] = myUser;
            ctx.session.user = { ...ctx.session.user, ...user };
        } else ctx.session.user = null;
        if (myUserExAcc && Array.isArray(myUserExAcc) && myUserExAcc.length) {
            const [userExAcc] = myUserExAcc;
            ctx.session.userExAcc = userExAcc;
        } else ctx.session.userExAcc = null;
        if (myUserSub && Array.isArray(myUserSub) && myUserSub.length) {
            const [userSub] = myUserSub;
            ctx.session.userSub = userSub;
        } else ctx.session.userSub = null;
        ctx.session.updatedAt = dayjs.utc().toISOString();
    }
};

const accountInfo = async (ctx: BotContext) => {
    await getAccountInfo(ctx);

    const edit = ctx.session.dialog.current.data.edit;
    if (!edit) await ctx.reply(ctx.i18n.t("keyboards.mainKeyboard.account"), getBackKeyboard(ctx));

    const { user, userExAcc, userSub } = ctx.session;

    const accountInfoText = `${ctx.i18n.t("dialogs.account.title")}${
        user.email ? ctx.i18n.t("dialogs.account.email", { email: user.email }) : ""
    }`;

    const exchangeAccText = userExAcc
        ? ctx.i18n.t("dialogs.exchangeAccount.info", {
              exchange: userExAcc.exchange,
              status: ctx.i18n.t(`userExAccStatus.${userExAcc.status}`),
              error: userExAcc.error || "",
              balance: userExAcc.balance
          })
        : ctx.i18n.t("dialogs.exchangeAccount.notSet");

    let currentSub;
    if (userSub) {
        const lastPayment = userSub.userPayments && userSub.userPayments.length && userSub.userPayments[0];
        let expires = "";
        if (userSub.status === "trial" && userSub.trial_ended)
            expires = ctx.i18n.t("dialogs.userSub.expires", { expireTo: dayjs.utc().to(userSub.trial_ended) });
        else if (userSub.status === "active" && userSub.active_to)
            expires = ctx.i18n.t("dialogs.userSub.expires", { expireTo: dayjs.utc().to(userSub.active_to) });
        currentSub = {
            name: userSub.subscription.name,
            option: userSub.subscriptionOption.name,
            description: userSub.subscription.description,
            status: ctx.i18n.t(`userSubStatus.${userSub.status}`),
            expires: expires,
            lastPayment: lastPayment
                ? ctx.i18n.t("dialogs.userSub.lastPayment", {
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
            name: ctx.i18n.t("dialogs.userSub.freeSub.name"),
            option: "",
            description: ctx.i18n.t("dialogs.userSub.freeSub.description", { n: "" }),
            status: ctx.i18n.t(`userSubStatus.active`),
            expires: "",
            lastPayment: ""
        };
    }

    const userSubText = ctx.i18n.t("dialogs.userSub.info", currentSub);

    const text = `${accountInfoText}${exchangeAccText}\n\n${userSubText}${ctx.i18n.t("lastInfoUpdatedAt", {
        lastInfoUpdatedAt: ctx.session.updatedAt
    })}`;

    const buttons = getAccountButtons(ctx);

    await ctx.dialog.edit();
    await ctx.reply(text, { reply_markup: buttons });

    ctx.session.dialog.current.data.edit = true;
};

const notifications = async (ctx: BotContext) => {
    const { data } = ctx.session.dialog.current;

    let params;
    if (data.payload === true) {
        params = { tradingTelegram: true };
    } else if (data.payload === false) {
        params = { tradingTelegram: false };
    }

    if (params) {
        let error: string;
        let result;
        try {
            ({
                userSetNotificationSettings: { result }
            } = await ctx.gql.request(
                ctx,
                gql`
                    mutation userSetNotificationSettings($tradingTelegram: Boolean) {
                        userSetNotificationSettings(tradingTelegram: $tradingTelegram) {
                            result
                        }
                    }
                `,
                params
            ));
        } catch (err) {
            error = err.message;
        }

        if (error) {
            await ctx.reply(
                ctx.i18n.t("failed", {
                    error
                })
            );
            ctx.dialog.reset();
        }

        if (result) {
            ctx.session.dialog.current.data.reload = true;
            ctx.session.dialog.current.data.edit = true;
            ctx.dialog.jump(accountActions.enter);
        }
    }
};

const checkExchangeAccount = async (ctx: BotContext) => {
    //TODO:
    await ctx.reply("Coming soon");
};

const editExchangeAccount = async (ctx: BotContext) => {
    if (!ctx.session.userExAcc) {
        ctx.dialog.enter(editExchangeAccActions.enter, {
            edit: false,
            backAction: accountActions.enter,
            backData: { edit: false, reload: true }
        });
    } else {
        ctx.dialog.enter(editExchangeAccActions.handler, {
            edit: false,
            exchange: ctx.session.userExAcc.exchange,
            scene: "exchange",
            expectInput: true,
            backAction: accountActions.enter,
            backData: { edit: false, reload: true }
        });
    }
};

const checkout = async (ctx: BotContext) => {
    ctx.dialog.enter(checkoutUserSubActions.enter, {
        edit: true,
        backAction: accountActions.enter,
        backData: { edit: true, reload: true }
    });
};

const paymentHistory = async (ctx: BotContext) => {
    ctx.dialog.enter(paymentHistoryActions.enter, {
        edit: true,
        backAction: accountActions.enter,
        backData: { edit: true, reload: true }
    });
};

const changePlan = async (ctx: BotContext) => {
    ctx.dialog.enter(createUserSubActions.enter, {
        edit: true,
        backAction: accountActions.enter,
        backData: { edit: true, reload: true }
    });
};

const router: Router = new Map();

router.set(accountActions.enter, accountInfo);
router.set(accountActions.notifications, notifications);
router.set(accountActions.checkExAcc, checkExchangeAccount);
router.set(accountActions.editExAcc, editExchangeAccount);
router.set(accountActions.checkout, checkout);
router.set(accountActions.paymentHistory, paymentHistory);
router.set(accountActions.changePlan, changePlan);

export const account = {
    name: "account",
    router
};
