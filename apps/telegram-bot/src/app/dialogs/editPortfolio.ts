import { round } from "@cryptuoso/helpers";
import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { getAmountTypeButtons, getPercentButtons } from "../utils/buttons";
import { Router } from "../utils/dialogsRouter";
import { gql } from "../utils/graphql-client";
import { listPortfoliosActions } from "./listPortfolios";
import { tradingActions } from "./trading";

export const enum editPortfolioActions {
    enter = "ePf:enter",
    options = "ePf:opts",
    optionsChosen = "ePf:optsCh",
    amountType = "ePf:amType",
    amount = "ePf:amount",
    handleAmount = "ePf:hAmount"
}

const enter = async (ctx: BotContext) => {
    if (!ctx.session.portfolio) {
        ctx.dialog.reset();
        return;
    }

    await ctx.reply(ctx.i18n.t("dialogs.editPortfolio.confirmEdit"), {
        reply_markup: new InlineKeyboard()
            .add({
                text: ctx.i18n.t("dialogs.editPortfolio.editOptions"),
                callback_data: JSON.stringify({
                    d: ctx.session.dialog.current?.id || null,
                    a: editPortfolioActions.options,
                    p: true
                })
            })
            .row()
            .add({
                text: ctx.i18n.t("dialogs.editPortfolio.editAmount"),
                callback_data: JSON.stringify({
                    d: ctx.session.dialog.current?.id || null,
                    a: editPortfolioActions.amountType,
                    p: true
                })
            })
    });
};

const amountType = async (ctx: BotContext) => {
    const text = ctx.i18n.t("dialogs.addPortfolio.amountType", {
        balance: ctx.session.portfolio.settings.initialBalance
    });
    ctx.dialog.next(editPortfolioActions.amount);
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
        ctx.session.dialog.current.data.payload = 100;
        ctx.dialog.jump(editPortfolioActions.handleAmount);
        return;
    } else if (amountType === "balancePercent") {
        ctx.session.dialog.current.data.amountType = "balancePercent";

        const text = ctx.i18n.t("dialogs.addPortfolio.amountTypePercent");
        ctx.dialog.next(editPortfolioActions.handleAmount);
        const buttons = getPercentButtons(ctx);
        ctx.session.dialog.current.data.expectInput = true;

        await ctx.dialog.edit();
        await ctx.reply(text, { reply_markup: buttons });
    } else if (amountType === "currencyFixed") {
        ctx.session.dialog.current.data.amountType = "currencyFixed";
        ctx.session.dialog.current.data.expectInput = true;
        ctx.dialog.next(editPortfolioActions.handleAmount);
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
        ctx.dialog.jump(editPortfolioActions.amount);
        return;
    }

    const { amountType: tradingAmountType, balancePercent, tradingAmountCurrency } = data;
    await ctx.reply(ctx.i18n.t("dialogs.addPortfolio.progress"));
    try {
        await ctx.gql.request<{ editUserPortfolio: { result: string } }>(
            ctx,
            gql`
                mutation editUserPortfolioAmount(
                    $userPortfolioId: uuid!
                    $tradingAmountType: String!
                    $balancePercent: Int
                    $tradingAmountCurrency: Int
                ) {
                    editUserPortfolio(
                        userPortfolioId: $userPortfolioId
                        tradingAmountType: $tradingAmountType
                        balancePercent: $balancePercent
                        tradingAmountCurrency: $tradingAmountCurrency
                    ) {
                        result
                    }
                }
            `,
            {
                userPortfolioId: ctx.session.portfolio.id,
                tradingAmountType,
                balancePercent,
                tradingAmountCurrency
            }
        );
    } catch (err) {
        error = err.message;
    }
    if (error) {
        await ctx.reply(ctx.i18n.t("failed", { error }));
    }

    ctx.dialog.enter(tradingActions.enter, { reload: true, edit: false });
};

const options = async (ctx: BotContext) => {
    ctx.dialog.enter(listPortfoliosActions.options, {
        edit: true,
        exchange: ctx.session.portfolio.exchange
    });
};

const optionsChosen = async (ctx: BotContext) => {
    await ctx.reply(ctx.i18n.t("dialogs.addPortfolio.progress"));
    let error;
    try {
        await ctx.gql.request<{ editUserPortfolio: { result: string } }>(
            ctx,
            gql`
                mutation editUserPortfolioOptions($userPortfolioId: uuid!, $options: PortfolioOptions!) {
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
    await ctx.dialog.edit();
    await ctx.reply(ctx.i18n.t("dialogs.editPortfolio.optionsChange"));
    ctx.dialog.reset();
};
const router: Router = new Map();

router.set(editPortfolioActions.enter, enter);
router.set(editPortfolioActions.amountType, amountType);
router.set(editPortfolioActions.amount, amount);
router.set(editPortfolioActions.handleAmount, handleAmount);
router.set(editPortfolioActions.options, options);
router.set(editPortfolioActions.optionsChosen, optionsChosen);

export const editPortfolio = {
    name: "editPortfolio",
    router
};
