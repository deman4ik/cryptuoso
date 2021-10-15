import dayjs from "@cryptuoso/dayjs";
import { BasePosition } from "@cryptuoso/market";
import { pgUtil, sql } from "@cryptuoso/postgres";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { TradeStats, TradeStatsCalc } from "@cryptuoso/trade-stats";
export type UtilsServiceConfig = HTTPServiceConfig;

export default class UtilsService extends HTTPService {
    constructor(config?: UtilsServiceConfig) {
        super(config);

        try {
            // this.addOnStartedHandler(this.onStarted);
        } catch (err) {
            this.log.error("Error while constructing UtilsService", err);
        }
    }

    /*  async onStarted() {
        const portfolios = [
            {
                portfolioId: "276438d9-493e-490a-a4ec-47205b22cc44",
                dateFrom: dayjs.utc("2021-01-01").startOf("month").toISOString(),
                dateTo: dayjs.utc("2021-01-01").endOf("month").toISOString()
            },
            {
                portfolioId: "cfa08a09-9f97-47d2-af1e-1be444e479fc",
                dateFrom: dayjs.utc("2021-02-01").startOf("month").toISOString(),
                dateTo: dayjs.utc("2021-02-01").endOf("month").toISOString()
            },
            {
                portfolioId: "8e50a62e-5970-4097-ba07-896ab566ba1f",
                dateFrom: dayjs.utc("2021-03-01").startOf("month").toISOString(),
                dateTo: dayjs.utc("2021-03-01").endOf("month").toISOString()
            },
            {
                portfolioId: "75164977-002e-4a9b-acb8-5eccb16c5d1c",
                dateFrom: dayjs.utc("2021-04-01").startOf("month").toISOString(),
                dateTo: dayjs.utc("2021-04-01").endOf("month").toISOString()
            },
            {
                portfolioId: "426ffe79-1c24-4a9b-8f4b-dfadc6f5e5e8",
                dateFrom: dayjs.utc("2021-05-01").startOf("month").toISOString(),
                dateTo: dayjs.utc("2021-05-01").endOf("month").toISOString()
            },
            {
                portfolioId: "8d6120ee-08a6-49d8-bea0-dbc7f8f6b05d",
                dateFrom: dayjs.utc("2021-06-01").startOf("month").toISOString(),
                dateTo: dayjs.utc("2021-06-01").endOf("month").toISOString()
            },
            {
                portfolioId: "c98a66b4-805b-4483-a3bb-78ecb12d096f",
                dateFrom: dayjs.utc("2021-07-01").startOf("month").toISOString(),
                dateTo: dayjs.utc("2021-07-01").endOf("month").toISOString()
            },
            {
                portfolioId: "07fe03e5-76e8-4fb6-b6e3-dd880b1783f7",
                dateFrom: dayjs.utc("2021-08-01").startOf("month").toISOString(),
                dateTo: dayjs.utc("2021-08-01").endOf("month").toISOString()
            },
            {
                portfolioId: "7b1c6ce0-ca00-4dda-a1cb-8a9266e45a9b",
                dateFrom: dayjs.utc("2021-09-01").startOf("month").toISOString(),
                dateTo: dayjs.utc("2021-09-01").endOf("month").toISOString()
            },
            {
                portfolioId: "0864e53f-da75-4428-a205-af19ce3cabf6",
                dateFrom: dayjs.utc("2021-10-01").startOf("month").toISOString(),
                dateTo: dayjs.utc("2021-10-01").endOf("month").toISOString()
            }
        ];

        //let allPositions: BasePosition[] = [];
        /*   for (const portfolio of portfolios) {
            const positions = await this.db.pg.any<BasePosition>(sql`
          SELECT p.id, p.robot_id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.bars_held, p.meta, p.max_price
          FROM v_portfolio_robot_positions p
        WHERE p.portfolio_id = ${portfolio.portfolioId}
        AND p.status = 'closed'
        AND p.entry_date > ${portfolio.dateFrom}
        and p.entry_date < ${portfolio.dateTo}
        ORDER BY p.exit_date
    `);
            this.log.debug(portfolio.portfolioId, positions.length);
            if (positions && Array.isArray(positions) && positions.length)
                allPositions = [...allPositions, ...positions];
        }
        const allPositions = await this.db.pg.any<BasePosition>(sql`
        SELECT p.id, p.robot_id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.bars_held, p.meta, p.max_price
        FROM v_portfolio_robot_positions p
      WHERE p.portfolio_id =  '276438d9-493e-490a-a4ec-47205b22cc44'
      AND p.status = 'closed'
      AND p.entry_date > ${dayjs.utc("2021-01-01").startOf("month").toISOString()}
      ORDER BY p.exit_date
  `);

        const portfolioId = "db2e5ca0-f27a-40ca-b1bf-ca94cf80960e";
        const tradeStatsCalc = new TradeStatsCalc(
            [...allPositions],
            {
                job: {
                    type: "portfolio",
                    portfolioId,
                    feeRate: 0.0004,
                    recalc: true,
                    savePositions: false
                },
                initialBalance: 10000
            },
            null
        );
        const newStats = await tradeStatsCalc.calculate();

        await this.db.pg.query(sql`
        UPDATE portfolios
        SET full_stats = ${JSON.stringify(newStats.fullStats)}
        WHERE id = ${portfolioId};`);

        this.log.debug("done");
    }*/
}
