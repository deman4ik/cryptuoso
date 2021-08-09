import { Observable, Subject } from "threads/observable";
import { expose } from "threads/worker";
import logger from "@cryptuoso/logger";
import { DataStream } from "scramjet";
import { sql, pg, makeChunksGenerator, pgUtil } from "@cryptuoso/postgres";
import {
    PortfolioBuilder,
    PortfolioBuilderJob,
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
            SELECT p.id, p.code, p.name, p.exchange, p.available, p.settings,
                   json_build_object('minTradeAmount', m.min_trade_amount,
                                     'feeRate', m.fee_rate) as context
            FROM portfolios p, 
                 (SELECT mk.exchange, 
	                     max(mk.min_amount_currency) as min_trade_amount, 
	                     max(mk.fee_rate) as fee_rate 
	              FROM v_markets mk
                  GROUP BY mk.exchange) m
            WHERE p.exchange = m.exchange
              AND p.id = ${job.portfolioId}; 
        `);
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

        const positions: BasePosition[] = await DataStream.from(
            makeChunksGenerator(
                pg,
                sql`
        SELECT p.id, p.robot_id, p.direction, p.entry_date, p.entry_price,
         p.exit_date, p.exit_price, p.volume,
          p.worst_profit, p.max_price, p.profit, p.bars_held
        FROM v_robot_positions p, robots r 
        WHERE p.robot_id = r.id 
          AND r.exchange = ${portfolio.exchange}
          AND r.available >= ${portfolio.available}
          AND p.emulated = 'false'
          AND p.status = 'closed'
          ${includeAssetsCondition}
          ${excludeAssetsCondition}
          ORDER BY p.exit_date
        `,
                10000
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
            UPDATE portfolios SET full_stats = ${JSON.stringify(
                result.portfolio.fullStats
            )}, period_stats = ${JSON.stringify(result.portfolio.periodStats)},
            settings = ${JSON.stringify(result.portfolio.settings)}
            WHERE id = ${result.portfolio.id}
            `);

            await t.query(sql`
                DELETE FROM  portfolio_robots 
                WHERE portfolio_id = ${result.portfolio.id};`);
            await t.query(sql`
            INSERT INTO portfolio_robots 
            (portfolio_id, robot_id, active, share)
            SELECT *
                FROM ${sql.unnest(
                    pgUtil.prepareUnnest(
                        result.portfolio.robots.map((r) => ({ ...r, portfolioId: result.portfolio.id })),
                        ["portfolioId", "robotId", "active", "share"]
                    ),
                    ["uuid", "uuid", "bool", "numeric"]
                )};
            `);
        });
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
                 (SELECT mk.exchange, 
	                     max(mk.min_amount_currency) as min_trade_amount, 
	                     max(mk.fee_rate) as fee_rate 
	              FROM v_markets mk
                  GROUP BY mk.exchange) m
            WHERE p.exchange = m.exchange
              AND p.id = ups.user_portfolio_id
              AND (ups.active_from is null OR ups.active_from = ((SELECT max(s.active_from) AS max
                    FROM user_portfolio_settings s
                    WHERE s.user_portfolio_id = p.id 
                      AND s.active_from IS NOT NULL 
                      AND s.active_from < now()))
                  )
              AND p.id = ${job.userPortfolioId}; 
        `);
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
                ? sql`AND r.asset IN (${sql.join(portfolio.settings.excludeAssets, sql`, `)})`
                : sql``;

        const userPortfolioBuilder = new PortfolioBuilder<UserPortfolioState>(portfolio, subject);
        const maxRobotsCount = userPortfolioBuilder.maxRobotsCount;
        const { risk, profit, winRate, efficiency, diversification, moneyManagement } = portfolio.settings.options;
        const portfolioRobots = await pg.any<{
            robotId: string;
        }>(sql`SELECT pr.robot_id FROM portfolio_robots pr, v_portfolios p, robots r
        WHERE pr.portfolio_id = p.id 
        AND pr.robot_id = r.id
        AND p.option_risk = ${risk}
        AND p.option_profit = ${profit}
        AND p.option_win_rate = ${winRate}
        AND p.option_efficiency = ${efficiency}
        AND p.option_diversification = ${diversification}
        AND p.option_money_management = ${moneyManagement}
        ${includeAssetsCondition}
        ${excludeAssetsCondition}
        ORDER BY pr.priority 
        LIMIT ${maxRobotsCount}`);

        const hasPredefinedRobots = portfolioRobots && Array.isArray(portfolioRobots) && portfolioRobots.length;
        const portfolioRobotsCondition = hasPredefinedRobots
            ? sql`r.id in (${sql.join(
                  portfolioRobots.map((r) => r.robotId),
                  sql`, `
              )})`
            : sql``;

        const positions: BasePosition[] = await DataStream.from(
            makeChunksGenerator(
                pg,
                sql`
        SELECT p.id, p.robot_id, p.direction, p.entry_date, p.entry_price,
         p.exit_date, p.exit_price, p.volume,
          p.worst_profit, p.max_price, p.profit, p.bars_held
        FROM v_robot_positions p, robots r, users u 
        WHERE p.robot_id = r.id 
          AND r.exchange = ${portfolio.exchange}
          AND u.id = ${portfolio.userId}
          AND r.available >= u.access
          AND p.emulated = 'false'
          AND p.status = 'closed'
          ${includeAssetsCondition}
          ${excludeAssetsCondition}
          ${portfolioRobotsCondition}
          ORDER BY p.exit_date
        `,
                10000
            )
        ).reduce(async (accum: BasePosition[], chunk: BasePosition[]) => [...accum, ...chunk], []);

        userPortfolioBuilder.init(positions);

        logger.info(`#${job.userPortfolioId} user portfolio builder inited`);
        logger.info(`Processing #${userPortfolioBuilder.portfolio.id} user portfolio build`);
        const result = hasPredefinedRobots
            ? await userPortfolioBuilder.buildOnce()
            : await userPortfolioBuilder.build();

        await pg.transaction(async (t) => {
            await t.query(sql`UPDATE user_portfolio_settings 
            SET active = ${false}
            WHERE user_portfolio_id = ${result.portfolio.id};
            `);

            if (portfolio.userPortfolioSettingsActiveFrom) {
                await t.query(sql`
                INSERT INTO user_portfolio_settings 
                (user_portfolio_settings, 
                robots, 
                active, 
                active_from)
                 VALUES (
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
