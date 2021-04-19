import dayjs from "@cryptuoso/dayjs";
import { average, chunkArray, divide, round, sortAsc, sum } from "@cryptuoso/helpers";
import { BasePosition } from "@cryptuoso/market";
import { createDatesPeriod } from "./helpers";
import { FullStats, PerformanceVals, Stats, StatsMeta, TradeStats } from "./types";
import logger from "@cryptuoso/logger";

export class TradeStatsCalc implements TradeStats {
    fullStats: TradeStats["fullStats"];
    prevFullStats: TradeStats["fullStats"];
    periodStats: TradeStats["periodStats"];
    prevPeriodStats: TradeStats["periodStats"];
    meta: StatsMeta;
    positions: BasePosition[];

    constructor(positions: BasePosition[], meta: StatsMeta, prevStats?: TradeStats) {
        this.positions = positions.sort((a, b) =>
            sortAsc(dayjs.utc(a.exitDate).valueOf(), dayjs.utc(b.exitDate).valueOf())
        );
        this.meta = {
            ...meta,
            job: {
                ...meta.job,
                round: meta.job.round === true || meta.job.round === false ? meta.job.round : true
            }
        };
        this.fullStats = this.initFullStats(this.positions, prevStats?.fullStats);
        this.periodStats = this.initPeriodStats(prevStats?.periodStats);

        this.prevFullStats = { ...this.fullStats };
        this.prevPeriodStats = { ...this.periodStats };
    }

    public calculate(): TradeStats {
        this.periodStats = this.calcPeriodStats(this.positions, this.prevPeriodStats);
        this.fullStats = this.calcFullStats(this.positions, this.prevFullStats, this.periodStats);

        return {
            fullStats: this.fullStats,
            periodStats: this.periodStats
        };
    }

    private get hasBalance() {
        return ["robot", "userSignal", "userRobot", "portfolio"].includes(this.meta.job.type);
    }

    private roundStats(stats: Stats | FullStats) {
        if (!this.meta.job.round) return stats;
        const roundedStats = { ...stats };

        Object.entries(stats).forEach(([key, value]) => {
            if (typeof value === "number") (roundedStats as any)[key] = round(value, 2);
        });
        return roundedStats;
    }

    private initStats(prevStats?: Stats): Stats {
        return {
            initialBalance: prevStats?.initialBalance || null,
            currentBalance: prevStats?.currentBalance || null,
            tradesCount: prevStats?.tradesCount || 0,
            tradesWinning: prevStats?.tradesWinning || 0,
            tradesLosing: prevStats?.tradesLosing || 0,
            winRate: prevStats?.winRate || 0,
            lossRate: prevStats?.lossRate || 0,
            sumBarsHeld: prevStats?.sumBarsHeld || null,
            avgBarsHeld: prevStats?.avgBarsHeld || null,
            sumBarsHeldWinning: prevStats?.sumBarsHeldWinning || null,
            avgBarsHeldWinning: prevStats?.avgBarsHeldWinning || null,
            sumBarsHeldLosing: prevStats?.sumBarsHeldLosing || null,
            avgBarsHeldLosing: prevStats?.avgBarsHeldLosing || null,
            netProfit: prevStats?.netProfit || 0,
            avgNetProfit: prevStats?.avgNetProfit || null,
            positionsProfitPercents: prevStats?.positionsProfitPercents || [],
            percentNetProfit: prevStats?.percentNetProfit || null,
            sumPercentNetProfit: prevStats?.sumPercentNetProfit || null,
            avgPercentNetProfit: prevStats?.avgPercentNetProfit || null,
            sumPercentNetProfitSqDiff: prevStats?.sumPercentNetProfitSqDiff || null,
            stdDevPercentNetProfit: prevStats?.stdDevPercentNetProfit || null,
            localMax: prevStats?.localMax || 0,
            grossProfit: prevStats?.grossProfit || 0,
            grossLoss: prevStats?.grossLoss || 0,
            avgGrossProfit: prevStats?.avgGrossProfit || null,
            avgGrossLoss: prevStats?.avgGrossLoss || null,
            percentGrossProfit: prevStats?.percentGrossProfit || null,
            percentGrossLoss: prevStats?.percentGrossLoss || null,
            maxConsecWins: prevStats?.maxConsecWins || 0,
            maxConsecLosses: prevStats?.maxConsecLosses || 0,
            currentWinSequence: prevStats?.currentWinSequence || 0,
            currentLossSequence: prevStats?.currentLossSequence || 0,
            maxDrawdown: prevStats?.maxDrawdown || 0,
            maxDrawdownDate: prevStats?.maxDrawdownDate || null,
            profitFactor: prevStats?.profitFactor || null,
            recoveryFactor: prevStats?.recoveryFactor || null,
            payoffRatio: prevStats?.payoffRatio || null,
            sharpeRatio: prevStats?.sharpeRatio || null,
            rating: prevStats?.rating || null,
            lastUpdatedAt: prevStats?.lastUpdatedAt || null,
            firstPosition: prevStats?.firstPosition || null,
            lastPosition: prevStats?.lastPosition || null,
            equity: prevStats?.equity || [],
            equityAvg: prevStats?.equityAvg || []
        };
    }

    private initFullStats(positions: BasePosition[], fullStats: FullStats): FullStats {
        const stats = {
            ...this.initStats(fullStats),
            avgTradesCountYears: fullStats?.avgTradesCountYears || null,
            avgTradesCountQuarters: fullStats?.avgTradesCountQuarters || null,
            avgTradesCountMonths: fullStats?.avgTradesCountMonths || null,
            avgPercentNetProfitYears: fullStats?.avgPercentNetProfitYears || null,
            avgPercentNetProfitQuarters: fullStats?.avgPercentNetProfitQuarters || null,
            avgPercentNetProfitMonths: fullStats?.avgPercentNetProfitMonths || null,
            avgPercentGrossProfitYears: fullStats?.avgPercentGrossProfitYears || null,
            avgPercentGrossProfitQuarters: fullStats?.avgPercentGrossProfitQuarters || null,
            avgPercentGrossProfitMonths: fullStats?.avgPercentGrossProfitMonths || null,
            avgPercentGrossLossYears: fullStats?.avgPercentGrossLossYears || null,
            avgPercentGrossLossQuarters: fullStats?.avgPercentGrossLossQuarters || null,
            avgPercentGrossLossMonths: fullStats?.avgPercentGrossLossMonths || null
        };
        if (!stats.firstPosition) stats.firstPosition = positions[0];
        if (this.hasBalance && stats.initialBalance === null)
            stats.initialBalance =
                this.meta.userInitialBalance || stats.firstPosition.volume * stats.firstPosition.entryPrice;

        return stats;
    }

    private initPeriodStats(periodStats?: TradeStats["periodStats"]): TradeStats["periodStats"] {
        return {
            year: periodStats?.year || {},
            quarter: periodStats?.quarter || {},
            month: periodStats?.month || {}
        };
    }

    get result(): TradeStats {
        return {
            fullStats: this.fullStats,
            periodStats: this.periodStats
        };
    }

    private calculateEquityAvg(equity: PerformanceVals): PerformanceVals {
        const maxEquityLength = 50;

        let chunkLength;

        if (equity.length < maxEquityLength) {
            chunkLength = 1;
        } else if (equity.length > maxEquityLength && equity.length < maxEquityLength * 2) {
            chunkLength = 1.5;
        } else {
            chunkLength = equity.length / maxEquityLength;
        }

        const equityChunks = chunkArray(equity, chunkLength);

        return equityChunks.map((chunk) => ({
            x: chunk[chunk.length - 1].x,
            y: chunk[chunk.length - 1].y
        }));
    }

    private calcStats(allPositions: BasePosition[], prevStats: Stats): Stats {
        const stats = { ...prevStats };

        const positions = allPositions.filter(({ exitDate }) =>
            stats.lastPosition ? dayjs.utc(exitDate).valueOf() > dayjs.utc(stats.lastPosition.exitDate).valueOf() : true
        );

        if (!positions.length) return stats;

        const winningPositions = positions.filter(({ profit }) => profit > 0);
        const lossingPositions = positions.filter(({ profit }) => profit <= 0);

        if (!stats.equity.length) {
            stats.equity.push({
                x: dayjs.utc(stats.firstPosition.entryDate).valueOf(),
                y: 0
            });
        }
        for (const { profit, worstProfit, exitDate } of positions) {
            if (profit > 0) {
                stats.currentWinSequence += 1;
                stats.currentLossSequence = 0;
                if (stats.currentWinSequence > stats.maxConsecWins) stats.maxConsecWins = stats.currentWinSequence;
            } else {
                stats.currentLossSequence += 1;
                stats.currentWinSequence = 0;
                if (stats.currentLossSequence > stats.maxConsecLosses)
                    stats.maxConsecLosses = stats.currentLossSequence;
            }
            const prevNetProfit = stats.netProfit;
            const prevLocalMax = stats.localMax;
            if (this.hasBalance) {
                const percentProfit = (profit * 100) / stats.initialBalance;
                stats.positionsProfitPercents.push(percentProfit);
                stats.sumPercentNetProfit = sum(stats.sumPercentNetProfit, percentProfit);
            }
            stats.netProfit = sum(stats.netProfit, profit);

            if (stats.netProfit > stats.localMax) stats.localMax = stats.netProfit;
            const drawdown = stats.netProfit - stats.localMax;
            if (stats.maxDrawdown > drawdown) {
                stats.maxDrawdown = drawdown;
                stats.maxDrawdownDate = exitDate;
            }

            if (worstProfit) {
                const worstNetProfit = prevNetProfit + worstProfit;
                const worstDrawdown = worstNetProfit - prevLocalMax;
                if (stats.maxDrawdown > worstDrawdown) {
                    stats.maxDrawdown = worstDrawdown;
                }
            }

            stats.equity.push({
                x: dayjs.utc(exitDate).valueOf(),
                y: round(profit, 2)
            });
        }
        stats.equityAvg = this.calculateEquityAvg(stats.equity);
        stats.tradesCount = stats.tradesCount + positions.length;
        stats.tradesWinning = stats.tradesWinning + winningPositions.length;
        stats.tradesLosing = stats.tradesLosing + lossingPositions.length;
        stats.winRate = (stats.tradesWinning / stats.tradesCount) * 100;
        stats.lossRate = (stats.tradesLosing / stats.tradesCount) * 100;
        stats.sumBarsHeld = sum(stats.sumBarsHeld, ...positions.map(({ barsHeld }) => barsHeld));
        stats.avgBarsHeld = stats.sumBarsHeld / stats.tradesCount;
        stats.sumBarsHeldWinning = sum(stats.sumBarsHeldWinning, ...winningPositions.map(({ barsHeld }) => barsHeld));
        stats.avgBarsHeldWinning = stats.sumBarsHeldWinning / stats.tradesCount;
        stats.sumBarsHeldLosing = sum(stats.sumBarsHeldLosing, ...lossingPositions.map(({ barsHeld }) => barsHeld));
        stats.avgBarsHeldLosing = stats.sumBarsHeldLosing / stats.tradesCount;

        stats.avgNetProfit = stats.netProfit / stats.tradesCount;
        stats.grossProfit = sum(stats.grossProfit, ...winningPositions.map(({ profit }) => profit));
        stats.grossLoss = sum(stats.grossLoss, ...lossingPositions.map(({ profit }) => profit));
        stats.avgGrossProfit = stats.grossProfit / stats.tradesCount;
        stats.avgGrossLoss = stats.grossLoss / stats.tradesCount;

        stats.profitFactor = Math.abs(divide(stats.grossProfit, stats.grossLoss));
        stats.recoveryFactor = divide(stats.netProfit, stats.maxDrawdown) * -1;
        stats.payoffRatio = Math.abs(divide(stats.avgGrossProfit, stats.avgGrossLoss));

        if (this.hasBalance) {
            stats.percentNetProfit = (stats.netProfit / stats.initialBalance) * 100;
            stats.avgPercentNetProfit = stats.sumPercentNetProfit / stats.tradesCount;
            stats.currentBalance = stats.initialBalance + stats.netProfit;
            stats.percentGrossProfit = (stats.grossProfit / stats.initialBalance) * 100;
            stats.percentGrossLoss = (stats.grossLoss / stats.initialBalance) * 100;

            stats.sumPercentNetProfitSqDiff = null;
            for (const percent of stats.positionsProfitPercents) {
                const percentProfitSqDiff = Math.pow(percent - stats.avgPercentNetProfit, 2);
                stats.sumPercentNetProfitSqDiff = sum(stats.sumPercentNetProfitSqDiff, percentProfitSqDiff);
            }
            if (stats.tradesCount > 1) {
                stats.stdDevPercentNetProfit = Math.sqrt(stats.sumPercentNetProfitSqDiff) / (stats.tradesCount - 1);
                stats.sharpeRatio = stats.avgPercentNetProfit / stats.stdDevPercentNetProfit;
            }
        }

        stats.lastPosition = positions[positions.length - 1];
        stats.lastUpdatedAt = dayjs.utc(stats.lastPosition.exitDate).toISOString();

        return stats;
    }

    private calcFullStats(
        positions: BasePosition[],

        prevStats: FullStats,
        periodStats: TradeStats["periodStats"]
    ): FullStats {
        const stats = { ...prevStats, ...this.calcStats(positions, prevStats) };
        const years = Object.values(periodStats.year);
        const quarters = Object.values(periodStats.quarter);
        const months = Object.values(periodStats.month);
        stats.avgTradesCountYears = average(...years.map(({ stats: { tradesCount } }) => tradesCount));
        stats.avgTradesCountQuarters = average(...quarters.map(({ stats: { tradesCount } }) => tradesCount));
        stats.avgTradesCountMonths = average(...months.map(({ stats: { tradesCount } }) => tradesCount));
        stats.avgPercentNetProfitYears = average(...years.map(({ stats: { percentNetProfit } }) => percentNetProfit));
        stats.avgPercentNetProfitQuarters = average(
            ...quarters.map(({ stats: { percentNetProfit } }) => percentNetProfit)
        );
        stats.avgPercentNetProfitMonths = average(...months.map(({ stats: { percentNetProfit } }) => percentNetProfit));
        stats.avgPercentGrossProfitYears = average(
            ...years.map(({ stats: { percentGrossProfit } }) => percentGrossProfit)
        );
        stats.avgPercentGrossProfitQuarters = average(
            ...quarters.map(({ stats: { percentGrossProfit } }) => percentGrossProfit)
        );
        stats.avgPercentGrossProfitMonths = average(
            ...months.map(({ stats: { percentGrossProfit } }) => percentGrossProfit)
        );
        stats.avgPercentGrossLossYears = average(...years.map(({ stats: { percentGrossLoss } }) => percentGrossLoss));
        stats.avgPercentGrossLossQuarters = average(
            ...quarters.map(({ stats: { percentGrossLoss } }) => percentGrossLoss)
        );
        stats.avgPercentGrossLossMonths = average(...months.map(({ stats: { percentGrossLoss } }) => percentGrossLoss));

        return this.roundStats(stats) as FullStats;
    }

    private calcPeriodStats(
        positions: BasePosition[],

        prevPeriodStats: TradeStats["periodStats"]
    ): TradeStats["periodStats"] {
        const periodStats = { ...prevPeriodStats };
        const firstPositionExitDate = positions[0].exitDate;
        const lastPositionExitDate = positions[positions.length - 1].exitDate;
        const years = createDatesPeriod(firstPositionExitDate, lastPositionExitDate, "year");
        const quearters = createDatesPeriod(firstPositionExitDate, lastPositionExitDate, "quarter");
        const months = createDatesPeriod(firstPositionExitDate, lastPositionExitDate, "month");

        for (const year of years) {
            try {
                const currentPositions = positions.filter(({ exitDate }) =>
                    dayjs.utc(exitDate).isBetween(year.dateFrom, year.dateTo)
                );
                if (!periodStats.year[year.key]) {
                    periodStats.year[year.key] = {
                        period: "year",
                        year: year.year,
                        dateFrom: year.dateFrom,
                        dateTo: year.dateTo,
                        stats: this.initStats()
                    };
                    const prevPeriodStats = Object.values(periodStats.year).find(
                        ({ dateFrom }) => dateFrom === dayjs.utc(year.dateFrom).add(-1, "year").toISOString()
                    );
                    if (currentPositions.length) {
                        if (!periodStats.year[year.key].stats.firstPosition)
                            periodStats.year[year.key].stats.firstPosition = currentPositions[0];
                        if (this.hasBalance && periodStats.year[year.key].stats.initialBalance === null)
                            periodStats.year[year.key].stats.initialBalance =
                                prevPeriodStats?.stats?.currentBalance ||
                                this.meta.userInitialBalance ||
                                periodStats.year[year.key].stats.firstPosition.volume *
                                    periodStats.year[year.key].stats.firstPosition.entryPrice;
                    } else if (this.hasBalance) {
                        periodStats.year[year.key].stats.initialBalance =
                            prevPeriodStats?.stats?.currentBalance || null;
                        periodStats.quarter[year.year].stats.currentBalance =
                            periodStats.quarter[year.year].stats.initialBalance;
                    }
                }

                periodStats.year[year.key].stats = this.calcStats(
                    currentPositions,

                    periodStats.year[year.key].stats
                );
                periodStats.year[year.key].stats = this.roundStats(periodStats.year[year.key].stats);
            } catch (err) {
                logger.error(err);
                logger.debug(year);
                throw err;
            }
        }
        for (const quarter of quearters) {
            try {
                const currentPositions = positions.filter(({ exitDate }) =>
                    dayjs.utc(exitDate).isBetween(quarter.dateFrom, quarter.dateTo)
                );
                if (!periodStats.quarter[quarter.key]) {
                    periodStats.quarter[quarter.key] = {
                        period: "quarter",
                        year: quarter.year,
                        quarter: quarter.quarter,
                        dateFrom: quarter.dateFrom,
                        dateTo: quarter.dateTo,
                        stats: this.initStats()
                    };
                    const prevPeriodStats = Object.values(periodStats.quarter).find(
                        ({ dateFrom }) => dateFrom === dayjs.utc(quarter.dateFrom).add(-1, "quarter").toISOString()
                    );
                    if (currentPositions.length) {
                        if (!periodStats.quarter[quarter.key].stats.firstPosition)
                            periodStats.quarter[quarter.key].stats.firstPosition = currentPositions[0];
                        if (this.hasBalance && periodStats.quarter[quarter.key].stats.initialBalance === null)
                            periodStats.quarter[quarter.key].stats.initialBalance =
                                prevPeriodStats?.stats?.currentBalance ||
                                this.meta.userInitialBalance ||
                                periodStats.quarter[quarter.key].stats.firstPosition.volume *
                                    periodStats.quarter[quarter.key].stats.firstPosition.entryPrice;
                    } else if (this.hasBalance) {
                        periodStats.quarter[quarter.key].stats.initialBalance =
                            prevPeriodStats?.stats?.currentBalance || null;
                        periodStats.quarter[quarter.key].stats.currentBalance =
                            periodStats.quarter[quarter.key].stats.initialBalance;
                    }
                }

                periodStats.quarter[quarter.key].stats = this.calcStats(
                    currentPositions,

                    periodStats.quarter[quarter.key].stats
                );
                periodStats.quarter[quarter.key].stats = this.roundStats(periodStats.quarter[quarter.key].stats);
            } catch (err) {
                logger.error(err);
                logger.debug(quarter);
                throw err;
            }
        }
        for (const month of months) {
            try {
                const currentPositions = positions.filter(({ exitDate }) =>
                    dayjs.utc(exitDate).isBetween(month.dateFrom, month.dateTo)
                );
                if (!periodStats.month[month.key]) {
                    periodStats.month[month.key] = {
                        period: "month",
                        year: month.year,
                        month: month.month,
                        dateFrom: month.dateFrom,
                        dateTo: month.dateTo,
                        stats: this.initStats()
                    };

                    const prevPeriodStats = Object.values(periodStats.month).find(
                        ({ dateFrom }) => dateFrom === dayjs.utc(month.dateFrom).add(-1, "month").toISOString()
                    );
                    if (currentPositions.length) {
                        if (!periodStats.month[month.key].stats.firstPosition)
                            periodStats.month[month.key].stats.firstPosition = currentPositions[0];
                        if (this.hasBalance && periodStats.month[month.key].stats.initialBalance === null)
                            periodStats.month[month.key].stats.initialBalance =
                                prevPeriodStats?.stats?.currentBalance ||
                                this.meta.userInitialBalance ||
                                periodStats.month[month.key].stats.firstPosition.volume *
                                    periodStats.month[month.key].stats.firstPosition.entryPrice;
                    } else if (this.hasBalance) {
                        periodStats.month[month.key].stats.initialBalance =
                            prevPeriodStats?.stats?.currentBalance || null;
                        periodStats.month[month.key].stats.currentBalance =
                            periodStats.month[month.key].stats.initialBalance;
                    }
                }

                periodStats.month[month.key].stats = this.calcStats(
                    currentPositions,

                    periodStats.month[month.key].stats
                );
                periodStats.month[month.key].stats = this.roundStats(periodStats.month[month.key].stats);
            } catch (err) {
                logger.error(err);
                logger.debug(month);
                throw err;
            }
        }

        return periodStats;
    }
}
