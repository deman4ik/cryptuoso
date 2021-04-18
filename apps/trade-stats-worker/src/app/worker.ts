import { expose } from "threads/worker";
import { DataStream } from "scramjet";
import { BasePosition } from "@cryptuoso/market";
import {
    FullStats,
    PeriodStats,
    TradeStatsAllPortfoliosAggr,
    TradeStatsAllRobotsAggr,
    TradeStatsAllUserPortfoliosAggr,
    TradeStatsAllUserRobotsAggr,
    TradeStatsJob,
    TradeStatsPortfolio,
    TradeStatsRobot,
    TradeStatsUserPortfolio,
    TradeStatsUserRobot,
    TradeStatsUserRobotsAggr,
    TradeStatsUserSignal,
    TradeStatsUserSignalsAggr,
    StatsMeta,
    TradeStats,
    TradeStatsCalc
} from "@cryptuoso/trade-stats";
import logger, { Logger } from "@cryptuoso/logger";
import { sql, pg, pgUtil, makeChunksGenerator } from "@cryptuoso/postgres";
import { UserAggrStatsTypes } from "@cryptuoso/user-state";

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
            case "userSignal":
                await this.calcUserSignal(job as TradeStatsUserSignal);
                break;
            case "userRobot":
                await this.calcUserRobot(job as TradeStatsUserRobot);
                break;
            case "userPortfolio":
                await this.calcUserPortfolio(job as TradeStatsUserPortfolio);
                break;
            case "userSignalsAggr":
                await this.calcUserSignalsAggr(job as TradeStatsUserSignalsAggr);
                break;
            case "userRobotsAggr":
                await this.calcUserRobotsAggr(job as TradeStatsUserRobotsAggr);
                break;
            case "allRobotsAggr":
                await this.calcAllRobotsAggr(job as TradeStatsAllRobotsAggr);
                break;
            case "allUserRobotsAggr":
                await this.calcAllUserRobotsAggr(job as TradeStatsAllUserRobotsAggr);
                break;
            case "allPortfoliosAggr":
                await this.calcAllPortfoliosAggr(job as TradeStatsAllPortfoliosAggr);
                break;
            case "allUserPortfoliosAggr":
                await this.calcAllUserPortfoliosAggr(job as TradeStatsAllUserPortfoliosAggr);
                break;
            default:
                this.log.error(`Unsupported stats calc type`);
        }
    }

    calcStats(positions: BasePosition[], meta: StatsMeta, prevStats?: TradeStats) {
        const tradeStatsCalc = new TradeStatsCalc(positions, meta, prevStats);
        return tradeStatsCalc.calculate();
    }

    periodStatsFromArray(arr: PeriodStats[]) {
        const periodStats: TradeStats["periodStats"] = {
            year: {},
            quarter: {},
            month: {}
        };
        for (const period of arr.filter(({ period }) => period === "year")) {
            periodStats.year[`${period.year}`] = period;
        }
        for (const period of arr.filter(({ period }) => period === "quarter")) {
            periodStats.year[`${period.year}.${period.quarter}`] = period;
        }
        for (const period of arr.filter(({ period }) => period === "month")) {
            periodStats.year[`${period.year}.${period.month}`] = period;
        }
        return periodStats;
    }

    periodStatsToArray(periodStats: TradeStats["periodStats"]) {
        return [
            ...Object.values(periodStats.year),
            ...Object.values(periodStats.quarter),
            ...Object.values(periodStats.month)
        ];
    }

    async calcRobot(job: TradeStatsRobot) {
        try {
            let { recalc = false } = job;
            const { robotId } = job;

            const initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            let prevFullStats: { stats: FullStats };
            if (!recalc) {
                prevFullStats = await this.db.pg.maybeOne<{ stats: FullStats }>(sql`
            SELECT rs.stats
            FROM robots r
            LEFT JOIN robot_stats rs
                ON r.id = rs.robot_id
            WHERE r.id = ${robotId};
        `);

                if (!prevFullStats) throw new Error(`The robot doesn't exists (robotId: ${robotId})`);

                if (!prevFullStats.stats) recalc = true;
            }

            if (prevFullStats?.stats) {
                const prevPeriodStats = await this.db.pg.any<PeriodStats>(sql`
                SELECT rps.period, rps.year, rps.quarter, rps.month, rps.date_from, rps.date_to, rps.stats 
                FROM robot_period_stats rps
                WHERE rps.robot_id = ${robotId}
                ORDER BY rps.year, rps.quarter, rps.month;
                `);

                if (!prevPeriodStats || !prevPeriodStats.length || prevPeriodStats.length < 3) {
                    recalc = true;
                } else {
                    initialStats.fullStats = prevFullStats.stats;
                    initialStats.periodStats = this.periodStatsFromArray([...prevPeriodStats]);
                }
            }

            let calcFrom;
            if (!recalc && prevFullStats?.stats) {
                calcFrom = prevFullStats.stats.lastPosition.exitDate;
            }

            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.volume, p.worst_profit, p.profit, p.bars_held
        `;
            const queryFromAndConditionPart = sql`
            FROM v_robot_positions p
            WHERE p.robot_id = ${robotId}
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

            const newPeriodStats = this.periodStatsToArray(newStats.periodStats);
            await this.db.pg.query(sql`
            INSERT INTO robot_stats (
                robot_id,
                stats   
            ) VALUES (
                ${robotId}, 
                ${JSON.stringify(newStats.fullStats)}
            ) ON CONFLICT ON CONSTRAINT robots_stats_pkey
            DO UPDATE SET stats = excluded.stats;
        `);

            await this.db.pg.query(sql`
        INSERT INTO robot_period_stats (
            robot_id, period, year, quarter, month, date_from, date_to, stats)
            SELECT * FROM ${sql.unnest(
                this.db.util.prepareUnnest(
                    newPeriodStats.map((s) => ({
                        ...s,
                        stats: JSON.stringify(s.stats),
                        robotId
                    })),
                    ["robotId", "period", "year", "quarter", "month", "dateFrom", "dateTo", "stats"]
                ),
                ["uuid", "varchar", "int8", "int8", "int8", "timestamp", "timestamp", "jsonb"]
            )}
            ON CONFLICT ON CONSTRAINT robot_period_stats_ukey
            DO UPDATE SET stats = excluded.stats;
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

            const initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            let prevFullStats: { stats: FullStats };
            if (!recalc) {
                prevFullStats = await this.db.pg.maybeOne<{ stats: FullStats }>(sql`
            SELECT rs.stats
            FROM portfolios r
            LEFT JOIN portfolio_stats rs
                ON r.id = rs.robot_id
            WHERE r.id = ${portfolioId};
        `);

                if (!prevFullStats) throw new Error(`The portfolio doesn't exists (portfolioId: ${portfolioId})`);

                if (!prevFullStats.stats) recalc = true;
            }

            if (prevFullStats?.stats) {
                const prevPeriodStats = await this.db.pg.any<PeriodStats>(sql`
                SELECT period, year, quarter, month, date_from, date_to, stats 
                FROM portfolio_period_stats
                WHERE portfolio_id = ${portfolioId}
                ORDER BY year, quarter, month;
                `);

                if (!prevPeriodStats || !prevPeriodStats.length || prevPeriodStats.length < 3) {
                    recalc = true;
                } else {
                    initialStats.fullStats = prevFullStats.stats;
                    initialStats.periodStats = this.periodStatsFromArray([...prevPeriodStats]);
                }
            }

            let calcFrom;
            if (!recalc && prevFullStats?.stats) {
                calcFrom = prevFullStats.stats.lastPosition.exitDate;
            }

            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.volume, p.worst_profit, p.profit, p.bars_held
        `;
            const queryFromAndConditionPart = sql`
            FROM v_portfolio_positions p
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
                async (prevStats: TradeStats, chunk: BasePosition[]) => await this.calcStats(chunk, { job }, prevStats),
                initialStats
            );
            //TODO: initialBalance
            const newPeriodStats = this.periodStatsToArray(newStats.periodStats);
            await this.db.pg.query(sql`
            INSERT INTO portfolio_stats (
                portfolio_id,
                stats   
            ) VALUES (
                ${portfolioId}, 
                ${JSON.stringify(newStats.fullStats)}
            ) ON CONFLICT ON CONSTRAINT portfolio_stats_pkey
            DO UPDATE SET stats = excluded.stats;
        `);

            await this.db.pg.query(sql`
        INSERT INTO portfolio_period_stats (
            portfolio_id, period, year, quarter, month, date_from, date_to, stats)
            SELECT * FROM ${sql.unnest(
                this.db.util.prepareUnnest(
                    newPeriodStats.map((s) => ({
                        ...s,
                        stats: JSON.stringify(s.stats),
                        portfolioId
                    })),
                    ["portfolioId", "period", "year", "quarter", "month", "dateFrom", "dateTo", "stats"]
                ),
                ["uuid", "varchar", "int8", "int8", "int8", "timestamp", "timestamp", "jsonb"]
            )}
            ON CONFLICT ON CONSTRAINT portfolio_period_stats_ukey
            DO UPDATE SET stats = excluded.stats;
        `);
        } catch (err) {
            this.log.error("Failed to calcPortfolio stats", err);
            this.log.debug(job);
            throw err;
        }
    }

    async calcUserSignal(job: TradeStatsUserSignal) {
        try {
            let { recalc = false } = job;
            const { userSignalId } = job;

            const initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            let prevFullStats: { stats: FullStats };
            if (!recalc) {
                prevFullStats = await this.db.pg.maybeOne<{ stats: FullStats }>(sql`
            SELECT uss.stats
            FROM user_signals us
            LEFT JOIN user_signal_stats uss
                ON us.id = uss.user_signal_id
            WHERE us.id = ${userSignalId};
        `);

                if (!prevFullStats) throw new Error(`The user signal doesn't exists (userSignalId: ${userSignalId})`);

                if (!prevFullStats.stats) recalc = true;
            }

            if (prevFullStats?.stats) {
                const prevPeriodStats = await this.db.pg.any<PeriodStats>(sql`
                SELECT period, year, quarter, month, date_from, date_to, stats 
                FROM user_signal_period_stats
                WHERE user_signal_id = ${userSignalId}
                ORDER BY year, quarter, month;
                `);

                if (!prevPeriodStats || !prevPeriodStats.length || prevPeriodStats.length < 3) {
                    recalc = true;
                } else {
                    initialStats.fullStats = prevFullStats.stats;
                    initialStats.periodStats = this.periodStatsFromArray([...prevPeriodStats]);
                }
            }

            let calcFrom;
            if (!recalc && prevFullStats?.stats) {
                calcFrom = prevFullStats.stats.lastPosition.exitDate;
            }

            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.volume, p.worst_profit, p.profit, p.bars_held
        `;
            const queryFromAndConditionPart = sql`
            FROM v_user_signal_positions p
            WHERE p.user_signal_id = ${userSignalId}
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

            const newPeriodStats = this.periodStatsToArray(newStats.periodStats);
            await this.db.pg.query(sql`
            INSERT INTO user_signal_stats (
                user_signal_id,
                stats   
            ) VALUES (
                ${userSignalId}, 
                ${JSON.stringify(newStats.fullStats)}
            ) ON CONFLICT ON CONSTRAINT user_signals_stats_pkey
            DO UPDATE SET stats = excluded.stats;
        `);

            await this.db.pg.query(sql`
        INSERT INTO user_signal_period_stats (
            user_signal_id, period, year, quarter, month, date_from, date_to, stats)
            SELECT * FROM ${sql.unnest(
                this.db.util.prepareUnnest(
                    newPeriodStats.map((s) => ({
                        ...s,
                        stats: JSON.stringify(s.stats),
                        userSignalId
                    })),
                    ["userSignalId", "period", "year", "quarter", "month", "dateFrom", "dateTo", "stats"]
                ),
                ["uuid", "varchar", "int8", "int8", "int8", "timestamp", "timestamp", "jsonb"]
            )}
            ON CONFLICT ON CONSTRAINT user_signal_period_stats_ukey
            DO UPDATE SET stats = excluded.stats;
        `);
        } catch (err) {
            this.log.error("Failed to calcUserSignal stats", err);
            this.log.debug(job);
            throw err;
        }
    }

    async calcUserRobot(job: TradeStatsUserRobot) {
        try {
            let { recalc = false } = job;
            const { userRobotId } = job;

            const initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            let prevFullStats: { stats: FullStats };
            if (!recalc) {
                prevFullStats = await this.db.pg.maybeOne<{ stats: FullStats }>(sql`
            SELECT urs.stats
            FROM user_robots ur
            LEFT JOIN user_robot_stats urs
                ON ur.id = urs.user_robot_id
            WHERE ur.id = ${userRobotId};
        `);

                if (!prevFullStats) throw new Error(`The user robot doesn't exists (userRobotId: ${userRobotId})`);

                if (!prevFullStats?.stats) recalc = true;
            }

            if (prevFullStats?.stats) {
                const prevPeriodStats = await this.db.pg.any<PeriodStats>(sql`
                SELECT period, year, quarter, month, date_from, date_to, stats 
                FROM user_robot_period_stats
                WHERE user_robot_id = ${userRobotId}
                ORDER BY year, quarter, month;
                `);

                if (!prevPeriodStats || !prevPeriodStats.length || prevPeriodStats.length < 3) {
                    recalc = true;
                } else {
                    initialStats.fullStats = prevFullStats.stats;
                    initialStats.periodStats = this.periodStatsFromArray([...prevPeriodStats]);
                }
            }

            let calcFrom;
            if (!recalc && prevFullStats?.stats) {
                calcFrom = prevFullStats.stats.lastPosition.exitDate;
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

            const newPeriodStats = this.periodStatsToArray(newStats.periodStats);
            await this.db.pg.query(sql`
            INSERT INTO user_robot_stats (
                user_robot_id,
                stats   
            ) VALUES (
                ${userRobotId}, 
                ${JSON.stringify(newStats.fullStats)}
            ) ON CONFLICT ON CONSTRAINT user_robot_stats_pkey
            DO UPDATE SET stats = excluded.stats;
        `);

            await this.db.pg.query(sql`
        INSERT INTO user_robot_period_stats (
            user_robot_id, period, year, quarter, month, date_from, date_to, stats)
            SELECT * FROM ${sql.unnest(
                this.db.util.prepareUnnest(
                    newPeriodStats.map((s) => ({
                        ...s,
                        stats: JSON.stringify(s.stats),
                        userRobotId
                    })),
                    ["userRobotId", "period", "year", "quarter", "month", "dateFrom", "dateTo", "stats"]
                ),
                ["uuid", "varchar", "int8", "int8", "int8", "timestamp", "timestamp", "jsonb"]
            )}
            ON CONFLICT ON CONSTRAINT user_robot_period_stats_ukey
            DO UPDATE SET stats = excluded.stats;
        `);
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

            const initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            let prevFullStats: { stats: FullStats };
            if (!recalc) {
                prevFullStats = await this.db.pg.maybeOne<{ stats: FullStats }>(sql`
            SELECT ups.stats
            FROM user_portfolios up
            LEFT JOIN user_portfolio_stats ups
                ON up.id = ups.user_portfolio_id
            WHERE up.id = ${userPortfolioId};
        `);

                if (!prevFullStats)
                    throw new Error(`The user portfolio doesn't exists (userPortfolioId: ${userPortfolioId})`);

                if (!prevFullStats.stats) recalc = true;
            }

            if (prevFullStats?.stats) {
                const prevPeriodStats = await this.db.pg.any<PeriodStats>(sql`
                SELECT period, year, quarter, month, date_from, date_to, stats 
                FROM user_portfolio_period_stats
                WHERE user_portfolio_id = ${userPortfolioId}
                ORDER BY year, quarter, month;
                `);

                if (!prevPeriodStats || !prevPeriodStats.length || prevPeriodStats.length < 3) {
                    recalc = true;
                } else {
                    initialStats.fullStats = prevFullStats.stats;
                    initialStats.periodStats = this.periodStatsFromArray([...prevPeriodStats]);
                }
            }

            let calcFrom;
            if (!recalc && prevFullStats?.stats) {
                calcFrom = prevFullStats.stats.lastPosition.exitDate;
            }

            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.volume, p.worst_profit, p.profit, p.bars_held
        `;
            const queryFromAndConditionPart = sql`
            FROM v_user_portfolio_positions p
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
                async (prevStats: TradeStats, chunk: BasePosition[]) => await this.calcStats(chunk, { job }, prevStats),
                initialStats
            );

            const newPeriodStats = this.periodStatsToArray(newStats.periodStats);
            await this.db.pg.query(sql`
            INSERT INTO user_portfolio_stats (
                user_portfolio_id,
                stats   
            ) VALUES (
                ${userPortfolioId}, 
                ${JSON.stringify(newStats.fullStats)}
            ) ON CONFLICT ON CONSTRAINT user_portfolio_stats_pkey
            DO UPDATE SET stats = excluded.stats;
        `);

            await this.db.pg.query(sql`
        INSERT INTO user_portfolio_period_stats (
            user_robot_id, period, year, quarter, month, date_from, date_to, stats)
            SELECT * FROM ${sql.unnest(
                this.db.util.prepareUnnest(
                    newPeriodStats.map((s) => ({
                        ...s,
                        stats: JSON.stringify(s.stats),
                        userPortfolioId
                    })),
                    ["userPortfolioId", "period", "year", "quarter", "month", "dateFrom", "dateTo", "stats"]
                ),
                ["uuid", "varchar", "int8", "int8", "int8", "timestamp", "timestamp", "jsonb"]
            )}
            ON CONFLICT ON CONSTRAINT user_portfolio_stats_ukey
            DO UPDATE SET stats = excluded.stats;
        `);
        } catch (err) {
            this.log.error("Failed to calcUserPorfolio stats", err);
            this.log.debug(job);
            throw err;
        }
    }

    async calcUserSignalsAggr(job: TradeStatsUserSignalsAggr) {
        try {
            let { recalc = false } = job;
            const { userId, exchange = null, asset = null } = job;

            const exchangeCondition = exchange || this.dummy;
            const assetCondition = asset || this.dummy;
            const typeCondition = UserAggrStatsTypes.signal;

            const initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            let prevFullStats: { id: string; stats: FullStats };
            if (!recalc) {
                prevFullStats = await this.db.pg.maybeOne<{ id: string; stats: FullStats }>(sql`
            SELECT id, stats
            FROM user_aggr_stats
            WHERE user_id = ${userId}
                AND type = ${typeCondition}
                AND exchange = ${exchangeCondition}
                AND asset = ${assetCondition};
        `);

                if (!prevFullStats?.stats) recalc = true;
            }

            if (prevFullStats?.stats) {
                const countOfSignals = await this.db.pg.oneFirst<number>(sql`
                SELECT COUNT(1)
                FROM user_signals us,
                    robots r
                WHERE us.user_id = ${userId}
                    AND r.id = us.robot_id
                    ${!exchange ? sql`` : sql`AND r.exchange = ${exchange}`}
                    ${!asset ? sql`` : sql`AND r.asset = ${asset}`};
            `);

                if (countOfSignals === 0) {
                    await this.db.pg.query(sql`
                    DELETE
                    FROM user_aggr_stats
                    WHERE id = ${prevFullStats.id};
                `);

                    return false;
                }

                const prevPeriodStats = await this.db.pg.any<PeriodStats>(sql`
                SELECT period, year, quarter, month, date_from, date_to, stats 
                FROM user_aggr_period_stats
                WHERE user_id = ${userId}
                AND type = ${typeCondition}
                AND exchange = ${exchangeCondition}
                AND asset = ${assetCondition}
                ORDER BY year, quarter, month;
                `);

                if (!prevPeriodStats || !prevPeriodStats.length || prevPeriodStats.length < 3) {
                    recalc = true;
                } else {
                    initialStats.fullStats = prevFullStats.stats;
                    initialStats.periodStats = this.periodStatsFromArray([...prevPeriodStats]);
                }
            }

            let calcFrom;
            if (!recalc && prevFullStats?.stats) {
                calcFrom = prevFullStats.stats.lastPosition.exitDate;
            }

            const conditionExchange = !exchange ? sql`` : sql`AND r.exchange = ${exchange}`;
            const conditionAsset = !asset ? sql`` : sql`AND r.asset = ${asset}`;
            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.volume, p.worst_profit, p.profit, p.bars_held
        `;
            const queryFromAndConditionPart = sql`
             FROM robots r,
                v_user_signal_positions p
            WHERE p.user_id = ${userId}
                AND r.id = p.robot_id
                AND p.status = 'closed'
            ${conditionExchange}
            ${conditionAsset}
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

            const newPeriodStats = this.periodStatsToArray(newStats.periodStats);
            await this.db.pg.query(sql`
            INSERT INTO user_aggr_stats (
                user_id,
                exchange, asset, type,
                stats   
            ) VALUES (
                ${userId}, 
                ${exchangeCondition}, ${assetCondition}, ${typeCondition},
                ${JSON.stringify(newStats.fullStats)}
            ) ON CONFLICT ON CONSTRAINT user_aggr_stats_user_id_exchange_asset_type_key
            DO UPDATE SET stats = excluded.stats;
        `);

            await this.db.pg.query(sql`
        INSERT INTO user_aggr_period_stats (
            user_id, exchange, asset, type, period, year, quarter, month, date_from, date_to, stats)
            SELECT * FROM ${sql.unnest(
                this.db.util.prepareUnnest(
                    newPeriodStats.map((s) => ({
                        ...s,
                        stats: JSON.stringify(s.stats),
                        userId,
                        exchange: exchangeCondition,
                        asset: assetCondition,
                        type: typeCondition
                    })),
                    [
                        "userId",
                        "exchange",
                        "asset",
                        "type",
                        "period",
                        "year",
                        "quarter",
                        "month",
                        "dateFrom",
                        "dateTo",
                        "stats"
                    ]
                ),
                [
                    "uuid",
                    "varchar",
                    "varchar",
                    "varchar",
                    "varchar",
                    "int8",
                    "int8",
                    "int8",
                    "timestamp",
                    "timestamp",
                    "jsonb"
                ]
            )}
            ON CONFLICT ON CONSTRAINT user_aggr_period_stats_ukey
            DO UPDATE SET stats = excluded.stats;
        `);
        } catch (err) {
            this.log.error("Failed to calcUserSignalsAggr stats", err);
            this.log.debug(job);
            throw err;
        }
    }

    async calcUserRobotsAggr(job: TradeStatsUserRobotsAggr) {
        try {
            let { recalc = false } = job;
            const { userId, exchange = null, asset = null } = job;

            const exchangeCondition = exchange || this.dummy;
            const assetCondition = asset || this.dummy;
            const typeCondition = UserAggrStatsTypes.userRobot;

            const initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            let prevFullStats: { id: string; stats: FullStats };
            if (!recalc) {
                prevFullStats = await this.db.pg.maybeOne<{ id: string; stats: FullStats }>(sql`
            SELECT id, stats
            FROM user_aggr_stats
            WHERE user_id = ${userId}
                AND type = ${typeCondition}
                AND exchange = ${exchangeCondition}
                AND asset = ${assetCondition};
        `);

                if (!prevFullStats?.stats) recalc = true;
            }

            if (prevFullStats?.stats) {
                const countOfSignals = await this.db.pg.oneFirst<number>(sql`
                SELECT COUNT(1)
                FROM user_robots ur,
                    robots r
                WHERE us.user_id = ${userId}
                    AND r.id = ur.robot_id
                    ${!exchange ? sql`` : sql`AND r.exchange = ${exchange}`}
                    ${!asset ? sql`` : sql`AND r.asset = ${asset}`};
            `);

                if (countOfSignals === 0) {
                    await this.db.pg.query(sql`
                    DELETE
                    FROM user_aggr_stats
                    WHERE id = ${prevFullStats.id};
                `);

                    return false;
                }

                const prevPeriodStats = await this.db.pg.any<PeriodStats>(sql`
                SELECT period, year, quarter, month, date_from, date_to, stats 
                FROM user_aggr_period_stats
                WHERE user_id = ${userId}
                AND type = ${typeCondition}
                AND exchange = ${exchangeCondition}
                AND asset = ${assetCondition}
                ORDER BY year, quarter, month;
                `);

                if (!prevPeriodStats || !prevPeriodStats.length || prevPeriodStats.length < 3) {
                    recalc = true;
                } else {
                    initialStats.fullStats = prevFullStats.stats;
                    initialStats.periodStats = this.periodStatsFromArray([...prevPeriodStats]);
                }
            }

            let calcFrom;
            if (!recalc && prevFullStats?.stats) {
                calcFrom = prevFullStats.stats.lastPosition.exitDate;
            }

            const conditionExchange = !exchange ? sql`` : sql`AND p.exchange = ${exchange}`;
            const conditionAsset = !asset ? sql`` : sql`AND p.asset = ${asset}`;
            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.exit_executed as volume, p.worst_profit, p.profit, p.bars_held
        `;
            const queryFromAndConditionPart = sql`
             FROM v_user_positions p
            WHERE p.user_id = ${userId}
                AND p.status = 'closed'
            ${conditionExchange}
            ${conditionAsset}
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

            const newPeriodStats = this.periodStatsToArray(newStats.periodStats);
            await this.db.pg.query(sql`
            INSERT INTO user_aggr_stats (
                user_id,
                exchange, asset, type,
                stats   
            ) VALUES (
                ${userId}, 
                ${exchangeCondition}, ${assetCondition}, ${typeCondition},
                ${JSON.stringify(newStats.fullStats)}
            ) ON CONFLICT ON CONSTRAINT user_aggr_stats_user_id_exchange_asset_type_key
            DO UPDATE SET stats = excluded.stats;
        `);

            await this.db.pg.query(sql`
        INSERT INTO user_aggr_period_stats (
            user_id, exchange, asset, type, period, year, quarter, month, date_from, date_to, stats)
            SELECT * FROM ${sql.unnest(
                this.db.util.prepareUnnest(
                    newPeriodStats.map((s) => ({
                        ...s,
                        stats: JSON.stringify(s.stats),
                        userId,
                        exchange: exchangeCondition,
                        asset: assetCondition,
                        type: typeCondition
                    })),
                    [
                        "userId",
                        "exchange",
                        "asset",
                        "type",
                        "period",
                        "year",
                        "quarter",
                        "month",
                        "dateFrom",
                        "dateTo",
                        "stats"
                    ]
                ),
                [
                    "uuid",
                    "varchar",
                    "varchar",
                    "varchar",
                    "varchar",
                    "int8",
                    "int8",
                    "int8",
                    "timestamp",
                    "timestamp",
                    "jsonb"
                ]
            )}
            ON CONFLICT ON CONSTRAINT user_aggr_period_stats_ukey
            DO UPDATE SET stats = excluded.stats;
        `);
        } catch (err) {
            this.log.error("Failed to calcUserRobotsAggr stats", err);
            this.log.debug(job);
            throw err;
        }
    }

    async calcAllRobotsAggr(job: TradeStatsAllRobotsAggr) {
        try {
            let { recalc = false } = job;
            const { exchange = null, asset = null } = job;

            const exchangeCondition = exchange || this.dummy;
            const assetCondition = asset || this.dummy;

            const initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            let prevFullStats: { id: string; stats: FullStats };
            if (!recalc) {
                prevFullStats = await this.db.pg.maybeOne<{ id: string; stats: FullStats }>(sql`
            SELECT id, stats
            FROM robot_aggr_stats
            WHERE exchange = ${exchangeCondition}
                AND asset = ${assetCondition};
        `);

                if (!prevFullStats?.stats) recalc = true;
            }

            if (prevFullStats?.stats) {
                const prevPeriodStats = await this.db.pg.any<PeriodStats>(sql`
                SELECT period, year, quarter, month, date_from, date_to, stats 
                FROM robot_aggr_period_stats
                WHERE exchange = ${exchangeCondition}
                AND asset = ${assetCondition}
                ORDER BY year, quarter, month;
                `);

                if (!prevPeriodStats || !prevPeriodStats.length || prevPeriodStats.length < 3) {
                    recalc = true;
                } else {
                    initialStats.fullStats = prevFullStats.stats;
                    initialStats.periodStats = this.periodStatsFromArray([...prevPeriodStats]);
                }
            }

            let calcFrom;
            if (!recalc && prevFullStats?.stats) {
                calcFrom = prevFullStats.stats.lastPosition.exitDate;
            }

            const conditionExchange = !exchange ? sql`` : sql`AND r.exchange = ${exchange}`;
            const conditionAsset = !asset ? sql`` : sql`AND r.asset = ${asset}`;
            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price,  p.volume, p.worst_profit, p.profit, p.bars_held
        `;
            const queryFromAndConditionPart = sql`
             FROM robots r,
             v_robot_positions p
            WHERE r.id = p.robot_id
                AND p.status = 'closed'
            ${conditionExchange}
            ${conditionAsset}
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

            const newPeriodStats = this.periodStatsToArray(newStats.periodStats);
            await this.db.pg.query(sql`
            INSERT INTO robot_aggr_stats (
                exchange, asset, stats
            ) VALUES (
                ${exchangeCondition}, ${assetCondition},
                ${JSON.stringify(newStats.fullStats)}
            ) ON CONFLICT ON CONSTRAINT robot_aggr_stats_exchange_asset_key
            DO UPDATE SET stats = excluded.stats;
        `);

            await this.db.pg.query(sql`
        INSERT INTO robot_aggr_period_stats (
                exchange, asset, period, year, quarter, month, date_from, date_to, stats)
            SELECT * FROM ${sql.unnest(
                this.db.util.prepareUnnest(
                    newPeriodStats.map((s) => ({
                        ...s,
                        stats: JSON.stringify(s.stats),
                        exchange: exchangeCondition,
                        asset: assetCondition
                    })),
                    ["exchange", "asset", "period", "year", "quarter", "month", "dateFrom", "dateTo", "stats"]
                ),
                ["varchar", "varchar", "varchar", "int8", "int8", "int8", "timestamp", "timestamp", "jsonb"]
            )}
            ON CONFLICT ON CONSTRAINT robot_aggr_period_stats_ukey
            DO UPDATE SET stats = excluded.stats;
        `);
        } catch (err) {
            this.log.error("Failed to calcAllRobotsAggr stats", err);
            this.log.debug(job);
            throw err;
        }
    }

    async calcAllUserRobotsAggr(job: TradeStatsAllUserRobotsAggr) {
        try {
            let { recalc = false } = job;
            const { exchange = null, asset = null } = job;

            const exchangeCondition = exchange || this.dummy;
            const assetCondition = asset || this.dummy;

            const initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            let prevFullStats: { id: string; stats: FullStats };
            if (!recalc) {
                prevFullStats = await this.db.pg.maybeOne<{ id: string; stats: FullStats }>(sql`
            SELECT id, stats
            FROM user_robot_aggr_stats
            WHERE exchange = ${exchangeCondition}
                AND asset = ${assetCondition};
        `);

                if (!prevFullStats?.stats) recalc = true;
            }

            if (prevFullStats?.stats) {
                const prevPeriodStats = await this.db.pg.any<PeriodStats>(sql`
                SELECT period, year, quarter, month, date_from, date_to, stats 
                FROM user_robot_aggr_period_stats
                WHERE exchange = ${exchangeCondition}
                AND asset = ${assetCondition}
                ORDER BY year, quarter, month;
                `);

                if (!prevPeriodStats || !prevPeriodStats.length || prevPeriodStats.length < 3) {
                    recalc = true;
                } else {
                    initialStats.fullStats = prevFullStats.stats;
                    initialStats.periodStats = this.periodStatsFromArray([...prevPeriodStats]);
                }
            }

            let calcFrom;
            if (!recalc && prevFullStats?.stats) {
                calcFrom = prevFullStats.stats.lastPosition.exitDate;
            }

            const conditionExchange = !exchange ? sql`` : sql`AND p.exchange = ${exchange}`;
            const conditionAsset = !asset ? sql`` : sql`AND p.asset = ${asset}`;
            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.exit_executed as volume, p.worst_profit, p.profit, p.bars_held
        `;
            const queryFromAndConditionPart = sql`
             FROM v_user_positions p
            WHERE  p.status = 'closed'
            ${conditionExchange}
            ${conditionAsset}
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

            const newPeriodStats = this.periodStatsToArray(newStats.periodStats);
            await this.db.pg.query(sql`
            INSERT INTO user_robot_aggr_stats (
                exchange, asset, stats
            ) VALUES (
                ${exchangeCondition}, ${assetCondition},
                ${JSON.stringify(newStats.fullStats)}
            ) ON CONFLICT ON CONSTRAINT user_robot_aggr_stats_exchange_asset_key
            DO UPDATE SET stats = excluded.stats;
        `);

            await this.db.pg.query(sql`
        INSERT INTO user_robot_aggr_period_stats (
                exchange, asset, period, year, quarter, month, date_from, date_to, stats)
            SELECT * FROM ${sql.unnest(
                this.db.util.prepareUnnest(
                    newPeriodStats.map((s) => ({
                        ...s,
                        stats: JSON.stringify(s.stats),
                        exchange: exchangeCondition,
                        asset: assetCondition
                    })),
                    ["exchange", "asset", "period", "year", "quarter", "month", "dateFrom", "dateTo", "stats"]
                ),
                ["varchar", "varchar", "varchar", "int8", "int8", "int8", "timestamp", "timestamp", "jsonb"]
            )}
            ON CONFLICT ON CONSTRAINT user_robot_aggr_period_stats_ukey
            DO UPDATE SET stats = excluded.stats;
        `);
        } catch (err) {
            this.log.error("Failed to calcAllUserRobotsAggr stats", err);
            this.log.debug(job);
            throw err;
        }
    }

    async calcAllPortfoliosAggr(job: TradeStatsAllPortfoliosAggr) {
        try {
            let { recalc = false } = job;
            const { exchange = null } = job;

            const exchangeCondition = exchange || this.dummy;

            const initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            let prevFullStats: { id: string; stats: FullStats };
            if (!recalc) {
                prevFullStats = await this.db.pg.maybeOne<{ id: string; stats: FullStats }>(sql`
            SELECT id, stats
            FROM portfolio_aggr_stats
            WHERE exchange = ${exchangeCondition};
        `);

                if (!prevFullStats?.stats) recalc = true;
            }

            if (prevFullStats?.stats) {
                const prevPeriodStats = await this.db.pg.any<PeriodStats>(sql`
                SELECT period, year, quarter, month, date_from, date_to, stats 
                FROM portfolio_aggr_period_stats
                WHERE exchange = ${exchangeCondition}
                ORDER BY year, quarter, month;
                `);

                if (!prevPeriodStats || !prevPeriodStats.length || prevPeriodStats.length < 3) {
                    recalc = true;
                } else {
                    initialStats.fullStats = prevFullStats.stats;
                    initialStats.periodStats = this.periodStatsFromArray([...prevPeriodStats]);
                }
            }

            let calcFrom;
            if (!recalc && prevFullStats?.stats) {
                calcFrom = prevFullStats.stats.lastPosition.exitDate;
            }

            const conditionExchange = !exchange ? sql`` : sql`AND r.exchange = ${exchange}`;
            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price,  p.volume, p.worst_profit, p.profit, p.bars_held
        `;
            const queryFromAndConditionPart = sql`
             FROM portfolios r,
             v_portfolio_positions p
            WHERE r.id = p.portfolio_id
                AND p.status = 'closed'
            ${conditionExchange}
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

            const newPeriodStats = this.periodStatsToArray(newStats.periodStats);
            await this.db.pg.query(sql`
            INSERT INTO portfolio_aggr_stats (
                exchange, stats
            ) VALUES (
                ${exchangeCondition}
                ${JSON.stringify(newStats.fullStats)}
            ) ON CONFLICT ON CONSTRAINT portfolio_aggr_stats_exchange_asset_key
            DO UPDATE SET stats = excluded.stats;
        `);

            await this.db.pg.query(sql`
        INSERT INTO portfolio_aggr_period_stats (
                exchange, period, year, quarter, month, date_from, date_to, stats)
            SELECT * FROM ${sql.unnest(
                this.db.util.prepareUnnest(
                    newPeriodStats.map((s) => ({
                        ...s,
                        stats: JSON.stringify(s.stats),
                        exchange: exchangeCondition
                    })),
                    ["exchange", "period", "year", "quarter", "month", "dateFrom", "dateTo", "stats"]
                ),
                ["varchar", "varchar", "int8", "int8", "int8", "timestamp", "timestamp", "jsonb"]
            )}
            ON CONFLICT ON CONSTRAINT portfolio_aggr_period_stats_ukey
            DO UPDATE SET stats = excluded.stats;
        `);
        } catch (err) {
            this.log.error("Failed to calcAllPortfoliosAggr stats", err);
            this.log.debug(job);
            throw err;
        }
    }

    async calcAllUserPortfoliosAggr(job: TradeStatsAllUserPortfoliosAggr) {
        try {
            let { recalc = false } = job;
            const { exchange = null } = job;

            const exchangeCondition = exchange || this.dummy;

            const initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            let prevFullStats: { id: string; stats: FullStats };
            if (!recalc) {
                prevFullStats = await this.db.pg.maybeOne<{ id: string; stats: FullStats }>(sql`
            SELECT id, stats
            FROM user_portfolio_aggr_stats
            WHERE exchange = ${exchangeCondition};
        `);

                if (!prevFullStats?.stats) recalc = true;
            }

            if (prevFullStats?.stats) {
                const prevPeriodStats = await this.db.pg.any<PeriodStats>(sql`
                SELECT period, year, quarter, month, date_from, date_to, stats 
                FROM user_portfolio_aggr_period_stats
                WHERE exchange = ${exchangeCondition}
                ORDER BY year, quarter, month;
                `);

                if (!prevPeriodStats || !prevPeriodStats.length || prevPeriodStats.length < 3) {
                    recalc = true;
                } else {
                    initialStats.fullStats = prevFullStats.stats;
                    initialStats.periodStats = this.periodStatsFromArray([...prevPeriodStats]);
                }
            }

            let calcFrom;
            if (!recalc && prevFullStats?.stats) {
                calcFrom = prevFullStats.stats.lastPosition.exitDate;
            }

            const conditionExchange = !exchange ? sql`` : sql`AND r.exchange = ${exchange}`;
            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.exit_executed as volume, p.worst_profit, p.profit, p.bars_held
        `;
            const queryFromAndConditionPart = sql`
             FROM portfolios r,
             v_user_portfolio_positions p
            WHERE r.id = p.portfolio_id
                AND p.status = 'closed'
            ${conditionExchange}
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

            const newPeriodStats = this.periodStatsToArray(newStats.periodStats);
            await this.db.pg.query(sql`
            INSERT INTO user_portfolio_aggr_stats (
                exchange, stats 
            ) VALUES (
                ${exchangeCondition}, 
                ${JSON.stringify(newStats.fullStats)}
            ) ON CONFLICT ON CONSTRAINT user_portfolio_aggr_stats_exchange_asset_key
            DO UPDATE SET stats = excluded.stats;
        `);

            await this.db.pg.query(sql`
        INSERT INTO user_portfolio_aggr_period_stats (
                exchange, period, year, quarter, month, date_from, date_to, stats)
            SELECT * FROM ${sql.unnest(
                this.db.util.prepareUnnest(
                    newPeriodStats.map((s) => ({
                        ...s,
                        stats: JSON.stringify(s.stats),
                        exchange: exchangeCondition
                    })),
                    ["exchange", "period", "year", "quarter", "month", "dateFrom", "dateTo", "stats"]
                ),
                ["varchar", "varchar", "int8", "int8", "int8", "timestamp", "timestamp", "jsonb"]
            )}
            ON CONFLICT ON CONSTRAINT user_portfolio_aggr_period_stats_ukey
            DO UPDATE SET stats = excluded.stats;
        `);
        } catch (err) {
            this.log.error("Failed to calcAllUserPortfoliosAggr stats", err);
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
