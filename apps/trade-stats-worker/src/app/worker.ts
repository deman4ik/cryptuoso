import { expose } from "threads/worker";
import { DataStream } from "scramjet";
import { BasePosition } from "@cryptuoso/market";
import {
    PeriodStats,
    TradeStatsJob,
    TradeStatsPortfolio,
    TradeStatsRobot,
    TradeStatsUserPortfolio,
    TradeStatsUserRobot,
    StatsMeta,
    TradeStats,
    TradeStatsCalc,
    TradeStatsDB,
    periodStatsFromArray,
    periodStatsToArray,
    FullStats
} from "@cryptuoso/trade-stats";
import logger, { Logger } from "@cryptuoso/logger";
import { sql, pg, pgUtil, makeChunksGenerator } from "@cryptuoso/postgres";
import { PortfolioSettings } from "@cryptuoso/portfolio-state";
import { equals } from "@cryptuoso/helpers";

class StatsCalcWorker {
    private dummy = "-";
    #log: Logger;
    #db: { sql: typeof sql; pg: typeof pg; util: typeof pgUtil };
    maxSingleQueryPosCount = 10000;
    defaultChunkSize = 10000;

    constructor() {
        this.#log = logger;
        this.#db = {
            sql,
            pg: pg,
            util: pgUtil
        };
    }
    get log() {
        return this.#log;
    }

    get db() {
        return this.#db;
    }

    async process(job: TradeStatsJob) {
        switch (job.type) {
            case "robot":
                await this.calcRobot(job as TradeStatsRobot);
                break;
            case "portfolio":
                await this.calcPortfolio(job as TradeStatsPortfolio);
                break;
            case "userRobot":
                await this.calcUserRobot(job as TradeStatsUserRobot);
                break;
            case "userPortfolio":
                await this.calcUserPortfolio(job as TradeStatsUserPortfolio);
                break;
            default:
                this.log.error(`Unsupported stats calc type`);
        }
    }

    calcStats(positions: BasePosition[], meta: StatsMeta, prevStats?: TradeStats) {
        const tradeStatsCalc = new TradeStatsCalc(positions, meta, prevStats);
        return tradeStatsCalc.calculate();
    }

    async calcRobot(job: TradeStatsRobot) {
        try {
            let { recalc = false } = job;
            const { robotId } = job;

            let initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            let initialEmulatedStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            if (!recalc) {
                const prevStats = await this.db.pg.one<{
                    fullStats: FullStats;
                    periodStats: PeriodStats[];
                    emulatedFullStats: FullStats;
                    emulatedPeriodStats: PeriodStats[];
                }>(sql`
            SELECT r.full_stats, r.period_stats, r.emulated_full_stats, r.emulated_period_stats
            FROM robots r
            WHERE r.id = ${robotId};
        `);

                if (!prevStats) throw new Error(`The robot doesn't exists (robotId: ${robotId})`);

                if (!prevStats.emulatedFullStats) recalc = true;
                else {
                    initialEmulatedStats = {
                        fullStats: prevStats.emulatedFullStats,
                        periodStats: periodStatsFromArray(prevStats.emulatedPeriodStats)
                    };
                    initialStats = {
                        fullStats: prevStats.fullStats,
                        periodStats: periodStatsFromArray(prevStats.periodStats)
                    };
                }
            }

            let calcFrom;

            if (!recalc && initialStats?.fullStats) {
                calcFrom = initialStats.fullStats.lastPosition.exitDate;
            }
            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, 
            p.volume, p.worst_profit, p.profit, p.bars_held, p.max_price, p.margin, p.emulated
        `;
            const queryFromAndConditionPart = sql`
            FROM v_robot_positions p
            WHERE p.robot_id = ${robotId}
                AND p.status = 'closed'
                ${conditionExitDate}
        `;

            const fullPositions = await this.db.pg.any<BasePosition>(sql`
            ${querySelectPart}
            ${queryFromAndConditionPart}
            ORDER BY p.exit_date;
        `);

            if (!fullPositions || !fullPositions.length) return;
            const newEmulatedStats = this.calcStats([...fullPositions], { job }, initialEmulatedStats);

            const notEmulatedPositions = fullPositions.filter((p) => !p.emulated);

            let newStats = initialStats;
            if (notEmulatedPositions.length) {
                if (
                    notEmulatedPositions.length === fullPositions.length &&
                    equals(initialEmulatedStats, initialStats)
                ) {
                    newStats = newEmulatedStats;
                } else newStats = this.calcStats([...notEmulatedPositions], { job }, initialStats);
            }
            await this.db.pg.query(sql`
        UPDATE robots 
        SET full_stats = ${JSON.stringify(newStats.fullStats)},
        period_stats = ${JSON.stringify(periodStatsToArray(newStats.periodStats))},
        emulated_full_stats = ${JSON.stringify(newEmulatedStats.fullStats)},
        emulated_period_stats = ${JSON.stringify(periodStatsToArray(newEmulatedStats.periodStats))},
        WHERE id = ${robotId};
        `);
        } catch (err) {
            this.log.error("Failed to calcRobot stats", err);
            this.log.debug(job);

            throw err;
        }
    }

    async calcPortfolio(job: TradeStatsPortfolio) {
        try {
            let { recalc = false } = job;
            const { portfolioId } = job;

            let initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            const portfolio = await this.db.pg.maybeOne<TradeStatsDB & { settings: PortfolioSettings }>(sql`
            SELECT r.full_stats, r.period_stats, r.settings
            FROM portfolios r
            WHERE r.id = ${portfolioId};
        `);
            if (!portfolio) throw new Error(`The portfolio doesn't exists (portfolioId: ${portfolioId})`);

            if (!recalc) {
                if (!portfolio.fullStats) recalc = true;
                else
                    initialStats = {
                        fullStats: portfolio.fullStats,
                        periodStats: periodStatsFromArray(portfolio.periodStats)
                    };
            }

            let calcFrom;
            if (!recalc && initialStats?.fullStats) {
                calcFrom = initialStats.fullStats.lastPosition.exitDate;
            }

            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.volume, p.worst_profit, p.profit, p.bars_held
        `;
            const queryFromAndConditionPart = sql`
            FROM v_portfolio_robot_positions p
            WHERE p.portfolio_id = ${portfolioId}
                AND p.status = 'closed'
                ${conditionExitDate}
        `;
            const queryCommonPart = sql`
            ${querySelectPart}
            ${queryFromAndConditionPart}
            ORDER BY exit_date
        `;

            const positionsCount = await this.db.pg.oneFirst<number>(sql`
            SELECT COUNT(1)
            ${queryFromAndConditionPart};
        `);

            if (positionsCount == 0) return false;

            const newStats: TradeStats = await DataStream.from(
                makeChunksGenerator(
                    this.db.pg,
                    queryCommonPart,
                    positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
                )
            ).reduce(
                async (prevStats: TradeStats, chunk: BasePosition[]) =>
                    await this.calcStats(chunk, { job, initialBalance: portfolio.settings.initialBalance }, prevStats),
                initialStats
            );
            await this.db.pg.query(sql`
            UPDATE portfolios 
            SET full_stats = ${JSON.stringify(newStats.fullStats)},
            period_stats = ${JSON.stringify(periodStatsToArray(newStats.periodStats))}
            WHERE id = ${portfolioId};
            `);
        } catch (err) {
            this.log.error("Failed to calcPortfolio stats", err);
            this.log.debug(job);
            throw err;
        }
    }

    async calcUserRobot(job: TradeStatsUserRobot) {
        try {
            let { recalc = false } = job;
            const { userRobotId } = job;

            let initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            if (!recalc) {
                const prevStats = await this.db.pg.maybeOne<TradeStatsDB>(sql`
            SELECT ur.full_stats, ur.period_stats
            FROM user_robots ur
            WHERE ur.id = ${userRobotId};
        `);

                if (!prevStats) throw new Error(`The user robot doesn't exists (userRobotId: ${userRobotId})`);

                if (!prevStats.fullStats) recalc = true;
                else
                    initialStats = {
                        fullStats: prevStats.fullStats,
                        periodStats: periodStatsFromArray(prevStats.periodStats)
                    };
            }

            let calcFrom;
            if (!recalc && initialStats?.fullStats) {
                calcFrom = initialStats.fullStats.lastPosition.exitDate;
            }

            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.exit_executed as volume, p.worst_profit, p.profit, p.bars_held
        `;
            const queryFromAndConditionPart = sql`
            FROM v_user_positions p
            WHERE p.user_robot_id = ${userRobotId}
                AND p.status = 'closed'
                ${conditionExitDate}
        `;
            const queryCommonPart = sql`
            ${querySelectPart}
            ${queryFromAndConditionPart}
            ORDER BY p.exit_date
        `;

            const positionsCount = await this.db.pg.oneFirst<number>(sql`
            SELECT COUNT(1)
            ${queryFromAndConditionPart};
        `);

            if (positionsCount == 0) return false;

            const newStats: TradeStats = await DataStream.from(
                makeChunksGenerator(
                    this.db.pg,
                    queryCommonPart,
                    positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
                )
            ).reduce(
                async (prevStats: TradeStats, chunk: BasePosition[]) => await this.calcStats(chunk, { job }, prevStats),
                initialStats
            );

            await this.db.pg.query(sql`
            UPDATE user_robots 
            SET full_stats = ${JSON.stringify(newStats.fullStats)},
            period_stats = ${JSON.stringify(periodStatsToArray(newStats.periodStats))}
            WHERE id = ${userRobotId}; `);
        } catch (err) {
            this.log.error("Failed to calcUserRobot stats", err);
            this.log.debug(job);
            throw err;
        }
    }

    async calcUserPortfolio(job: TradeStatsUserPortfolio) {
        try {
            let { recalc = false } = job;
            const { userPortfolioId } = job;

            let initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            const userPortfolio = await this.db.pg.maybeOne<TradeStatsDB & { settings: PortfolioSettings }>(sql`
            SELECT r.full_stats, r.period_stats, r.settings
            FROM user_portfolios r
            WHERE r.id = ${userPortfolioId};
        `);
            if (!userPortfolio)
                throw new Error(`The user portfolio doesn't exists (userPortfolioId: ${userPortfolioId})`);

            if (!recalc) {
                if (!userPortfolio.fullStats) recalc = true;
                else
                    initialStats = {
                        fullStats: userPortfolio.fullStats,
                        periodStats: periodStatsFromArray(userPortfolio.periodStats)
                    };
            }

            let calcFrom;
            if (!recalc && initialStats?.fullStats) {
                calcFrom = initialStats.fullStats.lastPosition.exitDate;
            }

            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.volume, p.worst_profit, p.profit, p.bars_held
        `;
            const queryFromAndConditionPart = sql`
            FROM v_user_positions p
            WHERE p.user_portfolio_id = ${userPortfolioId}
                AND p.status = 'closed'
                ${conditionExitDate}
        `;
            const queryCommonPart = sql`
            ${querySelectPart}
            ${queryFromAndConditionPart}
            ORDER BY p.exit_date
        `;

            const positionsCount = await this.db.pg.oneFirst<number>(sql`
            SELECT COUNT(1)
            ${queryFromAndConditionPart};
        `);

            if (positionsCount == 0) return false;

            const newStats: TradeStats = await DataStream.from(
                makeChunksGenerator(
                    this.db.pg,
                    queryCommonPart,
                    positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
                )
            ).reduce(
                async (prevStats: TradeStats, chunk: BasePosition[]) =>
                    await this.calcStats(
                        chunk,
                        { job, initialBalance: userPortfolio.settings.initialBalance },
                        prevStats
                    ),
                initialStats
            );

            await this.db.pg.query(sql`
            UPDATE user_portfolios 
            SET full_stats = ${JSON.stringify(newStats.fullStats)},
            period_stats = ${JSON.stringify(periodStatsToArray(newStats.periodStats))}
            WHERE id = ${userPortfolioId};
            `);
        } catch (err) {
            this.log.error("Failed to calcUserPorfolio stats", err);
            this.log.debug(job);
            throw err;
        }
    }
}

const statsCalcWorker = new StatsCalcWorker();

const worker = {
    async process(job: TradeStatsJob) {
        const result = await statsCalcWorker.process(job);
        return result;
    }
};

export type StatsWorker = typeof worker;

expose(worker);
