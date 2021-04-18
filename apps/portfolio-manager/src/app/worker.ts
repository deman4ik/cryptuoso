import { expose } from "threads/worker";
import logger, { Logger } from "@cryptuoso/logger";
import { DataStream } from "scramjet";
import { sql, pg, makeChunksGenerator } from "@cryptuoso/postgres";
import { PortfolioBuilder, PortfolioBuilderJob, PortfolioState } from "@cryptuoso/portfolio-state";
import { BasePosition } from "@cryptuoso/market";

let portfolioBuilder: PortfolioBuilder;

const worker = {
    async init(job: PortfolioBuilderJob) {
        const portfolio: PortfolioState = await pg.one(sql`
        SELECT p.id, p.code, p.name, p.exchange, p.available, p.settings, p.stats 
        FROM portfolios p 
        WHERE p.id = ${job.portfolioId}; 
        `);
        const positions: BasePosition[] = await DataStream.from(
            makeChunksGenerator(
                this.db.pg,
                sql`
        SELECT p.id, p.robot_id, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.volume, p.worst_profit, p.profit, p.bars_held
        FROM v_robot_positions p, robots r 
        WHERE p.robot_id = r.id 
          AND r.exchange = ${portfolio.exchange}
          AND r.available >= ${portfolio.available}
          AND p.status = 'closed'
          ORDER BY p.exit_date;
        `,
                10000
            )
        ).reduce(async (accum: BasePosition[], chunk: BasePosition[]) => [...accum, ...chunk], []);

        portfolioBuilder = new PortfolioBuilder(portfolio, positions);
    },
    async process() {
        const result = await portfolioBuilder.build();
        return result;
    }
};

export type PortfolioWorker = typeof worker;

expose(worker);
