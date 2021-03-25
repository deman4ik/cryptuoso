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
        this.meta = meta;
        this.fullStats = this.initFullStats(this.positions, meta, prevStats?.fullStats);
        this.periodStats = this.initPeriodStats(prevStats?.periodStats);

        this.prevFullStats = { ...this.fullStats };
        this.prevPeriodStats = { ...this.periodStats };
    }

    public calculate(): TradeStats {
        this.periodStats = this.calcPeriodStats(this.positions, this.meta, this.prevPeriodStats);
        this.fullStats = this.calcFullStats(this.positions, this.meta, this.prevFullStats, this.periodStats);

        return {
            fullStats: this.fullStats,
            periodStats: this.periodStats
        };
    }

    private hasBalance(type?: StatsMeta["type"]) {
        return ["robot", "userSignal", "userRobot", "userExAcc", "portfolio"].includes(type || this.meta.type);
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
            avgBarsHeld: prevStats?.avgBarsHeld || null,
            avgBarsHeldWinning: prevStats?.avgBarsHeldWinning || null,
            avgBarsHeldLosing: prevStats?.avgBarsHeldLosing || null,
            netProfit: prevStats?.netProfit || 0,
            avgNetProfit: prevStats?.avgNetProfit || null,
            percentNetProfit: prevStats?.percentNetProfit || null,
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
            rating: prevStats?.rating || null,
            lastUpdatedAt: prevStats?.lastUpdatedAt || null,
            firstPosition: prevStats?.firstPosition || null,
            lastPosition: prevStats?.lastPosition || null,
            equity: prevStats?.equity || [],
            equityAvg: prevStats?.equityAvg || []
        };
    }

    private initFullStats(positions: BasePosition[], meta: StatsMeta, fullStats: FullStats): FullStats {
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
        if (this.hasBalance(meta.type) && stats.initialBalance === null)
            stats.initialBalance =
                meta.userInitialBalance || stats.firstPosition.volume * stats.firstPosition.entryPrice;

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

    private calcStats(allPositions: BasePosition[], meta: StatsMeta, prevStats: Stats): Stats {
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

        for (const { profit, exitDate } of positions) {
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

            stats.netProfit += profit;
            if (stats.netProfit > stats.localMax) stats.localMax = stats.netProfit;
            const drawdown = stats.netProfit - stats.localMax;
            if (stats.maxDrawdown > drawdown) {
                stats.maxDrawdown = drawdown;
                stats.maxDrawdownDate = exitDate;
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
        stats.avgBarsHeld = average(stats.avgBarsHeld, ...positions.map(({ barsHeld }) => barsHeld));
        stats.avgBarsHeldWinning = average(
            stats.avgBarsHeldWinning,
            ...winningPositions.map(({ barsHeld }) => barsHeld)
        );
        stats.avgBarsHeldLosing = average(stats.avgBarsHeldLosing, ...lossingPositions.map(({ barsHeld }) => barsHeld));

        stats.avgNetProfit = average(stats.avgNetProfit, ...positions.map(({ profit }) => profit));
        stats.grossProfit = sum(stats.grossProfit, ...winningPositions.map(({ profit }) => profit));
        stats.grossLoss = sum(stats.grossLoss, ...lossingPositions.map(({ profit }) => profit));
        stats.avgGrossProfit = average(stats.avgGrossProfit, ...winningPositions.map(({ profit }) => profit));
        stats.avgGrossLoss = average(stats.avgGrossLoss, ...lossingPositions.map(({ profit }) => profit));

        stats.profitFactor = Math.abs(divide(stats.grossProfit, stats.grossLoss));
        stats.recoveryFactor = divide(stats.netProfit, stats.maxDrawdown) * -1;
        stats.payoffRatio = Math.abs(divide(stats.avgGrossProfit, stats.avgGrossLoss));

        if (this.hasBalance()) {
            stats.percentNetProfit = (stats.netProfit / stats.initialBalance) * 100;
            stats.currentBalance = stats.initialBalance + stats.netProfit;
            stats.percentGrossProfit = (stats.grossProfit / stats.initialBalance) * 100;
            stats.percentGrossLoss = (stats.grossLoss / stats.initialBalance) * 100;
        }

        stats.lastPosition = positions[positions.length - 1];
        stats.lastUpdatedAt = dayjs.utc(stats.lastPosition.exitDate).toISOString();

        return stats;
    }

    private calcFullStats(
        positions: BasePosition[],
        meta: StatsMeta,
        prevStats: FullStats,
        periodStats: TradeStats["periodStats"]
    ): FullStats {
        const stats = { ...prevStats, ...this.calcStats(positions, meta, prevStats) };
        const years = Object.values(periodStats.year);
        const quarters = Object.values(periodStats.quarter);
        const months = Object.values(periodStats.month);
        stats.avgTradesCountYears = average(
            stats.avgTradesCountYears,
            ...years.map(({ stats: { tradesCount } }) => tradesCount)
        );
        stats.avgTradesCountQuarters = average(
            stats.avgTradesCountQuarters,
            ...quarters.map(({ stats: { tradesCount } }) => tradesCount)
        );
        stats.avgTradesCountMonths = average(
            stats.avgTradesCountMonths,
            ...months.map(({ stats: { tradesCount } }) => tradesCount)
        );
        stats.avgPercentNetProfitYears = average(
            stats.avgPercentNetProfitYears,
            ...years.map(({ stats: { percentNetProfit } }) => percentNetProfit)
        );
        stats.avgPercentNetProfitQuarters = average(
            stats.avgPercentNetProfitQuarters,
            ...quarters.map(({ stats: { percentNetProfit } }) => percentNetProfit)
        );
        stats.avgPercentNetProfitMonths = average(
            stats.avgPercentNetProfitMonths,
            ...months.map(({ stats: { percentNetProfit } }) => percentNetProfit)
        );
        stats.avgPercentGrossProfitYears = average(
            stats.avgPercentGrossProfitYears,
            ...years.map(({ stats: { percentGrossProfit } }) => percentGrossProfit)
        );
        stats.avgPercentGrossProfitQuarters = average(
            stats.avgPercentGrossProfitQuarters,
            ...quarters.map(({ stats: { percentGrossProfit } }) => percentGrossProfit)
        );
        stats.avgPercentGrossProfitMonths = average(
            stats.avgPercentGrossProfitMonths,
            ...months.map(({ stats: { percentGrossProfit } }) => percentGrossProfit)
        );
        stats.avgPercentGrossLossYears = average(
            stats.avgPercentGrossLossYears,
            ...years.map(({ stats: { percentGrossLoss } }) => percentGrossLoss)
        );
        stats.avgPercentGrossLossQuarters = average(
            stats.avgPercentGrossLossQuarters,
            ...quarters.map(({ stats: { percentGrossLoss } }) => percentGrossLoss)
        );
        stats.avgPercentGrossLossMonths = average(
            stats.avgPercentGrossLossMonths,
            ...months.map(({ stats: { percentGrossLoss } }) => percentGrossLoss)
        );
        return stats;
    }

    private calcPeriodStats(
        positions: BasePosition[],
        meta: StatsMeta,
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
                            periodStats.year[year.key].stats.firstPosition = positions.filter(({ exitDate }) =>
                                dayjs.utc(exitDate).isBetween(year.dateFrom, year.dateTo)
                            )[0];
                        if (this.hasBalance(meta.type) && periodStats.year[year.key].stats.initialBalance === null)
                            periodStats.year[year.key].stats.initialBalance =
                                prevPeriodStats?.stats?.currentBalance ||
                                meta.userInitialBalance ||
                                periodStats.year[year.key].stats.firstPosition.volume *
                                    periodStats.year[year.key].stats.firstPosition.entryPrice;
                    } else if (this.hasBalance(meta.type)) {
                        periodStats.year[year.key].stats.initialBalance =
                            prevPeriodStats?.stats?.currentBalance || null;
                        periodStats.quarter[year.year].stats.currentBalance =
                            periodStats.quarter[year.year].stats.initialBalance;
                    }
                }

                periodStats.year[year.key].stats = this.calcStats(
                    currentPositions,
                    meta,
                    periodStats.year[year.key].stats
                );
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
                            periodStats.quarter[quarter.key].stats.firstPosition = positions.filter(({ exitDate }) =>
                                dayjs.utc(exitDate).isBetween(quarter.dateFrom, quarter.dateTo)
                            )[0];
                        if (
                            this.hasBalance(meta.type) &&
                            periodStats.quarter[quarter.key].stats.initialBalance === null
                        )
                            periodStats.quarter[quarter.key].stats.initialBalance =
                                prevPeriodStats?.stats?.currentBalance ||
                                meta.userInitialBalance ||
                                periodStats.quarter[quarter.key].stats.firstPosition.volume *
                                    periodStats.quarter[quarter.key].stats.firstPosition.entryPrice;
                    } else if (this.hasBalance(meta.type)) {
                        periodStats.quarter[quarter.key].stats.initialBalance =
                            prevPeriodStats?.stats?.currentBalance || null;
                        periodStats.quarter[quarter.key].stats.currentBalance =
                            periodStats.quarter[quarter.key].stats.initialBalance;
                    }
                }

                periodStats.quarter[quarter.key].stats = this.calcStats(
                    currentPositions,
                    meta,
                    periodStats.quarter[quarter.key].stats
                );
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
                            periodStats.month[month.key].stats.firstPosition = positions.filter(({ exitDate }) =>
                                dayjs.utc(exitDate).isBetween(month.dateFrom, month.dateTo)
                            )[0];
                        if (this.hasBalance(meta.type) && periodStats.month[month.key].stats.initialBalance === null)
                            periodStats.month[month.key].stats.initialBalance =
                                prevPeriodStats?.stats?.currentBalance ||
                                meta.userInitialBalance ||
                                periodStats.month[month.key].stats.firstPosition.volume *
                                    periodStats.month[month.key].stats.firstPosition.entryPrice;
                    } else if (this.hasBalance(meta.type)) {
                        periodStats.month[month.key].stats.initialBalance =
                            prevPeriodStats?.stats?.currentBalance || null;
                        periodStats.month[month.key].stats.currentBalance =
                            periodStats.month[month.key].stats.initialBalance;
                    }
                }

                periodStats.month[month.key].stats = this.calcStats(
                    currentPositions,
                    meta,
                    periodStats.month[month.key].stats
                );
            } catch (err) {
                logger.error(err);
                logger.debug(month);
                throw err;
            }
        }

        return periodStats;
    }
}
