import { expose } from "threads/worker";
import logger from "@cryptuoso/logger";
import { DataStream } from "scramjet";
import { sql, pg, makeChunksGenerator, pgUtil } from "@cryptuoso/postgres";
import { PortfolioBuilder, PortfolioBuilderJob, PortfolioState } from "@cryptuoso/portfolio-state";
import { BasePosition } from "@cryptuoso/market";

let portfolioBuilder: PortfolioBuilder;

const worker = {
    async init(job: PortfolioBuilderJob) {
        logger.info(`Initing #${job.portfolioId} builder`);
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
        const positions: BasePosition[] = await DataStream.from(
            makeChunksGenerator(
                pg,
                sql`
        SELECT p.id, p.robot_id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.volume, p.worst_profit, p.max_price, p.profit, p.bars_held
        FROM v_robot_positions p, robots r 
        WHERE p.robot_id = r.id 
          AND r.exchange = ${portfolio.exchange}
          AND r.available >= ${portfolio.available}
          AND p.status = 'closed'
          ORDER BY p.exit_date
        `,
                10000
            )
        ).reduce(async (accum: BasePosition[], chunk: BasePosition[]) => [...accum, ...chunk], []);

        portfolioBuilder = new PortfolioBuilder(portfolio, positions);
        logger.info(`#${job.portfolioId} builder inited`);
    },
    async process() {
        logger.info(`Processing #${portfolioBuilder.portfolio.id} build`);
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
            INSERT INTO portfolio_robots 
            (portfolio_id, robot_id, active, share)
            SELECT *
                FROM ${sql.unnest(
                    pgUtil.prepareUnnest(
                        result.portfolio.robots.map((r) => ({ ...r, portfolioId: result.portfolio.id })),
                        ["portfolioId", "robotId", "active", "share"]
                    ),
                    ["uuid", "uuid", "bool", "numeric"]
                )}
                ON CONFLICT ON CONSTRAINT portfolio_robots_pkey
                DO UPDATE SET active = excluded.active,
                share = excluded.share;
            `);
        });
        logger.info(`#${portfolioBuilder.portfolio.id} build finished`);
    }
};

export type PortfolioWorker = typeof worker;

expose(worker);
