import dayjs from "@cryptuoso/dayjs";
import { gql } from "@cryptuoso/graphql-client";
import { chunkArray } from "@cryptuoso/helpers";
import { User, UserExchangeAccountInfo } from "@cryptuoso/user-state";
import { InlineKeyboard } from "grammy";
import { BotContext, IUserSub } from "../types";
import { Router } from "../utils/dialogsRouter";
import { getBackKeyboard } from "../utils/keyboard";
import { editExchangeAccActions } from "./editExchangeAcc";

export enum accountActions {
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

    const chunks = chunkArray(buttons, 2);

    for (const chunk of chunks) {
        keyboard = keyboard.row(...chunk);
    }

    return keyboard;
};

const getAccountInfo = async (ctx: BotContext) => {
    if (!ctx.session.userExAcc || !ctx.session.userSub || ctx.session.dialog.current?.data?.reload) {
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
                    myUserSubs: user_subs(
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
            `
        );

        if (myUser && Array.isArray(myUser) && myUser.length) {
            const [user] = myUser;
            ctx.session.user = { ...ctx.session.user, ...user };
        }
        if (myUserExAcc && Array.isArray(myUserExAcc) && myUserExAcc.length) {
            const [userExAcc] = myUserExAcc;
            ctx.session.userExAcc = userExAcc;
        }
        if (myUserSub && Array.isArray(myUserSub) && myUserSub.length) {
            const [userSub] = myUserSub;
            ctx.session.userSub = userSub;
        }
    }
};

const accountInfo = async (ctx: BotContext) => {
    await getAccountInfo(ctx);

    const edit = ctx.session.dialog.current.data.edit;
    if (!edit)
        await ctx.reply(ctx.i18n.t("keyboards.mainKeyboard.account"), {
            reply_markup: getBackKeyboard(ctx)
        });

    const { user, userExAcc, userSub } = ctx.session;

    const accountInfoText = `${ctx.i18n.t("dialogs.account.title")}${
        user.email ? ctx.i18n.t("dialogs.account.email", { email: user.email }) : ""
    }`;

    const exchangeAccText = userExAcc
        ? ctx.i18n.t("dialogs.exchangeAccount.info", {
              exchange: userExAcc.exchange,
              status: userExAcc.status,
              error: userExAcc.error,
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
            name: ctx.i18n.t("dialogs.userSub.freeSub.name"),
            option: "",
            description: ctx.i18n.t("dialogs.userSub.freeSub.description"),
            status: ctx.i18n.t(`userSubStatus.active`),
            expires: "",
            lastPayment: ""
        };
    }

    const userSubText = ctx.i18n.t("dialogs.userSub.info", currentSub);

    const text = `${accountInfoText}\n\n${exchangeAccText}\n\n${userSubText}`;

    const buttons = getAccountButtons(ctx);

    if (edit) {
        await ctx.editMessageText(text);
        await ctx.editMessageReplyMarkup({ reply_markup: buttons });
    } else {
        await ctx.reply(text, { reply_markup: buttons });
    }
    ctx.session.dialog.current.data.edit = true;
};

const notifications = async (ctx: BotContext) => {
    const { data } = ctx.session.dialog.current;

    let params;
    if (data.payload === true) {
        params = { tradingTelegram: true };
    } else if (data.payload === false) {
        params = { tradinTelegram: false };
    }

    if (params) {
        let error: string;
        let result;
        try {
            ({
                setNotificationSettings: { result }
            } = await ctx.gql.request(
                ctx,
                gql`
                    mutation SetNotificationSettings($tradingTelegram: Boolean) {
                        setNotificationSettings(tradingTelegram: $tradingTelegram) {
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
    if (ctx.session.userExAcc) {
        ctx.dialog.enter(editExchangeAccActions.enter);
    } else {
        ctx.dialog.enter(editExchangeAccActions.handler, {
            exchange: ctx.session.userExAcc.exchange,
            scene: "key",
            expectInput: true
        });
    }
};

const router: Router = new Map();

router.set(accountActions.enter, accountInfo);
router.set(accountActions.notifications, notifications);
router.set(accountActions.checkExAcc, checkExchangeAccount);
router.set(accountActions.editExAcc, editExchangeAccount);

export const account = {
    name: "account",
    router
};
