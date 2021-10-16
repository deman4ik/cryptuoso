import { round } from "@cryptuoso/helpers";
import logger from "@cryptuoso/logger";
import { UserExchangeAccountInfo } from "@cryptuoso/user-state";
import { InlineKeyboard } from "grammy";
import { BotContext, IUserSub } from "../types";
import { getAmountTypeButtons, getPercentButtons } from "../utils/buttons";
import { Router } from "../utils/dialogsRouter";
import { gql } from "../utils/graphql-client";
import { account, accountActions } from "./account";
import { createUserSubActions } from "./createUserSub";
import { editExchangeAccActions } from "./editExchangeAcc";
import { tradingActions } from "./trading";

export const enum addPortfolioActions {
    enter = "aPf:enter",
    amountType = "aPf:amType",
    initBalance = "aPf:initBal",
    handleInitBalance = "aPf:hIBal",
    amount = "aPf:amount",
    handleAmount = "aPf:hAmount",
    finish = "aPf:finish",
    start = "aPf:start"
}

const getTypeButtons = (ctx: BotContext) => {
    return new InlineKeyboard()
        .add({
            text: ctx.i18n.t("dialogs.addPortfolio.automated"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: addPortfolioActions.amountType,
                p: "trading"
            })
        })
        .row()
        .add({
            text: ctx.i18n.t("dialogs.addPortfolio.manual"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: addPortfolioActions.initBalance,
                p: "signals"
            })
        });
};

const chooseType = async (ctx: BotContext) => {
    await ctx.dialog.edit();
    await ctx.reply(ctx.i18n.t("dialogs.addPortfolio.type"), { reply_markup: getTypeButtons(ctx) });

    ctx.session.dialog.current.data.edit = true;
};

const initBalance = async (ctx: BotContext) => {
    const { data } = ctx.session.dialog.current;
    if (!ctx.session.dialog.current.data.type) ctx.session.dialog.current.data.type = data.payload;
    ctx.session.dialog.current.data.edit = false;
    ctx.session.dialog.current.data.expectInput = true;
    ctx.dialog.next(addPortfolioActions.handleInitBalance);
    await ctx.reply(ctx.i18n.t("dialogs.addPortfolio.initBalance"));
};

const handleInitBalance = async (ctx: BotContext) => {
    let balance = parseFloat(ctx.session.dialog.current.data.payload);
    let error;
    if (isNaN(balance)) error = ctx.i18n.t("dialogs.addPortfolio.invalidInput");
    balance = round(balance);
    if (balance < ctx.session.dialog.current.data.minBalance)
        error = ctx.i18n.t("dialogs.addPortfolio.insufficientInitBalance", {
            minBalance: ctx.session.dialog.current.data.minBalance
        });

    if (error) {
        await ctx.reply(error);
        ctx.dialog.jump(addPortfolioActions.initBalance);
        return;
    }

    ctx.session.dialog.current.data.initialBalance = round(balance);
    ctx.session.dialog.current.data.amountType = "balancePercent";
    ctx.session.dialog.current.data.balancePercent = 100;
    ctx.dialog.jump(addPortfolioActions.finish);
};

const amountType = async (ctx: BotContext) => {
    const { data } = ctx.session.dialog.current;
    if (!ctx.session.dialog.current.data.type) ctx.session.dialog.current.data.type = data.payload;

    if (!ctx.session.userSub || !ctx.session.userExAcc || data.reload) {
        const { myUserExAcc, myUserSub } = await ctx.gql.request<{
            myUserExAcc: UserExchangeAccountInfo[];
            myUserSub: IUserSub[];
        }>(
            ctx,
            gql`
                query user_ex_acc($userId: uuid!) {
                    myUserExAcc: v_user_exchange_accs(
                        where: { user_id: { _eq: $userId } }
                        limit: 1
                        order_by: { created_at: desc }
                    ) {
                        id
                        exchange
                        name
                        status
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

        if (!myUserSub || !Array.isArray(myUserSub) || !myUserSub.length) {
            ctx.dialog.enter(createUserSubActions.enter);
            return;
        } else {
            const [userSub] = myUserSub;

            if (userSub.status !== "active" && userSub.status !== "trial") {
                await ctx.reply(ctx.i18n.t("userSubscription.notActive"));
                ctx.dialog.enter(accountActions.enter);
            }
        }

        if (!myUserExAcc || !Array.isArray(myUserExAcc) || !myUserExAcc.length) {
            ctx.dialog.enter(editExchangeAccActions.handler, {
                exchange: data.exchange,
                scene: "exchange",
                expectInput: true
            });
            return;
        }

        const [userExAcc] = myUserExAcc;
        ctx.session.userExAcc = userExAcc;
    }

    if (ctx.session.userExAcc.balance < data.minBalance) {
        await ctx.reply(
            ctx.i18n.t("dialogs.addPortfolio.insufficient", {
                currentBalance: ctx.session.userExAcc.balance,
                minBalance: data.minBalance,
                exchange: data.exchange
            })
        );
        ctx.dialog.reset();
        return;
    }

    const text = ctx.i18n.t("dialogs.addPortfolio.amountType", {
        balance: ctx.session.userExAcc.balance
    });
    ctx.dialog.next(addPortfolioActions.amount);
    const buttons = getAmountTypeButtons(ctx);

    await ctx.dialog.edit();
    await ctx.reply(text, { reply_markup: buttons });
    ctx.session.dialog.current.data.edit = true;
};

const amount = async (ctx: BotContext) => {
    const { data } = ctx.session.dialog.current;
    if (!ctx.session.dialog.current.data.amountType) ctx.session.dialog.current.data.amountType = data.payload;
    const amountType = ctx.session.dialog.current.data.amountType;

    if (amountType === "fullBalance") {
        ctx.session.dialog.current.data.amountType = "balancePercent";
        ctx.session.dialog.current.data.balancePercent = 100;
        ctx.dialog.jump(addPortfolioActions.finish);
        return;
    } else if (amountType === "balancePercent") {
        ctx.session.dialog.current.data.amountType = "balancePercent";
        ctx.dialog.next(addPortfolioActions.handleAmount);
        const text = ctx.i18n.t("dialogs.addPortfolio.amountTypePercent");
        const buttons = getPercentButtons(ctx);
        ctx.session.dialog.current.data.expectInput = true;

        await ctx.dialog.edit();
        await ctx.reply(text, { reply_markup: buttons });
    } else if (amountType === "currencyFixed") {
        ctx.session.dialog.current.data.amountType = "currencyFixed";
        ctx.session.dialog.current.data.expectInput = true;
        ctx.dialog.next(addPortfolioActions.handleAmount);
        await ctx.reply(ctx.i18n.t("dialogs.addPortfolio.amountTypeCurrency"));
    }
    ctx.session.dialog.current.data.edit = false;
};

const handleAmount = async (ctx: BotContext) => {
    const { data } = ctx.session.dialog.current;
    const amount = parseFloat(data.payload);
    let error;
    if (isNaN(amount)) error = ctx.i18n.t("dialogs.addPortfolio.invalidInput");

    if (data.amountType === "balancePercent") {
        const percent = round(amount);
        if (percent < 1 || percent > 100) error = ctx.i18n.t("dialogs.addPortfolio.invalidPercent");
        else {
            ctx.session.dialog.current.data.balancePercent = percent;
        }
    } else if (data.amountType === "currencyFixed") {
        const amountCurrency = round(amount);
        if (ctx.session.userExAcc.balance < amountCurrency)
            error = ctx.i18n.t("dialogs.addPortfolio.invalidFixedAmount");
        else if (data.minBalance > amountCurrency)
            error = ctx.i18n.t("dialogs.addPortfolio.invalidFixedAmount", { minBalance: data.minBalance });
        else {
            ctx.session.dialog.current.data.tradingAmountCurrency = round(amountCurrency);
        }
    }

    if (error) {
        ctx.session.dialog.current.data.edit = false;
        ctx.reply(error);
        ctx.dialog.jump(addPortfolioActions.amount);
        return;
    }
    ctx.dialog.jump(addPortfolioActions.finish);
};

const finish = async (ctx: BotContext) => {
    const {
        exchange,
        selectedOptions: options,
        type,
        amountType,
        balancePercent,
        tradingAmountCurrency,
        initialBalance
    } = ctx.session.dialog.current.data as {
        exchange: string;
        selectedOptions: string[];
        type: string;
        amountType: string;
        balancePercent: number;
        tradingAmountCurrency: number;
        initialBalance: number;
    };

    let error;
    let result;
    await ctx.reply(ctx.i18n.t("dialogs.addPortfolio.progress"));
    try {
        ({
            createUserPortfolio: { result }
        } = await ctx.gql.request<{ createUserPortfolio: { result: string } }>(
            ctx,
            gql`
                mutation (
                    $exchange: String!
                    $type: String!
                    $userExAccId: uuid
                    $tradingAmountType: String!
                    $balancePercent: Int
                    $tradingAmountCurrency: Int
                    $initialBalance: numeric
                    $options: PortfolioOptions
                ) {
                    createUserPortfolio(
                        exchange: $exchange
                        type: $type
                        userExAccId: $userExAccId
                        tradingAmountType: $tradingAmountType
                        balancePercent: $balancePercent
                        tradingAmountCurrency: $tradingAmountCurrency
                        initialBalance: $initialBalance
                        options: $options
                    ) {
                        result
                    }
                }
            `,
            {
                exchange,
                userExAccId: ctx.session.userExAcc.id,
                options: ctx.catalog.options.reduce((prev, cur) => ({ ...prev, [cur]: options.includes(cur) }), {}),
                type,
                tradingAmountType: amountType,
                balancePercent,
                tradingAmountCurrency,
                initialBalance
            }
        ));
    } catch (err) {
        error = err.message;
    }

    if (error) {
        await ctx.reply(
            ctx.i18n.t("dialogs.addPortfolio.failed", {
                error
            })
        );
        ctx.dialog.reset();
    }
    if (result) {
        ctx.session.dialog.current.data.userPortfolioId = result;
        ctx.session.dialog.current.data.return = true;

        await ctx.reply(
            ctx.i18n.t("dialogs.addPortfolio.created", {
                exchange: ctx.session.dialog.current.data.exchange,
                options: options
                    .map((o) => `✅ <b>${ctx.i18n.t(`options.${o}`)}</b> - <i>${ctx.i18n.t(`options.info.${o}`)}</i>`)
                    .join("\n "),
                initialBalance,
                amount: balancePercent || tradingAmountCurrency,
                amountType:
                    amountType === "balancePercent"
                        ? ctx.i18n.t("dialogs.addPortfolio.ofBalance")
                        : ctx.i18n.t("dialogs.addPortfolio.fixedCurrency"),
                warning: type === "trading" ? ctx.i18n.t("warning") : ""
            })
        );
        ctx.dialog.reset();
    }
};
const router: Router = new Map();
router.set(addPortfolioActions.enter, chooseType);
router.set(addPortfolioActions.amountType, amountType);
router.set(addPortfolioActions.initBalance, initBalance);
router.set(addPortfolioActions.handleInitBalance, handleInitBalance);
router.set(addPortfolioActions.amount, amount);
router.set(addPortfolioActions.handleAmount, handleAmount);
router.set(addPortfolioActions.finish, finish);

export const addPortfolio = {
    name: "addPortfolio",
    router
};
