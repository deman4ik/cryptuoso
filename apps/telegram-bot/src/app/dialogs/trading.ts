import dayjs from "@cryptuoso/dayjs";
import { chunkArray, plusNum } from "@cryptuoso/helpers";
import logger from "@cryptuoso/logger";
import { ClosedPosition, OpenPosition, UserPortfolioInfo } from "@cryptuoso/portfolio-state";
import { getEquityChartUrl } from "@cryptuoso/quickchart";
import { UserExchangeAccountInfo } from "@cryptuoso/user-state";
import { InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { getConfirmButtons } from "../utils/buttons";
import { Router } from "../utils/dialogsRouter";
import { gql } from "../utils/graphql-client";
import { getBackKeyboard } from "../utils/keyboard";
import { editPortfolioActions } from "./editPortfolio";
import { listPortfoliosActions } from "./listPortfolios";

export const enum tradingActions {
    enter = "tr:enter",
    confirmStart = "tr:cStart",
    start = "tr:start",
    confirmStop = "tr:cStop",
    stop = "tr:stop",
    confirmDelete = "tr:cDel",
    delete = "tr:del",
    stats = "tr:stats",
    oPos = "tr:oPos",
    cPos = "tr:cPos",
    edit = "tr:edit"
}

const getTradingButtons = (ctx: BotContext) => {
    let keyboard = new InlineKeyboard();
    const buttons = [
        {
            text: ctx.i18n.t("dialogs.trading.info"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: tradingActions.enter,
                p: "info"
            })
        }
    ];
    const { stats, status } = ctx.session.portfolio;
    if (stats) {
        buttons.push({
            text: ctx.i18n.t("dialogs.trading.stats"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: tradingActions.stats,
                p: "stats"
            })
        });
        buttons.push({
            text: ctx.i18n.t("dialogs.trading.openPos"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: tradingActions.oPos,
                p: "openPos"
            })
        });
        buttons.push({
            text: ctx.i18n.t("dialogs.trading.closedPos"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: tradingActions.cPos,
                p: "cPos"
            })
        });
    }

    if (status !== "started" && status !== "starting") {
        buttons.push({
            text: ctx.i18n.t("dialogs.trading.start"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: tradingActions.confirmStart,
                p: true
            })
        });
    }
    if (status !== "stopped") {
        buttons.push({
            text: ctx.i18n.t("dialogs.trading.stop"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: tradingActions.confirmStop,
                p: true
            })
        });
    }

    buttons.push({
        text: ctx.i18n.t("dialogs.trading.edit"),
        callback_data: JSON.stringify({
            d: ctx.session.dialog.current?.id || null,
            a: tradingActions.edit,
            p: "edit"
        })
    });

    if (status === "stopped") {
        buttons.push({
            text: ctx.i18n.t("dialogs.trading.delete"),
            callback_data: JSON.stringify({
                d: ctx.session.dialog.current?.id || null,
                a: tradingActions.confirmDelete,
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

const router: Router = new Map();

const getTradingInfo = async (ctx: BotContext) => {
    logger.debug(!!ctx.session.portfolio);
    logger.debug(ctx.session.dialog.current?.data?.reload);
    if (
        !ctx.session.portfolio ||
        ctx.session.dialog.current?.data?.reload ||
        dayjs.utc().diff(dayjs.utc(ctx.session.portfolio.lastInfoUpdatedAt), "second") > 5
    ) {
        const {
            myPortfolio,
            myUserExAcc,
            openPosSum: {
                aggregate: {
                    sum: { unrealizedProfit },
                    openTradesCount
                }
            }
        } = await ctx.gql.request<{
            openPosSum: {
                aggregate: {
                    sum: {
                        unrealizedProfit: number;
                    };
                    openTradesCount: number;
                };
            };
            myPortfolio: UserPortfolioInfo[];
            myUserExAcc: UserExchangeAccountInfo[];
        }>(
            ctx,
            gql`
                query myPortfolio($userId: uuid!) {
                    openPosSum: v_user_positions_aggregate(
                        where: { user_id: { _eq: $userId }, status: { _eq: "open" } }
                    ) {
                        aggregate {
                            sum {
                                unrealizedProfit: profit
                            }
                            openTradesCount: count
                        }
                    }
                    myPortfolio: v_user_portfolios(where: { user_id: { _eq: $userId } }) {
                        id
                        userExAccId: user_ex_acc_id
                        exchange
                        type
                        status
                        startedAt: started_at
                        stoppedAt: stopped_at
                        activeFrom: active_from
                        settings: user_portfolio_settings
                        nextSettings: next_user_portfolio_settings
                        stats {
                            tradesCount: trades_count
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
                            avgPercentNetProfitYearly: avg_percent_net_profit_yearly
                            equityAvg: equity_avg
                            firstPosition: first_position
                            lastPosition: last_position
                        }
                        openPositions: positions(
                            where: { status: { _eq: "open" } }
                            order_by: { entry_date: desc_nulls_last }
                        ) {
                            id
                            direction
                            asset
                            entryAction: entry_action
                            entryPrice: entry_price
                            entryDate: entry_date
                            volume: entry_executed
                            profit
                        }
                        closedPositions: positions(
                            where: { status: { _in: ["closed", "closedAuto"] } }
                            order_by: { exit_date: desc_nulls_last }
                            limit: 5
                        ) {
                            id
                            direction
                            asset
                            entryAction: entry_action
                            entryPrice: entry_price
                            entryDate: entry_date
                            exitAction: exit_action
                            exitPrice: exit_price
                            exitDate: exit_date
                            barsHeld: bars_held
                            volume: exit_executed
                            profit
                        }
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
                        balance: total_balance_usd
                    }
                }
            `,
            {
                userId: ctx.session.user.id
            }
        );
        logger.debug(myPortfolio);
        if (myPortfolio && Array.isArray(myPortfolio) && myPortfolio.length) {
            const [portfolio] = myPortfolio;
            ctx.session.portfolio = portfolio;
            ctx.session.portfolio.unrealizedProfit = unrealizedProfit;
            ctx.session.portfolio.openTradesCount = openTradesCount;
            ctx.session.portfolio.lastInfoUpdatedAt = dayjs.utc().toISOString();
        } else ctx.session.portfolio = null;
        if (myUserExAcc && Array.isArray(myUserExAcc) && myUserExAcc.length) {
            const [userExAcc] = myUserExAcc;
            ctx.session.userExAcc = userExAcc;
        } else ctx.session.userExAcc = null;
    }
};

const onEnter = async (ctx: BotContext) => {
    await getTradingInfo(ctx);

    if (!ctx.session.dialog.current.data.edit)
        await ctx.reply(ctx.i18n.t("keyboards.mainKeyboard.trading"), getBackKeyboard(ctx));
    if (!ctx.session.portfolio) {
        if (ctx.session.userExAcc) {
            ctx.dialog.enter(listPortfoliosActions.options, { exchange: ctx.session.userExAcc.exchange });
        } else ctx.dialog.enter(listPortfoliosActions.enter);
        return;
    }

    const portfolio = ctx.session.portfolio;
    const userExAcc = ctx.session.userExAcc;

    const settings = portfolio.settings;
    const nextSettings = portfolio.nextSettings;

    let settingsText = "";
    let amountText: any = "";
    let amountTypeText = "";
    if (settings) {
        settingsText = ctx.i18n.t("dialogs.trading.settings", {
            title: ctx.i18n.t("dialogs.trading.currentSettings"),
            options: Object.entries(settings.options)
                .filter(([, val]) => !!val)
                .map(([o]) => `✅ ${ctx.i18n.t(`options.${o}`)}`)
                .join("\n ")
        });
        amountText = settings.balancePercent || settings.tradingAmountCurrency;
        amountTypeText =
            settings.tradingAmountType === "balancePercent"
                ? ctx.i18n.t("dialogs.addPortfolio.ofBalance")
                : ctx.i18n.t("dialogs.addPortfolio.fixedCurrency");
    }

    if (nextSettings) {
        settingsText = `${settingsText}${ctx.i18n.t("dialogs.trading.settings", {
            title: ctx.i18n.t("dialogs.trading.newSettings", {
                date: portfolio.activeFrom
                    ? dayjs.utc(portfolio.activeFrom).format("YYYY-MM-DD")
                    : ctx.i18n.t("dialogs.trading.nextBuild")
            }),
            options: Object.entries(nextSettings.options)
                .filter(([, val]) => !!val)
                .map(([o]) => `✅ ${ctx.i18n.t(`options.${o}`)}`)
                .join("\n ")
        })}`;
        if (amountText === "" && amountTypeText === "") {
            amountText = nextSettings.balancePercent || nextSettings.tradingAmountCurrency;
            amountTypeText =
                nextSettings.tradingAmountType === "balancePercent"
                    ? ctx.i18n.t("dialogs.addPortfolio.ofBalance")
                    : ctx.i18n.t("dialogs.addPortfolio.fixedCurrency");
        }
    }
    const text = `${ctx.i18n.t("dialogs.trading.infoTitle", { exchange: portfolio.exchange })}${ctx.i18n.t(
        "dialogs.trading.portfolio",
        {
            settings: settingsText,
            status: ctx.i18n.t(`status.${portfolio.status}`),
            currentBalance: userExAcc.balance,
            amount: amountText,
            amountType: amountTypeText,
            netProfit: portfolio.stats?.netProfit
                ? `${plusNum(portfolio.stats.netProfit)} $ (${plusNum(portfolio.stats.percentNetProfit)}%)`
                : `0 $`,
            unrealizedProfit: portfolio.unrealizedProfit ? `${plusNum(portfolio.unrealizedProfit)} $` : `0 $`,
            tradesCount: portfolio.stats?.tradesCount ? portfolio.stats?.tradesCount : 0,
            openTradeCount: portfolio.openTradesCount
        }
    )}${ctx.i18n.t("lastInfoUpdatedAt", { lastInfoUpdatedAt: portfolio.lastInfoUpdatedAt })}`;

    await ctx.dialog.edit();
    if (portfolio.stats?.equityAvg && Array.isArray(portfolio.stats?.equityAvg) && portfolio.stats?.equityAvg.length) {
        await ctx.replyWithPhoto(await getEquityChartUrl(portfolio.stats.equityAvg), {
            caption: text,
            parse_mode: "HTML",
            reply_markup: getTradingButtons(ctx)
        });
    } else await ctx.reply(text, { reply_markup: getTradingButtons(ctx) });

    ctx.session.dialog.current.data.edit = true;
};

const confirmStart = async (ctx: BotContext) => {
    if (ctx.session.dialog.current.data.reload) {
        await getTradingInfo(ctx);
    }
    await ctx.dialog.next(tradingActions.start);
    ctx.session.dialog.current.data.edit = false;
    await ctx.reply(
        ctx.i18n.t("dialogs.trading.confirmStart", {
            warning: ctx.i18n.t("warning")
        }),
        { reply_markup: getConfirmButtons(ctx) }
    );
};

const start = async (ctx: BotContext) => {
    const { data } = ctx.session.dialog.current;
    if (!data.payload) {
        ctx.dialog.jump(tradingActions.enter);
        return;
    }
    await getTradingInfo(ctx);
    let error;
    let result;
    try {
        ({
            userPortfolioStart: { result }
        } = await ctx.gql.request<{ userPortfolioStart: { result: string } }>(
            ctx,
            gql`
                mutation userPortfolioStart($userPortfolioId: uuid!) {
                    userPortfolioStart(id: $userPortfolioId) {
                        result
                    }
                }
            `,
            {
                userPortfolioId: ctx.session.portfolio.id
            }
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
        return;
    }
    if (result) {
        if (result === "starting")
            await ctx.reply(
                ctx.i18n.t("notifications.status", {
                    status: ctx.i18n.t("status.starting"),
                    message: ""
                })
            );
        else if (result === "started")
            await ctx.reply(
                ctx.i18n.t("notifications.status", {
                    status: ctx.i18n.t("status.started"),
                    message: ""
                })
            );
        ctx.session.dialog.current.data.reload = true;
        ctx.session.dialog.current.data.edit = false;
        ctx.dialog.jump(tradingActions.enter);
    }
};

const confirmStop = async (ctx: BotContext) => {
    if (ctx.session.dialog.current.data.reload) {
        await getTradingInfo(ctx);
    }
    await ctx.dialog.next(tradingActions.stop);
    ctx.session.dialog.current.data.edit = false;
    await ctx.reply(
        ctx.i18n.t("dialogs.trading.confirmStop", {
            warning: ctx.i18n.t("warningStop")
        }),
        { reply_markup: getConfirmButtons(ctx) }
    );
};

const stop = async (ctx: BotContext) => {
    const { data } = ctx.session.dialog.current;
    if (!data.payload) {
        ctx.session.dialog.current.data.reload = true;
        ctx.session.dialog.current.data.edit = false;
        ctx.dialog.jump(tradingActions.enter);
        return;
    }
    await getTradingInfo(ctx);
    let error;
    let result;
    try {
        ({
            userPortfolioStop: { result }
        } = await ctx.gql.request<{ userPortfolioStop: { result: string } }>(
            ctx,
            gql`
                mutation userPortfolioStop($userPortfolioId: uuid!) {
                    userPortfolioStop(id: $userPortfolioId) {
                        result
                    }
                }
            `,
            {
                userPortfolioId: ctx.session.portfolio.id
            }
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
        return;
    }
    if (result) {
        if (result === "stopping")
            await ctx.reply(
                ctx.i18n.t("notifications.status", {
                    status: ctx.i18n.t("status.stopping"),
                    message: ""
                })
            );
        else if (result === "stopped")
            await ctx.reply(
                ctx.i18n.t("notifications.status", {
                    status: ctx.i18n.t("status.stopped"),
                    message: ""
                })
            );
        ctx.session.dialog.current.data.reload = true;
        ctx.session.dialog.current.data.edit = false;
        ctx.dialog.jump(tradingActions.enter);
    }
};

const confirmDelete = async (ctx: BotContext) => {
    if (ctx.session.dialog.current.data.reload) {
        await getTradingInfo(ctx);
    }
    await ctx.dialog.next(tradingActions.delete);
    ctx.session.dialog.current.data.edit = false;
    await ctx.reply(ctx.i18n.t("dialogs.trading.confirmDelete"), { reply_markup: getConfirmButtons(ctx) });
};

const deletePortfolio = async (ctx: BotContext) => {
    const { data } = ctx.session.dialog.current;
    if (!data.payload) {
        ctx.dialog.jump(tradingActions.enter);
        return;
    }
    await getTradingInfo(ctx);
    let error;
    let result;
    try {
        ({
            deleteUserPortfolio: { result }
        } = await ctx.gql.request<{ deleteUserPortfolio: { result: string } }>(
            ctx,
            gql`
                mutation deleteUserPortfolio($userPortfolioId: uuid!) {
                    deleteUserPortfolio(userPortfolioId: $userPortfolioId) {
                        result
                    }
                }
            `,
            {
                userPortfolioId: ctx.session.portfolio.id
            }
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
        return;
    }
    if (result) {
        ctx.session.portfolio = null;
        await ctx.reply(ctx.i18n.t("dialogs.trading.deleted"));

        ctx.dialog.reset();
    }
};

const stats = async (ctx: BotContext) => {
    await getTradingInfo(ctx);
    const { portfolio } = ctx.session;

    if (!portfolio.stats.lastPosition) {
        await ctx.dialog.edit();

        await ctx.reply(
            `${ctx.i18n.t("dialogs.trading.statsTitle", { exchange: portfolio.exchange })}${ctx.i18n.t(
                "performance.none"
            )}`,
            { reply_markup: getTradingButtons(ctx) }
        );
        return;
    }

    const text = `${ctx.i18n.t("dialogs.trading.statsTitle", { exchange: portfolio.exchange })}${ctx.i18n.t(
        "performance.stats",
        {
            ...portfolio.stats,
            sharpeRatio: portfolio.stats.sharpeRatio || ctx.i18n.t("notAvailable")
        }
    )}`;

    await ctx.dialog.edit();
    await ctx.replyWithPhoto(await getEquityChartUrl(portfolio.stats.equityAvg), {
        caption: text,
        reply_markup: getTradingButtons(ctx)
    });
    ctx.session.dialog.current.data.edit = true;
};

const openPositions = async (ctx: BotContext) => {
    await getTradingInfo(ctx);
    const { portfolio } = ctx.session;

    const openPositions = portfolio.openPositions;

    let openPositionsText = "";
    if (openPositions && Array.isArray(openPositions) && openPositions.length > 0) {
        openPositions.forEach((pos: OpenPosition) => {
            const posText = ctx.i18n.t("positions.positionOpen", {
                ...pos,
                entryAction: ctx.i18n.t(`tradeAction.${pos.entryAction}`)
            });
            openPositionsText = `${openPositionsText}\n\n${posText}\n`;
        });
        openPositionsText = ctx.i18n.t("positions.positionsOpen", {
            openPositions: openPositionsText
        });
    }

    const updatedAtText = ctx.i18n.t("lastInfoUpdatedAt", {
        lastInfoUpdatedAt: portfolio.lastInfoUpdatedAt
    });

    const message = openPositionsText !== "" ? openPositionsText : ctx.i18n.t("positions.none");
    const text = `${ctx.i18n.t("dialogs.trading.title", { exchange: portfolio.exchange })}${message}${updatedAtText}`;
    await ctx.dialog.edit();
    await ctx.reply(text, { reply_markup: getTradingButtons(ctx) });
    ctx.session.dialog.current.data.edit = true;
};

const closedPositions = async (ctx: BotContext) => {
    await getTradingInfo(ctx);
    const { portfolio } = ctx.session;

    const closedPositions = portfolio.closedPositions;

    let closedPositionsText = "";
    logger.debug(closedPositions);
    if (closedPositions && Array.isArray(closedPositions) && closedPositions.length > 0) {
        closedPositions.forEach((pos: ClosedPosition) => {
            const posText = ctx.i18n.t("positions.positionClosed", {
                ...pos,
                entryAction: ctx.i18n.t(`tradeAction.${pos.entryAction}`),
                exitAction: ctx.i18n.t(`tradeAction.${pos.exitAction}`)
            });
            closedPositionsText = `${closedPositionsText}${posText}\n`;
        });
        closedPositionsText = ctx.i18n.t("positions.positionsClosed", {
            closedPositions: closedPositionsText
        });
    }

    const updatedAtText = ctx.i18n.t("lastInfoUpdatedAt", {
        lastInfoUpdatedAt: portfolio.lastInfoUpdatedAt
    });

    const message = closedPositionsText !== "" ? closedPositionsText : ctx.i18n.t("positions.none");
    const text = `${ctx.i18n.t("dialogs.trading.title", { exchange: portfolio.exchange })}${message}${updatedAtText}`;

    await ctx.dialog.edit();
    await ctx.reply(text, { reply_markup: getTradingButtons(ctx) });
    ctx.session.dialog.current.data.edit = true;
};

const edit = async (ctx: BotContext) => {
    ctx.dialog.enter(editPortfolioActions.enter, { edit: true });
};

router.set(tradingActions.enter, onEnter);
router.set(tradingActions.confirmStart, confirmStart);
router.set(tradingActions.start, start);
router.set(tradingActions.confirmStop, confirmStop);
router.set(tradingActions.stop, stop);
router.set(tradingActions.confirmDelete, confirmDelete);
router.set(tradingActions.delete, deletePortfolio);
router.set(tradingActions.stats, stats);
router.set(tradingActions.oPos, openPositions);
router.set(tradingActions.cPos, closedPositions);
router.set(tradingActions.edit, edit);

export const trading = {
    name: "trading",
    router
};
