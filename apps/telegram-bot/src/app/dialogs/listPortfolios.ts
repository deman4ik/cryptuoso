import { gql } from "@cryptuoso/graphql-client";
import logger from "@cryptuoso/logger";
import { PortfolioInfo, PortfolioSettings } from "@cryptuoso/portfolio-state";
import { PerformanceVals } from "@cryptuoso/trade-stats";
import { MessageX } from "@grammyjs/hydrate/out/data/message";
import { Message, MsgWith } from "grammy/out/platform";
import { BotContext } from "../types";
import { getExchangeButtons, getOptionsButtons, getPortfolioActions } from "../utils/buttons";
import { Router } from "../utils/dialogsRouter";
import { getMainKeyboard, getBackKeyboard } from "../utils/keyboard";
import { getEquityChartUrl } from "@cryptuoso/quickchart";
import { editPortfolioActions } from "./editPortfolio";

export enum listPortfoliosActions {
    enter = "lPfs:enter",
    options = "lPfs:opts",
    optionsChosen = "lPfs:optsCh",
    show = "lPfs:show",
    actions = "lPfs:actions"
}
const router: Router = new Map();

const chooseExchange = async (ctx: BotContext) => {
    if (!ctx.session.exchanges || ctx.session.dialog.current.data?.reload) {
        const { exchanges } = await ctx.gql.request<{ exchanges: { code: string; name: string }[] }>(
            ctx,
            gql`
                query {
                    exchanges {
                        code
                        name
                    }
                }
            `
        );
        ctx.session.exchanges = exchanges;
    }

    ctx.dialog.next(listPortfoliosActions.options);
    ctx.session.dialog.current.data.edit = true;
    const { message_id } = await ctx.reply(ctx.i18n.t("dialogs.listPortfolios.chooseExchange"), {
        reply_markup: getExchangeButtons(ctx)
    });
    ctx.session.dialog.current.data.prev_message_id = message_id;
};

const chooseOptions = async (ctx: BotContext) => {
    if (!ctx.session.dialog.current.data.exchange) {
        const exchange = ctx.session.dialog.current.data?.payload as string;
        const availableExchanges = ctx.session.exchanges.map((e) => e.code);
        if (!exchange || !availableExchanges.includes(exchange)) {
            await ctx.reply(ctx.i18n.t("dialogs.listPortfolios.wrongExchange"));
            ctx.dialog.enter(listPortfoliosActions.enter, { reload: true });
            return;
        }
        ctx.session.dialog.current.data.exchange = exchange;
    }
    ctx.session.dialog.current.data.selectedOptions = [];
    ctx.dialog.next(listPortfoliosActions.optionsChosen);

    if (ctx.session.dialog.current.data.edit) {
        await ctx.editMessageText(ctx.i18n.t("dialogs.listPortfolios.chooseOptions"));
        await ctx.editMessageReplyMarkup({ reply_markup: getOptionsButtons(ctx) });
    } else {
        ctx.session.dialog.current.data.edit = true;
        const { message_id } = await ctx.reply(ctx.i18n.t("dialogs.listPortfolios.chooseOptions"), {
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
        ctx.dialog.enter(listPortfoliosActions.show, { ...ctx.session.dialog.current.data });
    } else {
        ctx.dialog.next(listPortfoliosActions.optionsChosen);
        if (ctx.session.dialog.current.data.edit) {
            await ctx.editMessageText(
                ctx.i18n.t("dialogs.listPortfolios.chooseMoreOptions", {
                    options: selected.map((o) => `✅ ${ctx.i18n.t(`options.${o}`)}`).join("\n ")
                })
            );
            await ctx.editMessageReplyMarkup({ reply_markup: getOptionsButtons(ctx) });
        } else {
            ctx.session.dialog.current.data.edit = true;
            const { message_id } = await ctx.reply(
                ctx.i18n.t("dialogs.listPortfolios.chooseMoreOptions", {
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

const showPortfolio = async (ctx: BotContext) => {
    const { exchange, selectedOptions } = ctx.session.dialog.current.data as {
        exchange: string;
        selectedOptions: string[];
    };
    if (!exchange || !selectedOptions || !Array.isArray(selectedOptions) || !selectedOptions.length) {
        ctx.dialog.reset();
        return;
    }

    if (!ctx.session.dialog.current.data.loadedPortfolios) ctx.session.dialog.current.data.loadedPortfolios = {};

    const options: { [key: string]: boolean } = {
        profit: false,
        risk: false,
        moneyManagement: false,
        winRate: false,
        efficiency: false
    };

    for (const option of selectedOptions) {
        options[option] = true;
    }
    const portfolioCode = `${exchange}:${selectedOptions.sort().join("+")}`;
    ctx.session.dialog.current.data.portfolioCode = portfolioCode;
    if (!ctx.session.dialog.current.data.loadedPortfolios[portfolioCode]) {
        const { portfolios } = await ctx.gql.request<{
            portfolios: PortfolioInfo[];
        }>(
            ctx,
            gql`
                query publicPortfolios(
                    $exchange: String!
                    $risk: Boolean!
                    $profit: Boolean!
                    $winRate: Boolean!
                    $efficiency: Boolean!
                    $moneyManagement: Boolean!
                ) {
                    portfolios: v_portfolios(
                        where: {
                            exchange: { _eq: $exchange }
                            option_risk: { _eq: $risk }
                            option_profit: { _eq: $profit }
                            option_win_rate: { _eq: $winRate }
                            option_efficiency: { _eq: $efficiency }
                            option_money_management: { _eq: $moneyManagement }
                            status: { _eq: "started" }
                            base: { _eq: true }
                        }
                        limit: 1
                    ) {
                        code
                        exchange
                        stats {
                            currentBalance: current_balance
                            netProfit: net_profit
                            percentNetProfit: percent_net_profit
                            winRate: win_rate
                            maxDrawdown: max_drawdown
                            maxDrawdownDate: max_drawdown_date
                            payoffRatio: payoff_ratio
                            sharpeRatio: sharpe_ratio
                            recoveyFactor: recovery_factor
                            avgTradesCount: avg_trades_count_years
                            equityAvg: equity_avg
                            firstPosition: first_position
                        }
                        limits
                        settings
                    }
                }
            `,
            {
                exchange,
                ...options
            }
        );
        const [portfolio] = portfolios;
        ctx.session.dialog.current.data.loadedPortfolios = {
            ...ctx.session.dialog.current.data.loadedPortfolios,
            [portfolio.code]: portfolio
        };
    }
    const portfolio = ctx.session.dialog.current.data.loadedPortfolios[portfolioCode];

    const text = ctx.i18n.t("dialogs.listPortfolios.portfolio", {
        ...portfolio,
        options: Object.entries(portfolio.settings.options)
            .filter(([, val]) => !!val)
            .map(([o]) => `✅ ${ctx.i18n.t(`options.${o}`)}`)
            .join("\n ")
    });
    if (ctx.session.dialog.current.data.prev_message_id) {
        await ctx.api.deleteMessage(ctx.chat.id, ctx.session.dialog.current.data.prev_message_id);
    }
    ctx.dialog.next(listPortfoliosActions.actions);
    await ctx.replyWithPhoto(getEquityChartUrl(portfolio.stats.equityAvg), {
        caption: text,
        reply_markup: getPortfolioActions(ctx)
    });
};

const portfolioActions = async (ctx: BotContext) => {
    const action = ctx.session.dialog.current.data.payload as string;

    if (action === "subscribe") {
        const { exchange, selectedOptions, portffolioCode, loadedPortfolios } = ctx.session.dialog.current.data as {
            exchange: string;
            selectedOptions: string[];
            portffolioCode: string;
            loadedPortfolios: { [key: string]: PortfolioInfo };
        };
        ctx.dialog.enter(editPortfolioActions.enter, {
            exchange,
            selectedOptions,
            minBalance: loadedPortfolios[portffolioCode].limits.minBalance
        });
    } else if (action === "back") {
        ctx.dialog.enter(listPortfoliosActions.options, { ...ctx.session.dialog.current.data });
    }
};
router.set(listPortfoliosActions.enter, chooseExchange);
router.set(listPortfoliosActions.options, chooseOptions);
router.set(listPortfoliosActions.optionsChosen, optionsChosen);
router.set(listPortfoliosActions.show, showPortfolio);
router.set(listPortfoliosActions.actions, portfolioActions);

export const listPortfolios = {
    name: "listPortfolios",
    router
};