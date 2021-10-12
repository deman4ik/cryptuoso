import { Observable, Subject } from "threads/observable";
import { expose } from "threads/worker";
import logger from "@cryptuoso/logger";
import { DataStream } from "scramjet";
import { sql, pg, makeChunksGenerator, pgUtil } from "@cryptuoso/postgres";
import {
    PortfolioBuilder,
    PortfolioBuilderJob,
    PortfolioInfo,
    PortfolioSettings,
    PortfolioState,
    UserPortfolioBuilderJob,
    UserPortfolioState
} from "@cryptuoso/portfolio-state";
import { BasePosition } from "@cryptuoso/market";
import dayjs from "@cryptuoso/dayjs";
import { sleep } from "@cryptuoso/helpers";

const subject = new Subject<number>();

const worker = {
    async buildPortfolio(job: PortfolioBuilderJob) {
        logger.info(`Initing #${job.portfolioId} portfolio builder`);
        const portfolio = await pg.one<PortfolioState>(sql`
            SELECT p.id, p.code, p.name, p.exchange, p.available, p.status, p.base, p.settings,
                   json_build_object('minTradeAmount', m.min_trade_amount,
                                     'feeRate', m.fee_rate) as context
            FROM portfolios p, 
            mv_exchange_info m
            WHERE p.exchange = m.exchange
              AND p.id = ${job.portfolioId}; 
        `);
        const includeRobotsCondition =
            portfolio.settings.includeRobots &&
            Array.isArray(portfolio.settings.includeRobots) &&
            portfolio.settings.includeRobots.length
                ? sql`AND r.id IN (${sql.join(portfolio.settings.includeRobots, sql`, `)})`
                : sql``;
        const excludeRobotsCondition =
            portfolio.settings.excludeRobots &&
            Array.isArray(portfolio.settings.excludeRobots) &&
            portfolio.settings.excludeRobots.length
                ? sql`AND r.id NOT IN (${sql.join(portfolio.settings.excludeRobots, sql`, `)})`
                : sql``;
        const includeAssetsCondition =
            portfolio.settings.includeAssets &&
            Array.isArray(portfolio.settings.includeAssets) &&
            portfolio.settings.includeAssets.length
                ? sql`AND r.asset IN (${sql.join(portfolio.settings.includeAssets, sql`, `)})`
                : sql``;
        const excludeAssetsCondition =
            portfolio.settings.excludeAssets &&
            Array.isArray(portfolio.settings.excludeAssets) &&
            portfolio.settings.excludeAssets.length
                ? sql`AND r.asset NOT IN (${sql.join(portfolio.settings.excludeAssets, sql`, `)})`
                : sql``;
        const includeTimeframesCondition =
            portfolio.settings.includeTimeframes &&
            Array.isArray(portfolio.settings.includeTimeframes) &&
            portfolio.settings.includeTimeframes.length
                ? sql`AND r.timeframe IN (${sql.join(portfolio.settings.includeTimeframes, sql`, `)})`
                : sql``;
        const excludeTimeframesCondition =
            portfolio.settings.excludeTimeframes &&
            Array.isArray(portfolio.settings.excludeTimeframes) &&
            portfolio.settings.excludeTimeframes.length
                ? sql`AND r.timeframe NOT IN (${sql.join(portfolio.settings.excludeTimeframes, sql`, `)})`
                : sql``;
        const dateFromCondition = portfolio.settings.dateFrom
            ? sql`AND p.entry_date >= ${portfolio.settings.dateFrom}`
            : sql``;
        const dateToCondition = portfolio.settings.dateTo
            ? sql`AND p.entry_date <= ${portfolio.settings.dateTo}`
            : sql``;
        const positions: BasePosition[] = await DataStream.from(
            makeChunksGenerator(
                pg,
                sql`
        SELECT p.id, p.robot_id, p.direction, p.entry_date, p.entry_price,
         p.exit_date, p.exit_price, p.volume,
          p.worst_profit, p.max_price, p.profit, p.bars_held, m.min_amount_currency 
        FROM v_robot_positions p, robots r, v_markets m
        WHERE p.robot_id = r.id 
          AND r.exchange = ${portfolio.exchange}
          AND r.available >= ${portfolio.available}
          AND p.emulated = 'false'
          AND p.status = 'closed'
          AND m.exchange = r.exchange 
          AND m.asset = r.asset
          AND m.currency = r.currency
          ${includeRobotsCondition}
          ${excludeRobotsCondition}
          ${includeAssetsCondition}
          ${excludeAssetsCondition}
          ${includeTimeframesCondition}
          ${excludeTimeframesCondition}
          ${dateFromCondition}
          ${dateToCondition}
          ORDER BY p.exit_date
        `,
                1000
            )
        ).reduce(async (accum: BasePosition[], chunk: BasePosition[]) => [...accum, ...chunk], []);

        const portfolioBuilder = new PortfolioBuilder<PortfolioState>(portfolio, subject);
        portfolioBuilder.init(positions);
        logger.info(`#${job.portfolioId} portfolio builder inited`);

        logger.info(`Processing #${portfolioBuilder.portfolio.id} portfolio build`);
        await sleep(1);
        const result = await portfolioBuilder.build();

        await pg.transaction(async (t) => {
            await t.query(sql`
            UPDATE portfolios SET full_stats = ${JSON.stringify(result.portfolio.fullStats)},
            settings = ${JSON.stringify(result.portfolio.settings)},
            variables = ${JSON.stringify(result.portfolio.variables)},
            status = 'started'
            WHERE id = ${result.portfolio.id}
            `);

            await t.query(sql`DELETE FROM portfolio_period_stats WHERE portfolio_id = ${result.portfolio.id}`);

            await t.query(sql`
            INSERT INTO portfolio_period_stats
            (portfolio_id,
            period,
            year,
            quarter,
            month,
            date_from,
            date_to,
            stats )
            SELECT * FROM
        ${sql.unnest(
            pgUtil.prepareUnnest(
                result.portfolio.periodStats.map((s) => ({
                    ...s,
                    portfolioId: result.portfolio.id,
                    quarter: s.quarter || undefined,
                    month: s.month || undefined,
                    stats: JSON.stringify(s.stats)
                })),
                ["portfolioId", "period", "year", "quarter", "month", "dateFrom", "dateTo", "stats"]
            ),
            ["uuid", "varchar", "int8", "int8", "int8", "timestamp", "timestamp", "jsonb"]
        )}`);

            await t.query(sql`
                DELETE FROM  portfolio_robots
                WHERE portfolio_id = ${result.portfolio.id};`);
            await t.query(sql`
            INSERT INTO portfolio_robots 
            (portfolio_id, robot_id, active, share, priority)
            SELECT *
                FROM ${sql.unnest(
                    pgUtil.prepareUnnest(
                        result.portfolio.robots.map((r) => ({ ...r, portfolioId: result.portfolio.id })),
                        ["portfolioId", "robotId", "active", "share", "priority"]
                    ),
                    ["uuid", "uuid", "bool", "numeric", "int8"]
                )};
            `);

            if (result.portfolio.positions && result.portfolio.positions.length) {
                await t.query(sql`
                DELETE FROM portfolio_positions
                WHERE portfolio_id = ${result.portfolio.id};`);
                await t.query(sql`
                    INSERT INTO portfolio_positions (portfolio_id, robot_id, position_id,
                        volume, amount_in_currency, profit, prev_balance, current_balance
                    ) SELECT * FROM ${sql.unnest(
                        pgUtil.prepareUnnest(
                            result.portfolio.positions.map((p) => ({
                                positionId: p.id,
                                robotId: p.robotId,
                                portfolioId: result.portfolio.id,
                                volume: p.volume,
                                amountInCurrency: p.amountInCurrency,
                                profit: p.profit,
                                prevBalance: p.meta.prevBalance,
                                currentBalance: p.meta.currentBalance
                            })),
                            [
                                "portfolioId",
                                "robotId",
                                "positionId",
                                "volume",
                                "amountInCurrency",
                                "profit",
                                "prevBalance",
                                "currentBalance"
                            ]
                        ),
                        ["uuid", "uuid", "uuid", "numeric", "numeric", "numeric", "numeric", "numeric"]
                    )}

                `);
            }
        });
        await pg.query(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_portfolio_limits;`);
        logger.info(`#${portfolioBuilder.portfolio.id} portfolio build finished`);
    },
    async buildUserPortfolio(job: UserPortfolioBuilderJob) {
        logger.info(`Initing #${job.userPortfolioId} user portfolio builder`);
        const portfolio = await pg.one<UserPortfolioState>(sql`
            SELECT p.id, p.user_id, p.user_ex_acc_id, p.exchange, p.status,
                   ups.id as user_portfolio_settings_id, 
                   ups.active_from as user_portfolio_settings_active_from,
                   ups.user_portfolio_settings as settings,
                   json_build_object('minTradeAmount', m.min_trade_amount,
                                     'feeRate', m.fee_rate) as context
            FROM user_portfolios p, user_portfolio_settings ups,
            mv_exchange_info m
            WHERE p.exchange = m.exchange
              AND p.id = ups.user_portfolio_id
              AND (ups.active_from is null OR ups.active_from = ((SELECT max(s.active_from) AS max
                    FROM user_portfolio_settings s
                    WHERE s.user_portfolio_id = p.id 
                      AND s.active_from IS NOT NULL 
                      AND s.active_from < now()))
                  )
              AND p.id = ${job.userPortfolioId}
              ORDER BY ups.active_from DESC NULLS FIRST LIMIT 1; 
        `);
        const includeRobotsCondition =
            portfolio.settings.includeRobots &&
            Array.isArray(portfolio.settings.includeRobots) &&
            portfolio.settings.includeRobots.length
                ? sql`AND r.id IN (${sql.join(portfolio.settings.includeRobots, sql`, `)})`
                : sql``;
        const excludeRobotsCondition =
            portfolio.settings.excludeRobots &&
            Array.isArray(portfolio.settings.excludeRobots) &&
            portfolio.settings.excludeRobots.length
                ? sql`AND r.id NOT IN (${sql.join(portfolio.settings.excludeRobots, sql`, `)})`
                : sql``;
        const includeAssetsCondition =
            portfolio.settings.includeAssets &&
            Array.isArray(portfolio.settings.includeAssets) &&
            portfolio.settings.includeAssets.length
                ? sql`AND r.asset IN (${sql.join(portfolio.settings.includeAssets, sql`, `)})`
                : sql``;
        const excludeAssetsCondition =
            portfolio.settings.excludeAssets &&
            Array.isArray(portfolio.settings.excludeAssets) &&
            portfolio.settings.excludeAssets.length
                ? sql`AND r.asset NOT IN (${sql.join(portfolio.settings.excludeAssets, sql`, `)})`
                : sql``;
        const includeTimeframesCondition =
            portfolio.settings.includeTimeframes &&
            Array.isArray(portfolio.settings.includeTimeframes) &&
            portfolio.settings.includeTimeframes.length
                ? sql`AND r.timeframe IN (${sql.join(portfolio.settings.includeTimeframes, sql`, `)})`
                : sql``;
        const excludeTimeframesCondition =
            portfolio.settings.excludeTimeframes &&
            Array.isArray(portfolio.settings.excludeTimeframes) &&
            portfolio.settings.excludeTimeframes.length
                ? sql`AND r.timeframe NOT IN (${sql.join(portfolio.settings.excludeTimeframes, sql`, `)})`
                : sql``;
        let dateFromCondition = portfolio.settings.dateFrom
            ? sql`AND p.entry_date >= ${portfolio.settings.dateFrom}`
            : sql``;
        let dateToCondition = portfolio.settings.dateTo ? sql`AND p.entry_date <= ${portfolio.settings.dateTo}` : sql``;
        const { risk, profit, winRate, efficiency, moneyManagement } = portfolio.settings.options;
        const basePortfolio = await pg.maybeOne<{
            id: string;
            limits: PortfolioInfo["limits"];
            portfolioRobotsCount: number;
            settings: PortfolioSettings;
        }>(sql`SELECT p.id, p.limits, p.portfolio_robots_count, p.settings FROM v_portfolios p
            WHERE
             p.exchange = ${portfolio.exchange}
            AND p.base = true
            AND p.status = 'started'
            AND p.option_risk = ${risk}
            AND p.option_profit = ${profit}
            AND p.option_win_rate = ${winRate}
            AND p.option_efficiency = ${efficiency}
            AND p.option_money_management = ${moneyManagement}`);

        if (basePortfolio) {
            portfolio.context.minBalance = basePortfolio.limits.minBalance;
            portfolio.context.robotsCount = basePortfolio.portfolioRobotsCount;
        }
        const userPortfolioBuilder = new PortfolioBuilder<UserPortfolioState>(portfolio, subject);
        const maxRobotsCount = userPortfolioBuilder.maxRobotsCount;

        let hasPredefinedRobots = 0;
        let portfolioRobotsCondition = sql``;
        if (basePortfolio) {
            const portfolioRobots = await pg.any<{
                robotId: string;
            }>(sql`SELECT pr.robot_id FROM portfolio_robots pr,  robots r
        WHERE pr.portfolio_id = ${basePortfolio.id} 
        AND pr.robot_id = r.id
        ${includeRobotsCondition}
        ${excludeRobotsCondition}
        ${includeAssetsCondition}
        ${excludeAssetsCondition}
        ${includeTimeframesCondition}
        ${excludeTimeframesCondition}
        ORDER BY pr.priority 
        LIMIT ${maxRobotsCount}`);

            hasPredefinedRobots = portfolioRobots && Array.isArray(portfolioRobots) && portfolioRobots.length;
            portfolioRobotsCondition = hasPredefinedRobots
                ? sql`AND r.id in (${sql.join(
                      portfolioRobots.map((r) => r.robotId),
                      sql`, `
                  )})`
                : sql``;

            if (basePortfolio.settings.dateFrom)
                dateFromCondition = sql`AND p.entry_date >= ${basePortfolio.settings.dateFrom}`;
            if (basePortfolio.settings.dateTo)
                dateToCondition = sql`AND p.entry_date <= ${basePortfolio.settings.dateTo}`;
        }
        const positions: BasePosition[] = await DataStream.from(
            makeChunksGenerator(
                pg,
                sql`
        SELECT p.id, p.robot_id, p.direction, p.entry_date, p.entry_price,
         p.exit_date, p.exit_price, p.volume,
          p.worst_profit, p.max_price, p.profit, p.bars_held, m.min_amount_currency 
        FROM v_robot_positions p, robots r, users u, v_markets m
        WHERE p.robot_id = r.id 
          AND r.exchange = ${portfolio.exchange}
          AND u.id = ${portfolio.userId}
          AND r.available >= u.access
          AND p.emulated = 'false'
          AND p.status = 'closed'
          AND m.exchange = r.exchange 
          AND m.asset = r.asset
          AND m.currency = r.currency
          ${includeRobotsCondition}
          ${excludeRobotsCondition}
          ${includeAssetsCondition}
          ${excludeAssetsCondition}
          ${includeTimeframesCondition}
          ${excludeTimeframesCondition}
          ${dateFromCondition}
          ${dateToCondition}
          ${portfolioRobotsCondition}
          ORDER BY p.exit_date
        `,
                1000
            )
        ).reduce(async (accum: BasePosition[], chunk: BasePosition[]) => [...accum, ...chunk], []);

        if (!positions.length) throw new Error("No robots found for portfolio settings");
        userPortfolioBuilder.init(positions);

        logger.info(`#${job.userPortfolioId} user portfolio builder inited`);
        logger.info(`Processing #${userPortfolioBuilder.portfolio.id} user portfolio build`);
        const result = basePortfolio ? await userPortfolioBuilder.buildOnce() : await userPortfolioBuilder.build();

        await pg.transaction(async (t) => {
            await t.query(sql`UPDATE user_portfolio_settings 
            SET active = ${false}
            WHERE user_portfolio_id = ${result.portfolio.id};
            `);

            if (portfolio.userPortfolioSettingsActiveFrom) {
                await t.query(sql`
                INSERT INTO user_portfolio_settings 
                (user_portfolio_id,
                user_portfolio_settings,
                robots, 
                active, 
                active_from)
                 VALUES (
                ${job.userPortfolioId},
                ${JSON.stringify(result.portfolio.settings)},
                ${JSON.stringify(result.portfolio.robots)},
                ${true}, 
                ${dayjs.utc().toISOString()}
            );`);
            } else {
                await t.query(sql`UPDATE user_portfolio_settings 
            SET user_portfolio_settings = ${JSON.stringify(result.portfolio.settings)},
            robots = ${JSON.stringify(result.portfolio.robots)},
            active = ${true},
            active_from = ${dayjs.utc().toISOString()}
            WHERE id = ${result.portfolio.userPortfolioSettingsId};`);
            }
        });
        logger.info(`#${userPortfolioBuilder.portfolio.id} user portfolio build finished`);
    },
    progress() {
        return Observable.from(subject);
    }
};

export type PortfolioWorker = typeof worker;

expose(worker);
