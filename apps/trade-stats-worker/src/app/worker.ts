import { expose } from "threads/worker";
import { DataStream } from "scramjet";
import { BasePosition, Timeframe } from "@cryptuoso/market";
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
    FullStats,
    BaseStats,
    TradeStatsSignalSubscription,
    TradeStatsTest
} from "@cryptuoso/trade-stats";
import logger, { Logger } from "@cryptuoso/logger";
import { sql, createPgPool, DatabasePool, pgUtil, makeChunksGenerator } from "@cryptuoso/postgres";
import { PortfolioDB, PortfolioSettings } from "@cryptuoso/portfolio-state";
import { equals, round } from "@cryptuoso/helpers";
import dayjs from "@cryptuoso/dayjs";

class StatsCalcWorker {
    #log: Logger;
    #db: { sql: typeof sql; pg: DatabasePool; util: typeof pgUtil };
    defaultChunkSize = 1000;

    constructor() {
        this.#log = logger;
    }

    async pg() {
        if (!this.#db)
            this.#db = {
                sql,
                pg: await createPgPool(),
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
        this.log.info(`Calculating stats ${job.type}`);
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
            case "signalSubscription":
                await this.calcSignalSubscription(job as TradeStatsSignalSubscription);
                break;
            case "test":
                await this.calcTestStats(job as TradeStatsTest);
                break;
            default:
                this.log.error(`Unsupported stats calc type`);
        }
        this.log.info(`Finished calculating stats ${job.type}`);
    }

    async calcStats(positions: BasePosition[], meta: StatsMeta, prevStats?: TradeStats) {
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
                    periodStats: PeriodStats<BaseStats>[];
                    emulatedFullStats: FullStats;
                    emulatedPeriodStats: PeriodStats<BaseStats>[];
                }>(sql`
            SELECT r.full_stats, r.period_stats, r.emulated_full_stats, r.emulated_period_stats
            FROM robots r
            WHERE r.id = ${robotId};
        `);

                if (!prevStats) throw new Error(`The robot doesn't exists (robotId: ${robotId})`);

                if (!prevStats.emulatedFullStats || !Object.keys(prevStats.emulatedFullStats).length) recalc = true;
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

            const queryCommonPart = sql`
                ${querySelectPart}
                ${queryFromAndConditionPart}
                ORDER BY p.exit_date`;

            const positionsCount = await this.db.pg.oneFirst<number>(sql`
                        SELECT COUNT(1)
                ${queryFromAndConditionPart};
                    `);

            if (positionsCount == 0) return false;

            const fullPositions: BasePosition[] = await DataStream.from(
                makeChunksGenerator(
                    this.db.pg,
                    queryCommonPart,
                    positionsCount > this.defaultChunkSize ? this.defaultChunkSize : positionsCount
                )
            ).reduce(async (accum: BasePosition[], chunk: BasePosition[]) => [...accum, ...chunk], []);

            if (!fullPositions || !fullPositions.length) return;
            const newEmulatedStats = await this.calcStats([...fullPositions], { job }, initialEmulatedStats);

            const notEmulatedPositions = fullPositions.filter((p) => !p.emulated);

            let newStats = initialStats;
            if (notEmulatedPositions.length) {
                if (
                    notEmulatedPositions.length === fullPositions.length &&
                    equals(initialEmulatedStats, initialStats)
                ) {
                    newStats = newEmulatedStats;
                } else newStats = await this.calcStats([...notEmulatedPositions], { job }, initialStats);
            }
            await this.db.pg.query(sql`
        UPDATE robots 
        SET full_stats = ${JSON.stringify(newStats.fullStats)},
        period_stats = ${JSON.stringify(periodStatsToArray(newStats.periodStats))},
        emulated_full_stats = ${JSON.stringify(newEmulatedStats.fullStats)},
        emulated_period_stats = ${JSON.stringify(periodStatsToArray(newEmulatedStats.periodStats))}
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
            const { portfolioId, dateFrom, dateTo } = job;

            let initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            const portfolio = await this.db.pg.maybeOne<{
                status: PortfolioDB["status"];
                fullStats: TradeStats["fullStats"];
                settings: PortfolioSettings;
                feeRate: number;
            }>(sql`
            SELECT r.status, r.full_stats, r.settings, m.fee_rate
            FROM portfolios r, mv_exchange_info m
            WHERE r.exchange = m.exchange
            AND r.id = ${portfolioId};
        `);
            if (!portfolio) throw new Error(`The portfolio doesn't exists (portfolioId: ${portfolioId})`);
            if (!recalc && portfolio.status !== "started") {
                this.log.warn(`Portfolio #${portfolioId} is ${portfolio.status}. Skipping stats calc.`);
                return;
            }
            if (!recalc) {
                if (!portfolio.fullStats || !Object.keys(portfolio.fullStats).length) recalc = true;
                else {
                    let periodStats;
                    if (portfolio.fullStats && portfolio.fullStats?.lastPosition) {
                        periodStats = await this.db.pg.any<PeriodStats<BaseStats>>(sql`
                        SELECT period, year, quarter, month, date_from, date_to, stats
                        FROM portfolio_period_stats
                        WHERE portfolio_id = ${portfolioId}
                        AND date_from <= ${portfolio.fullStats.lastPosition.exitDate}
                        AND date_to >= ${portfolio.fullStats.lastPosition.exitDate};
                    `);
                    }
                    initialStats = {
                        fullStats: portfolio.fullStats,
                        periodStats: periodStatsFromArray(
                            periodStats && Array.isArray(periodStats) ? [...periodStats] : []
                        )
                    };
                }
            }

            let calcFrom;
            let entryDate;
            let calcTo;
            if (!recalc && initialStats?.fullStats) {
                calcFrom = initialStats.fullStats.lastPosition.exitDate;
            }

            if (recalc && (portfolio.settings.dateFrom || dateFrom)) {
                if (dateFrom) entryDate = dateFrom;
                else entryDate = portfolio.settings.dateFrom;
            }
            if (recalc && dateTo) {
                calcTo = dateTo;
            }

            if (calcFrom) logger.debug(`Calculating portfolio #${portfolioId} stats from ${calcFrom}`);
            else logger.debug(`Calculating portfolio #${portfolioId} stats full`);

            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const conditionEntryDateFrom = !entryDate ? sql`` : sql`AND p.entry_date > ${entryDate}`;
            const conditionEntryDateTo = !calcTo ? sql`` : sql`AND p.entry_date < ${calcTo}`;
            const querySelectPart = sql`
            SELECT p.id, p.robot_id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.bars_held, p.meta, p.max_price
        `;
            const queryFromAndConditionPart = sql`
            FROM v_portfolio_robot_positions p
            WHERE p.portfolio_id = ${portfolioId}
                AND p.status = 'closed'
                ${conditionExitDate}
                ${conditionEntryDateFrom}
                ${conditionEntryDateTo}
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

            const positions: BasePosition[] = await DataStream.from(
                makeChunksGenerator(
                    this.db.pg,
                    queryCommonPart,
                    positionsCount > this.defaultChunkSize ? this.defaultChunkSize : positionsCount
                )
            ).reduce(async (accum: BasePosition[], chunk: BasePosition[]) => [...accum, ...chunk], []);

            const newStats: TradeStats = await this.calcStats(
                positions,
                {
                    job: {
                        ...job,
                        savePositions: true,
                        feeRate: portfolio.settings.feeRate || portfolio.feeRate
                    },
                    initialBalance: portfolio.settings.initialBalance,
                    leverage: portfolio.settings.leverage
                },
                initialStats
            );

            await this.db.pg.transaction(async (t) => {
                await t.query(sql`
                UPDATE portfolios
                SET full_stats = ${JSON.stringify(newStats.fullStats)}
                WHERE id = ${portfolioId};`);

                const periodStatsArray = periodStatsToArray(newStats.periodStats);
                if (recalc) {
                    await t.query(sql`DELETE FROM portfolio_period_stats WHERE portfolio_id = ${portfolioId}`);

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
                    this.db.util.prepareUnnest(
                        periodStatsArray.map((s) => ({
                            ...s,
                            portfolioId,
                            quarter: s.quarter || undefined,
                            month: s.month || undefined,
                            stats: JSON.stringify(s.stats)
                        })),
                        ["portfolioId", "period", "year", "quarter", "month", "dateFrom", "dateTo", "stats"]
                    ),
                    ["uuid", "varchar", "int8", "int8", "int8", "timestamp", "timestamp", "jsonb"]
                )};
                `);
                } else {
                    for (const s of periodStatsArray) {
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
                    VALUES (${portfolioId},
                    ${s.period},
                    ${s.year},
                    ${s.quarter || null},
                    ${s.month || null},
                    ${s.dateFrom},
                    ${s.dateTo},
                    ${JSON.stringify(s.stats)} )
                    ON CONFLICT ON CONSTRAINT portfolio_period_stats_pkey
                DO UPDATE SET stats = excluded.stats;
                        `);
                    }
                }

                if (newStats.positions && newStats.positions.length) {
                    if (recalc) {
                        await t.query(sql`
                        DELETE FROM portfolio_positions
                        WHERE portfolio_id = ${portfolioId};`);
                    }
                    await t.query(sql`
                INSERT INTO portfolio_positions (portfolio_id, robot_id, position_id,
                    volume, amount_in_currency, profit, prev_balance, current_balance
                ) SELECT * FROM ${sql.unnest(
                    pgUtil.prepareUnnest(
                        newStats.positions.map((p) => ({
                            positionId: p.id,
                            robotId: p.robotId,
                            portfolioId,
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
                ON CONFLICT ON CONSTRAINT portfolio_positions_pkey
                DO UPDATE SET volume = excluded.volume,
                profit = excluded.profit,
                prev_balance = excluded.prev_balance,
                current_balance = excluded.current_balance;
            `);
                }
            });
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

                if (!prevStats.fullStats || !Object.keys(prevStats.fullStats).length) recalc = true;
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
            if (calcFrom) logger.debug(`Calculating User Robot #${userRobotId} stats from ${calcFrom}`);
            else logger.debug(`Calculating  User Robot #${userRobotId} stats full`);
            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.exit_executed as volume, p.worst_profit, p.profit, p.bars_held
        `;
            const queryFromAndConditionPart = sql`
            FROM v_user_positions p
            WHERE p.user_robot_id = ${userRobotId}
                AND p.status in ('closed','closedAuto')
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

            const positions: BasePosition[] = await DataStream.from(
                makeChunksGenerator(
                    this.db.pg,
                    queryCommonPart,
                    positionsCount > this.defaultChunkSize ? this.defaultChunkSize : positionsCount
                )
            ).reduce(async (accum: BasePosition[], chunk: BasePosition[]) => [...accum, ...chunk], []);

            const newStats: TradeStats = await this.calcStats(positions, { job }, initialStats);

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

            const userPortfolio = await this.db.pg.maybeOne<{
                fullStats: TradeStats["fullStats"];
                settings: PortfolioSettings;
            }>(sql`
            SELECT r.full_stats,  r.user_portfolio_settings as settings
            FROM v_user_portfolios r
            WHERE r.id = ${userPortfolioId};
        `);
            if (!userPortfolio)
                throw new Error(`The user portfolio doesn't exists (userPortfolioId: ${userPortfolioId})`);

            if (!recalc) {
                if (!userPortfolio.fullStats || !Object.keys(userPortfolio.fullStats).length) recalc = true;
                else {
                    let periodStats;
                    if (userPortfolio.fullStats && userPortfolio.fullStats?.lastPosition) {
                        periodStats = await this.db.pg.any<PeriodStats<BaseStats>>(sql`
                        SELECT period, year, quarter, month, date_from, date_to, stats
                        FROM user_portfolio_period_stats
                        WHERE user_portfolio_id = ${userPortfolioId}
                        AND date_from <= ${userPortfolio.fullStats.lastPosition.exitDate}
                        AND date_to >= ${userPortfolio.fullStats.lastPosition.exitDate};
                    `);
                    }
                    initialStats = {
                        fullStats: userPortfolio.fullStats,
                        periodStats: periodStatsFromArray(
                            periodStats && Array.isArray(periodStats) ? [...periodStats] : []
                        )
                    };
                }
            }

            let calcFrom;
            if (!recalc && initialStats?.fullStats) {
                calcFrom = initialStats.fullStats.lastPosition.exitDate;
            }
            if (calcFrom) logger.debug(`Calculating User Portfolio #${userPortfolioId} stats from ${calcFrom}`);
            else logger.debug(`Calculating  User Portfolio #${userPortfolioId} stats full`);

            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.exit_executed as volume, p.worst_profit, p.profit, p.bars_held
        `;
            const queryFromAndConditionPart = sql`
            FROM v_user_positions p
            WHERE p.user_portfolio_id = ${userPortfolioId}
                AND p.status in ('closed','closedAuto')
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

            const positions: BasePosition[] = await DataStream.from(
                makeChunksGenerator(
                    this.db.pg,
                    queryCommonPart,
                    positionsCount > this.defaultChunkSize ? this.defaultChunkSize : positionsCount
                )
            ).reduce(async (accum: BasePosition[], chunk: BasePosition[]) => [...accum, ...chunk], []);

            const newStats: TradeStats = await this.calcStats(
                positions,
                { job, initialBalance: userPortfolio.settings.initialBalance },
                initialStats
            );

            await this.db.pg.transaction(async (t) => {
                await t.query(sql`
                UPDATE user_portfolios
                SET full_stats = ${JSON.stringify(newStats.fullStats)}
                WHERE id = ${userPortfolioId};`);

                const periodStatsArray = periodStatsToArray(newStats.periodStats);
                if (recalc) {
                    await t.query(
                        sql`DELETE FROM user_portfolio_period_stats WHERE user_portfolio_id = ${userPortfolioId}`
                    );

                    await t.query(sql`
                INSERT INTO user_portfolio_period_stats
                (user_portfolio_id,
                    period,
                    year,
                    quarter,
                    month,
                    date_from,
                    date_to,
                    stats )
                SELECT * FROM
                ${sql.unnest(
                    this.db.util.prepareUnnest(
                        periodStatsArray.map((s) => ({
                            ...s,
                            userPortfolioId,
                            quarter: s.quarter || undefined,
                            month: s.month || undefined,
                            stats: JSON.stringify(s.stats)
                        })),
                        ["userPortfolioId", "period", "year", "quarter", "month", "dateFrom", "dateTo", "stats"]
                    ),
                    ["uuid", "varchar", "int8", "int8", "int8", "timestamp", "timestamp", "jsonb"]
                )}

                `);
                } else {
                    for (const s of periodStatsArray) {
                        await t.query(sql`
                    INSERT INTO user_portfolio_period_stats
                    (user_portfolio_id,
                    period,
                    year,
                    quarter,
                    month,
                    date_from,
                    date_to,
                    stats )
                    VALUES (${userPortfolioId},
                    ${s.period},
                    ${s.year},
                    ${s.quarter || null},
                    ${s.month || null},
                    ${s.dateFrom},
                    ${s.dateTo},
                    ${JSON.stringify(s.stats)} )
                    ON CONFLICT ON CONSTRAINT user_portfolio_period_stats_pkey
                DO UPDATE SET stats = excluded.stats;
                        `);
                    }
                }
            });
        } catch (err) {
            this.log.error("Failed to calcUserPorfolio stats", err);
            this.log.debug(job);
            throw err;
        }
    }

    async calcSignalSubscription(job: TradeStatsSignalSubscription) {
        try {
            let { recalc = false } = job;
            const { signalSubscriptionId } = job;

            let initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            const signalSubscription = await this.db.pg.maybeOne<{
                fullStats: TradeStats["fullStats"];
                settings: PortfolioSettings;
                feeRate: number;
            }>(sql`
            SELECT r.full_stats,  r.signal_subscription_settings as settings,
            m.fee_rate
            FROM v_signal_subscriptions r,  mv_exchange_info m
            WHERE r.id = ${signalSubscriptionId} 
            AND  r.exchange = m.exchange;
        `);
            if (!signalSubscription)
                throw new Error(
                    `The signal subscription doesn't exists (signalSubscriptionId: ${signalSubscriptionId})`
                );

            if (!recalc) {
                if (!signalSubscription.fullStats || !Object.keys(signalSubscription.fullStats).length) recalc = true;
                else {
                    let periodStats;
                    if (signalSubscription.fullStats && signalSubscription.fullStats?.lastPosition) {
                        periodStats = await this.db.pg.any<PeriodStats<BaseStats>>(sql`
                        SELECT period, year, quarter, month, date_from, date_to, stats
                        FROM signal_subscription_period_stats
                        WHERE signal_subscription_id = ${signalSubscriptionId}
                        AND date_from <= ${signalSubscription.fullStats.lastPosition.exitDate}
                        AND date_to >= ${signalSubscription.fullStats.lastPosition.exitDate};
                    `);
                    }
                    initialStats = {
                        fullStats: signalSubscription.fullStats,
                        periodStats: periodStatsFromArray(
                            periodStats && Array.isArray(periodStats) ? [...periodStats] : []
                        )
                    };
                }
            }

            let calcFrom;
            if (!recalc && initialStats?.fullStats) {
                calcFrom = initialStats.fullStats.lastPosition.exitDate;
            }
            if (calcFrom)
                logger.debug(`Calculating Signal Subscription #${signalSubscriptionId} stats from ${calcFrom}`);
            else logger.debug(`Calculating Signal Subscription #${signalSubscriptionId} stats full`);

            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.share, r.timeframe
        `;
            const queryFromAndConditionPart = sql`
            FROM signal_subscription_positions p, robots r
            WHERE p.signal_subscription_id = ${signalSubscriptionId}
                AND p.status in ('closed','closedAuto')
                AND r.id = p.robot_id
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

            const loadedPositions: BasePosition & { share: number; timeframe: number }[] = await DataStream.from(
                makeChunksGenerator(
                    this.db.pg,
                    queryCommonPart,
                    positionsCount > this.defaultChunkSize ? this.defaultChunkSize : positionsCount
                )
            ).reduce(async (accum: BasePosition[], chunk: BasePosition[]) => [...accum, ...chunk], []);

            const positions: BasePosition[] = loadedPositions.map((pos) => {
                const position = {
                    ...pos,
                    barsHeld: +round(
                        dayjs
                            .utc(Timeframe.validTimeframeDatePrev((pos as BasePosition).exitDate, pos.timeframe))
                            .diff(
                                dayjs.utc(
                                    Timeframe.validTimeframeDatePrev((pos as BasePosition).entryDate, pos.timeframe)
                                ),
                                "minute"
                            ) / pos.timeframe
                    ),
                    meta: {
                        portfolioShare: pos.share
                    }
                };

                return position as BasePosition;
            });

            const newStats: TradeStats = await this.calcStats(
                positions,
                {
                    job: { ...job, feeRate: signalSubscription.feeRate, savePositions: true },
                    initialBalance: signalSubscription.settings.initialBalance,
                    leverage: signalSubscription.settings.leverage
                },
                initialStats
            );

            await this.db.pg.transaction(async (t) => {
                await t.query(sql`
                UPDATE signal_subscriptions
                SET full_stats = ${JSON.stringify(newStats.fullStats)}
                WHERE id = ${signalSubscriptionId};`);

                const periodStatsArray = periodStatsToArray(newStats.periodStats);
                if (recalc) {
                    await t.query(
                        sql`DELETE FROM signal_subscription_period_stats WHERE signal_subscription_id = ${signalSubscriptionId}`
                    );

                    await t.query(sql`
                INSERT INTO signal_subscription_period_stats
                (signal_subscription_id,
                    period,
                    year,
                    quarter,
                    month,
                    date_from,
                    date_to,
                    stats )
                SELECT * FROM
                ${sql.unnest(
                    this.db.util.prepareUnnest(
                        periodStatsArray.map((s) => ({
                            ...s,
                            signalSubscriptionId,
                            quarter: s.quarter || undefined,
                            month: s.month || undefined,
                            stats: JSON.stringify(s.stats)
                        })),
                        ["signalSubscriptionId", "period", "year", "quarter", "month", "dateFrom", "dateTo", "stats"]
                    ),
                    ["uuid", "varchar", "int8", "int8", "int8", "timestamp", "timestamp", "jsonb"]
                )}

                `);
                } else {
                    for (const s of periodStatsArray) {
                        await t.query(sql`
                    INSERT INTO signal_subscription_period_stats
                    (signal_subscription_id,
                    period,
                    year,
                    quarter,
                    month,
                    date_from,
                    date_to,
                    stats )
                    VALUES (${signalSubscriptionId},
                    ${s.period},
                    ${s.year},
                    ${s.quarter || null},
                    ${s.month || null},
                    ${s.dateFrom},
                    ${s.dateTo},
                    ${JSON.stringify(s.stats)} )
                    ON CONFLICT ON CONSTRAINT signal_subscription_period_stats_pkey
                DO UPDATE SET stats = excluded.stats;
                        `);
                    }
                }
            });

            if (newStats.positions && newStats.positions.length) {
                for (const pos of newStats.positions) {
                    this.db.pg.query(sql`
                    UPDATE signal_subscription_positions 
                    SET volume = ${pos.volume},
                    profit = ${pos.profit}
                    WHERE id = ${pos.id};
                    `);
                }
            }
        } catch (err) {
            this.log.error("Failed to calcSignalSubscription stats", err);
            this.log.debug(job);
            throw err;
        }
    }

    async calcTestStats(job: TradeStatsTest) {
        try {
            const { recalc = false } = job;
            const { testStatsId } = job;

            const initialStats: TradeStats = {
                fullStats: null,
                periodStats: {
                    year: null,
                    quarter: null,
                    month: null
                }
            };

            const testStats = await this.db.pg.maybeOne<{
                settings: { initialBalance: number; leverage: number };
                feeRate: number;
            }>(sql`
            SELECT  r.settings, m.fee_rate
            FROM test_stats r, mv_exchange_info m
            WHERE r.exchange = m.exchange
            AND r.id = ${testStatsId};
        `);
            if (!testStats) throw new Error(`The test stats doesn't exists (testStatsId: ${testStatsId})`);

            const querySelectPart = sql`
            SELECT p.id, p.robot_id, p.direction, p.entry_date, p.entry_price, p.exit_date, p.exit_price, p.bars_held, json_build_object('portfolioShare', p.share) AS meta, p.max_price
        `;
            const queryFromAndConditionPart = sql`
            FROM test_stats_positions p
            WHERE p.test_stats_id = ${testStatsId}
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

            const positions: BasePosition[] = await DataStream.from(
                makeChunksGenerator(
                    this.db.pg,
                    queryCommonPart,
                    positionsCount > this.defaultChunkSize ? this.defaultChunkSize : positionsCount
                )
            ).reduce(async (accum: BasePosition[], chunk: BasePosition[]) => [...accum, ...chunk], []);

            const newStats: TradeStats = await this.calcStats(
                positions,
                {
                    job: {
                        ...job,
                        type: "portfolio",
                        portfolioId: "test",
                        savePositions: true,
                        feeRate: testStats.feeRate
                    },
                    initialBalance: testStats.settings.initialBalance,
                    leverage: testStats.settings.leverage
                },
                initialStats
            );

            await this.db.pg.transaction(async (t) => {
                await t.query(sql`
                UPDATE test_stats
                SET full_stats = ${JSON.stringify(newStats.fullStats)}
                WHERE id = ${testStatsId};`);

                const periodStatsArray = periodStatsToArray(newStats.periodStats);
                if (recalc) {
                    await t.query(sql`DELETE FROM test_stats_period_stats WHERE test_stats_id = ${testStatsId}`);

                    await t.query(sql`
                    INSERT INTO test_stats_period_stats
                    (test_stats_id,
                    period,
                    year,
                    quarter,
                    month,
                    date_from,
                    date_to,
                    stats )
                    SELECT * FROM
                ${sql.unnest(
                    this.db.util.prepareUnnest(
                        periodStatsArray.map((s) => ({
                            ...s,
                            testStatsId,
                            quarter: s.quarter || undefined,
                            month: s.month || undefined,
                            stats: JSON.stringify(s.stats)
                        })),
                        ["testStatsId", "period", "year", "quarter", "month", "dateFrom", "dateTo", "stats"]
                    ),
                    ["uuid", "varchar", "int8", "int8", "int8", "timestamp", "timestamp", "jsonb"]
                )};
                `);
                }
            });
        } catch (err) {
            this.log.error("Failed to calcPortfolio stats", err);
            this.log.debug(job);
            throw err;
        }
    }
}

const statsCalcWorker = new StatsCalcWorker();

const worker = {
    async process(job: TradeStatsJob) {
        await statsCalcWorker.pg();
        const result = await statsCalcWorker.process(job);
        return result;
    }
};

export type StatsWorker = typeof worker;

expose(worker);
