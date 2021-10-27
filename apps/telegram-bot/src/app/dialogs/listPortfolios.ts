import { PortfolioInfo } from "@cryptuoso/portfolio-state";
import { BotContext } from "../types";
import { getExchangeButtons, getOptionsButtons, getPortfolioActions } from "../utils/buttons";
import { Router } from "../utils/dialogsRouter";
import { getEquityChartUrl } from "@cryptuoso/quickchart";
import { addPortfolioActions } from "./addPortfolio";
import { gql } from "../utils/graphql-client";
import logger from "@cryptuoso/logger";
import { editPortfolioActions } from "./editPortfolio";
import { equals } from "@cryptuoso/helpers";

export const enum listPortfoliosActions {
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
    await ctx.reply(ctx.i18n.t("dialogs.listPortfolios.chooseExchange"), {
        reply_markup: getExchangeButtons(ctx)
    });
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

    await ctx.dialog.edit();
    ctx.session.dialog.current.data.edit = true;
    await ctx.reply(
        ctx.i18n.t("dialogs.listPortfolios.chooseOptions", {
            options: ctx.catalog.options
                .map((o) => `<b>${ctx.i18n.t(`options.${o}`)}</b> - <i>${ctx.i18n.t(`options.info.${o}`)}</i>`)
                .join("\n ")
        }),
        {
            reply_markup: getOptionsButtons(ctx)
        }
    );
};

const optionsChosen = async (ctx: BotContext) => {
    const option = ctx.session.dialog.current.data.payload as string;

    if (option !== "done") ctx.session.dialog.current.data.selectedOptions.push(option);
    const selected = ctx.session.dialog.current.data.selectedOptions as string[];
    if (selected.length === ctx.catalog.options.length || option === "done") {
        ctx.dialog.enter(listPortfoliosActions.show, { ...ctx.session.dialog.current.data });
    } else {
        ctx.dialog.next(listPortfoliosActions.optionsChosen);
        await ctx.dialog.edit();

        ctx.session.dialog.current.data.edit = true;
        await ctx.reply(
            ctx.i18n.t("dialogs.listPortfolios.chooseMoreOptions", {
                options: selected
                    .map((o) => `✅ <b>${ctx.i18n.t(`options.${o}`)}</b> - <i>${ctx.i18n.t(`options.info.${o}`)}</i>`)
                    .join("\n ")
            }),
            {
                reply_markup: getOptionsButtons(ctx)
            }
        );
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

    ctx.session.dialog.current.data.subscribed =
        ctx.session.portfolio && equals(ctx.session.portfolio.settings.options, options);

    const text = ctx.i18n.t("dialogs.listPortfolios.portfolio", {
        ...portfolio,
        options: Object.entries(portfolio.settings.options)
            .filter(([, val]) => !!val)
            .map(([o]) => `✅ ${ctx.i18n.t(`options.${o}`)}`)
            .join("\n "),
        subscribed: ctx.session.dialog.current.data.subscribed
            ? `\n${ctx.i18n.t("listPortfolios.alreadySubscribed")}`
            : ""
    });
    await ctx.dialog.edit();
    ctx.dialog.next(listPortfoliosActions.actions);
    try {
        await ctx.replyWithPhoto(await getEquityChartUrl(portfolio.stats.equityAvg), {
            caption: text,
            reply_markup: getPortfolioActions(ctx)
        });
    } catch (err) {
        logger.error(err);
        await ctx.reply(text, {
            reply_markup: getPortfolioActions(ctx)
        });
    }
};

const portfolioActions = async (ctx: BotContext) => {
    const action = ctx.session.dialog.current.data.payload as string;

    if (action === "subscribe") {
        const { exchange, selectedOptions, portfolioCode, loadedPortfolios } = ctx.session.dialog.current.data as {
            exchange: string;
            selectedOptions: string[];
            portfolioCode: string;
            loadedPortfolios: { [key: string]: PortfolioInfo };
        };
        if (ctx.session.portfolio) {
            if (ctx.session.dialog.current.data.subscribed) {
                await ctx.reply(ctx.i18n.t("listPortfolios.alreadySubscribed"));
                ctx.dialog.reset();
            } else
                ctx.dialog.enter(editPortfolioActions.optionsChosen, {
                    selectedOptions
                });
        } else
            ctx.dialog.enter(addPortfolioActions.enter, {
                edit: true,
                exchange,
                selectedOptions,
                minBalance: loadedPortfolios[portfolioCode].limits.minBalance
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
