import { round } from "@cryptuoso/helpers";
import { UserExchangeAccountInfo } from "@cryptuoso/user-state";
import { InlineKeyboard } from "grammy";
import { BotContext, IUserSub } from "../types";
import { getOptionsButtons } from "../utils/buttons";
import { Router } from "../utils/dialogsRouter";
import { gql } from "../utils/graphql-client";
import { createUserSubActions } from "./createUserSub";
import { editExchangeAccActions } from "./editExchangeAcc";
import { tradingActions } from "./trading";

export enum editPortfolioActions {
    enter = "ePf:enter",
    amountType = "ePf:amType",
    initBalance = "ePf:initBal",
    handleInitBalance = "ePf:hIBal",
    amount = "ePf:amount",
    handleAmount = "ePf:hAmount",
    finish = "ePf:finish",
    options = "ePf:opts",
    optionsChosen = "ePf:optsCh"
}

const getTypeButtons = (ctx: BotContext) => {
    return new InlineKeyboard()
        .add({
            text: ctx.i18n.t("dialogs.editPortfolio.automated"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: editPortfolioActions.amountType,
                p: "trading"
            })
        })
        .row()
        .add({
            text: ctx.i18n.t("dialogs.editPortfolio.manual"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: editPortfolioActions.initBalance,
                p: "signals"
            })
        });
};

const getAmountTypeButtons = (ctx: BotContext) => {
    return new InlineKeyboard()
        .add({
            text: ctx.i18n.t("dialogs.editPortfolio.fullBalance"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: editPortfolioActions.amount,
                p: "fullBalance"
            })
        })
        .row()
        .add({
            text: ctx.i18n.t("dialogs.editPortfolio.balancePercent"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: editPortfolioActions.amount,
                p: "balancePercent"
            })
        })
        .row()
        .add({
            text: ctx.i18n.t("dialogs.editPortfolio.currencyFixed"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: editPortfolioActions.amount,
                p: "currencyFixed"
            })
        });
};

const getPercentButtons = (ctx: BotContext) => {
    return new InlineKeyboard()
        .add({
            text: "10%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: editPortfolioActions.finish,
                p: 10
            })
        })
        .add({
            text: "20%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: editPortfolioActions.finish,
                p: 20
            })
        })
        .add({
            text: "30%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: editPortfolioActions.finish,
                p: 30
            })
        })
        .row()
        .add({
            text: "40%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: editPortfolioActions.finish,
                p: 40
            })
        })
        .add({
            text: "50%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: editPortfolioActions.finish,
                p: 50
            })
        })
        .add({
            text: "60%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: editPortfolioActions.finish,
                p: 60
            })
        })
        .row()
        .add({
            text: "70%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: editPortfolioActions.finish,
                p: 70
            })
        })
        .add({
            text: "80%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: editPortfolioActions.finish,
                p: 80
            })
        })
        .add({
            text: "90%",
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: editPortfolioActions.finish,
                p: 90
            })
        });
};

const getCreatedButtons = (ctx: BotContext) => {
    return new InlineKeyboard()
        .add({
            text: ctx.i18n.t("dialogs.editPortfolio.start"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: tradingActions.start,
                p: "start"
            })
        })
        .row()
        .add({
            text: ctx.i18n.t("dialogs.editPortfolio.editOptions"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: editPortfolioActions.options,
                p: "options"
            })
        })
        .row()
        .add({
            text: ctx.i18n.t("dialogs.editPortfolio.editAmount"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: editPortfolioActions.amount,
                p: "amount"
            })
        });
};

const router: Router = new Map();

const chooseType = async (ctx: BotContext) => {
    ctx.session.dialog.current.data.edit = true;
    await ctx.reply(ctx.i18n.t("dialogs.editPortfolio.type"), { reply_markup: getTypeButtons(ctx) });
};

const initBalance = async (ctx: BotContext) => {
    ctx.session.dialog.current.data.edit = false;
    ctx.dialog.next(editPortfolioActions.handleInitBalance);
    await ctx.reply(ctx.i18n.t("dialogs.editPortfolio.initBalance"));
};

const handleBalance = async (ctx: BotContext) => {
    let balance = parseFloat(ctx.session.dialog.current.data.payload);
    let error;
    if (isNaN(balance)) error = ctx.i18n.t("dialogs.editPortfolio.invalidInput");
    balance = round(balance);
    if (balance < ctx.session.dialog.current.data.minBalance)
        error = ctx.i18n.t("dialogs.editPortfolio.insufficientInitBalance", {
            minBalance: ctx.session.dialog.current.data.minBalance
        });

    if (error) {
        await ctx.reply(error);
        ctx.dialog.jump(editPortfolioActions.initBalance);
        return;
    }

    ctx.session.dialog.current.data.initialBalance = round(balance);
    ctx.session.dialog.current.data.amountType = "balancePercent";
    ctx.session.dialog.current.data.balancePercent = 100;
    ctx.dialog.enter(editPortfolioActions.finish);
};

const chooseAmountType = async (ctx: BotContext) => {
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
            `,
            {
                userId: ctx.session.user.id
            }
        );

        if (!myUserSub || !Array.isArray(myUserSub) || !myUserSub.length) {
            ctx.dialog.enter(createUserSubActions.enter);
            return;
        }

        if (!myUserExAcc || !Array.isArray(myUserExAcc) || !myUserExAcc.length) {
            ctx.dialog.enter(editExchangeAccActions.handler, {
                exchange: data.exchange,
                scene: "key",
                expectInput: true
            });
            return;
        }

        const [userExAcc] = myUserExAcc;
        ctx.session.userExAcc = userExAcc;
        ctx.session.dialog.current.data.initialBalance = userExAcc.balance;
        ctx.session.dialog.current.data.userExAccId = userExAcc.id;
    }

    if (ctx.session.dialog.current.data.initialBalance < data.minBalance) {
        await ctx.reply(
            ctx.i18n.t("dialogs.editPortfolio.insufficient", {
                currentBalance: ctx.session.dialog.current.data.initialBalance,
                minBalance: data.minBalance,
                exchange: data.exchange
            })
        );
        ctx.dialog.reset();
        return;
    }

    const text = ctx.i18n.t("dialogs.editPortfolio.amountType", {
        balance: ctx.session.dialog.current.data.initialBalance
    });
    const buttons = getAmountTypeButtons(ctx);

    if (ctx.session.dialog.current.data.edit) {
        await ctx.editMessageText(text);
        await ctx.editMessageReplyMarkup({ reply_markup: buttons });
    } else await ctx.reply(text, { reply_markup: buttons });
    ctx.session.dialog.current.data.edit = true;
};

const setAmount = async (ctx: BotContext) => {
    const { data } = ctx.session.dialog.current;
    if (!ctx.session.dialog.current.data.amountType) ctx.session.dialog.current.data.amountType = data.payload;
    const amountType = ctx.session.dialog.current.data.amountType;

    if (amountType === "fullBalance") {
        ctx.session.dialog.current.data.amountType = "balancePercent";
        ctx.session.dialog.current.data.balancePercent = 100;
        ctx.dialog.jump(editPortfolioActions.finish);
        return;
    } else if (amountType === "balancePercent") {
        ctx.session.dialog.current.data.amountType = "balancePercent";

        const text = ctx.i18n.t("dialogs.editPortfolio.amountTypePercent");
        const buttons = getPercentButtons(ctx);
        if (ctx.session.dialog.current.data.edit) {
            await ctx.editMessageText(text);
            await ctx.editMessageReplyMarkup({ reply_markup: buttons });
        } else {
            await ctx.reply(text, { reply_markup: buttons });
        }
    } else if (amountType === "currencyFixed") {
        ctx.session.dialog.current.data.amountType = "currencyFixed";

        await ctx.reply(ctx.i18n.t("dialogs.editPortfolio.amountTypeCurrency"));
    }
    ctx.session.dialog.current.data.edit = false;
};

const handleAmount = async (ctx: BotContext) => {
    const { data } = ctx.session.dialog.current;
    const amount = parseFloat(data.payload);
    let error;
    if (isNaN(amount)) error = ctx.i18n.t("dialogs.editPortfolio.invalidInput");

    if (data.amountType === "balancePercent") {
        const percent = round(amount);
        if (percent < 1 || percent > 100) error = ctx.i18n.t("dialogs.editPortfolio.invalidPercent");
        else {
            ctx.session.dialog.current.data.balancePercent = percent;
        }
    } else if (data.amountType === "currencyFixed") {
        const amountCurrency = round(amount);
        if (ctx.session.userExAcc.balance < amountCurrency)
            error = ctx.i18n.t("dialogs.editPortfolio.invalidFixedAmount");
        else if (data.minBalance > amountCurrency)
            error = ctx.i18n.t("dialogs.editPortfolio.invalidFixedAmount", { minBalance: data.minBalance });
        else {
            ctx.session.dialog.current.data.tradingAmountCurrency = round(amountCurrency);
        }
    }

    if (error) {
        ctx.session.dialog.current.data.edit = false;
        ctx.reply(error);
        ctx.dialog.jump(editPortfolioActions.amount);
        return;
    }

    if (data.return) ctx.dialog.enter(tradingActions.enter, { reload: true, edit: false });
    else ctx.dialog.jump(editPortfolioActions.finish);
};

const finish = async (ctx: BotContext) => {
    const {
        exchange,
        userExAccId,
        selectedOptions: options,
        type,
        amountType,
        balancePercent,
        tradingAmountCurrency,
        initialBalance
    } = ctx.session.dialog.current.data as {
        exchange: string;
        userExAccId: string;
        selectedOptions: string[];
        type: string;
        amountType: string;
        balancePercent: number;
        tradingAmountCurrency: number;
        initialBalance: number;
    };

    let error;
    let result;
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
                userExAccId,
                options: ctx.catalog.options.reduce((prev, cur) => ({ ...prev, [cur]: options.includes(cur) }), {}),
                type,
                amountType,
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
            ctx.i18n.t("dialogs.editPortfolio.failed", {
                error
            })
        );
        ctx.dialog.reset();
    }
    if (result) {
        ctx.session.dialog.current.data.userPortfolioId = result;
        ctx.session.dialog.current.data.return = true;

        await ctx.reply(
            ctx.i18n.t("dialogs.editPortfolio.created", {
                exchange: ctx.session.dialog.current.data.exchange,
                options: options.map((o) => `✅ ${ctx.i18n.t(`options.${o}`)}`).join("\n "),
                initialBalance,
                amount: balancePercent || tradingAmountCurrency,
                amountType:
                    amountType === "balancePercent"
                        ? ctx.i18n.t("dialogs.editPortfolio.ofBalance")
                        : ctx.i18n.t("dialogs.editPortfolio.fixedCurrency"),
                warning: type === "trading" ? ctx.i18n.t("warning") : ""
            }),
            {
                reply_markup: getCreatedButtons(ctx)
            }
        );
    }
};

const chooseOptions = async (ctx: BotContext) => {
    ctx.session.dialog.current.data.selectedOptions = [];
    ctx.dialog.next(editPortfolioActions.optionsChosen);

    if (ctx.session.dialog.current.data.edit) {
        await ctx.editMessageText(ctx.i18n.t("dialogs.editPortfolio.chooseOptions"));
        await ctx.editMessageReplyMarkup({ reply_markup: getOptionsButtons(ctx) });
    } else {
        ctx.session.dialog.current.data.edit = true;
        const { message_id } = await ctx.reply(ctx.i18n.t("dialogs.editPortfolio.chooseOptions"), {
            reply_markup: getOptionsButtons(ctx)
        });
        ctx.session.dialog.current.data.prev_message_id = message_id;
    }
};

const optionsChosen = async (ctx: BotContext) => {
    const option = ctx.session.dialog.current.data.payload as string;

    if (option !== "done") ctx.session.dialog.current.data.selectedOptions.push(option);
    const selected = ctx.session.dialog.current.data.selectedOptions as string[];
    if (selected.length === ctx.catalog.options.length || option === "done") {
        let error;
        try {
            await ctx.gql.request<{ editUserPortfolio: { result: string } }>(
                ctx,
                gql`
                    mutation editUserPortfolio($userPortfolioId: uuid!, $options: PortfolioOptions!) {
                        editUserPortfolio(userPortfolioId: $userPortfolioId, options: $options) {
                            result
                        }
                    }
                `,
                {
                    userPortfolioId: ctx.session.portfolio.id,
                    options: ctx.catalog.options.reduce(
                        (prev, cur) => ({
                            ...prev,
                            [cur]: ctx.session.dialog.current.data.selectedOptions.includes(cur)
                        }),
                        {}
                    )
                }
            );
        } catch (err) {
            error = err.message;
        }
        if (error) {
            await ctx.reply(ctx.i18n.t("failed", { error }));
        }
        ctx.dialog.enter(tradingActions.enter, { edit: false, reload: true });
    } else {
        ctx.dialog.next(editPortfolioActions.optionsChosen);
        if (ctx.session.dialog.current.data.edit) {
            await ctx.editMessageText(
                ctx.i18n.t("dialogs.editPortfolio.chooseMoreOptions", {
                    options: selected.map((o) => `✅ ${ctx.i18n.t(`options.${o}`)}`).join("\n ")
                })
            );
            await ctx.editMessageReplyMarkup({ reply_markup: getOptionsButtons(ctx) });
        } else {
            ctx.session.dialog.current.data.edit = true;
            const { message_id } = await ctx.reply(
                ctx.i18n.t("dialogs.editPortfolio.chooseMoreOptions", {
                    options: selected.map((o) => ctx.i18n.t(`options.${o}`)).join(" ")
                }),
                {
                    reply_markup: getOptionsButtons(ctx)
                }
            );
            ctx.session.dialog.current.data.prev_message_id = message_id;
        }
    }
};

router.set(editPortfolioActions.enter, chooseType);
router.set(editPortfolioActions.amountType, chooseAmountType);
router.set(editPortfolioActions.initBalance, initBalance);
router.set(editPortfolioActions.handleInitBalance, handleBalance);
router.set(editPortfolioActions.amount, setAmount);
router.set(editPortfolioActions.handleAmount, handleAmount);
router.set(editPortfolioActions.finish, finish);
router.set(editPortfolioActions.options, chooseOptions);
router.set(editPortfolioActions.optionsChosen, optionsChosen);

export const editPortfolio = {
    name: "editPortfolio",
    router
};
