import dayjs from "@cryptuoso/dayjs";
import { average, calcPercentValue, chunkArray, divide, nvl, round, sortAsc, sortDesc, sum } from "@cryptuoso/helpers";
import { BasePosition, calcPositionProfit } from "@cryptuoso/market";
import { calcZScore, createDatesPeriod } from "./helpers";
import { BaseStats, FullStats, PerformanceVals, Stats, StatsMeta, TradeStats, TradeStatsPortfolio } from "./types";
import logger from "@cryptuoso/logger";
//import fs from "fs";

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
                round: meta.job.round === true || meta.job.round === false ? meta.job.round : true,
                savePositions:
                    meta.job.savePositions === true || meta.job.savePositions === false ? meta.job.savePositions : false
            }
        };
        let portfolioPositions: BasePosition[], maxLeverage: FullStats["maxLeverage"];
        if (this.meta.job.type === "portfolio") {
            ({ positions: portfolioPositions, maxLeverage } = this.preparePortfolioPositions(
                this.positions,
                prevStats?.fullStats
            ));
            this.positions = portfolioPositions;
        }
        // const data = JSON.stringify(this.positions);
        //  fs.writeFileSync("testResults/allPositions.json", data);

        this.fullStats = this.initFullStats(this.positions, prevStats?.fullStats);
        this.periodStats = this.initPeriodStats(prevStats?.periodStats);
        if (this.meta.job.recalc && this.meta.job.type === "portfolio") this.fullStats.maxLeverage = maxLeverage;
        this.prevFullStats = { ...this.fullStats };
        this.prevPeriodStats = { ...this.periodStats };
    }

    private preparePortfolioPositions(
        allPositions: BasePosition[],
        fullStats: FullStats
    ): { positions: BasePosition[]; maxLeverage: FullStats["maxLeverage"] } {
        const dates = [
            ...allPositions.map((p) => ({
                date: dayjs.utc(p.entryDate).valueOf(),
                side: "entry",
                position: p
            })),
            ...allPositions.map((p) => ({
                date: dayjs.utc(p.exitDate).valueOf(),
                side: "exit",
                position: p
            }))
        ].sort((a, b) => sortAsc(a.date, b.date));
        let availableFunds = this.meta.initialBalance;
        let maxLeverage = this.meta.job.recalc ? 0 : fullStats.maxLeverage;
        let netProfit = this.meta.job.recalc ? 0 : fullStats.netProfit;
        let currentBalance = fullStats?.currentBalance ?? this.meta.initialBalance;
        let prevBalance = currentBalance;
        const { feeRate } = <TradeStatsPortfolio>this.meta.job;
        const results: { [id: string]: BasePosition } = {};
        for (const { position, side } of dates) {
            const openPosition = results[position.id];

            const newPosition: BasePosition = {
                ...position,
                ...openPosition
            };
            const {
                direction,
                entryPrice,
                exitPrice,
                maxPrice,
                meta: { portfolioShare }
            } = newPosition;
            if (side === "entry") {
                const leveragedBalance = prevBalance * (this.meta.leverage || 1);
                newPosition.amountInCurrency = calcPercentValue(leveragedBalance, portfolioShare);
                newPosition.volume = round(newPosition.amountInCurrency / entryPrice, 6);

                if (this.meta.job.recalc) availableFunds = availableFunds - entryPrice * newPosition.volume;
                newPosition.meta = { ...newPosition.meta, prevBalance };
            }

            if (side === "exit") {
                newPosition.profit = calcPositionProfit(direction, entryPrice, exitPrice, newPosition.volume, feeRate);
                newPosition.worstProfit = calcPositionProfit(
                    direction,
                    entryPrice,
                    maxPrice,
                    newPosition.volume,
                    feeRate
                );
                if (newPosition.worstProfit > 0) newPosition.worstProfit = null;
                netProfit = sum(netProfit, newPosition.profit);
                currentBalance = sum(this.meta.initialBalance, netProfit);

                newPosition.meta = { ...newPosition.meta, currentBalance };
                prevBalance = currentBalance;

                if (this.meta.job.recalc) availableFunds = availableFunds + exitPrice * newPosition.volume;
            }

            if (this.meta.job.recalc) {
                const leverage = availableFunds / currentBalance;
                if (leverage < maxLeverage) maxLeverage = leverage;
            }
            results[position.id] = newPosition;
        }
        return {
            positions: Object.values(results).sort((a, b) =>
                sortAsc(dayjs.utc(a.exitDate).valueOf(), dayjs.utc(b.exitDate).valueOf())
            ),
            maxLeverage
        };
    }

    public async calculate(): Promise<TradeStats> {
        this.periodStats = this.calcPeriodStats(this.positions, this.prevPeriodStats);
        this.fullStats = this.calcFullStats(this.positions, this.prevFullStats, this.periodStats);

        return {
            fullStats: this.fullStats,
            periodStats: this.periodStats,
            positions: this.meta.job.savePositions ? this.positions : null
        };
    }

    private get hasBalance() {
        return ["robot", "userRobot", "portfolio"].includes(this.meta.job.type);
    }

    private roundStats(stats: BaseStats | Stats | FullStats) {
        if (!this.meta.job.round) return stats;
        const roundedStats = { ...stats };

        Object.entries(stats).forEach(([key, value]) => {
            if (typeof value === "number") (roundedStats as any)[key] = round(value, 2);
        });
        return roundedStats;
    }

    private initBaseStats(prevStats?: BaseStats): BaseStats {
        return {
            initialBalance: nvl(prevStats?.initialBalance),
            currentBalance: nvl(prevStats?.currentBalance, nvl(prevStats?.initialBalance)),
            tradesCount: nvl(prevStats?.tradesCount, 0),
            tradesWinning: nvl(prevStats?.tradesWinning, 0),
            tradesLosing: nvl(prevStats?.tradesLosing, 0),
            winRate: nvl(prevStats?.winRate, 0),
            lossRate: nvl(prevStats?.lossRate, 0),
            netProfit: nvl(prevStats?.netProfit, 0),
            avgNetProfit: nvl(prevStats?.avgNetProfit),
            percentNetProfit: nvl(prevStats?.percentNetProfit, 0),
            localMax: nvl(prevStats?.localMax, 0),
            grossProfit: nvl(prevStats?.grossProfit, 0),
            grossLoss: nvl(prevStats?.grossLoss, 0),
            avgGrossProfit: nvl(prevStats?.avgGrossProfit),
            avgGrossLoss: nvl(prevStats?.avgGrossLoss),
            percentGrossProfit: nvl(prevStats?.percentGrossProfit),
            percentGrossLoss: nvl(prevStats?.percentGrossLoss),
            maxDrawdown: nvl(prevStats?.maxDrawdown, 0),
            percentMaxDrawdown: nvl(prevStats?.percentMaxDrawdown, 0),
            maxDrawdownDate: nvl(prevStats?.maxDrawdownDate),
            percentMaxDrawdownDate: nvl(prevStats?.percentMaxDrawdownDate),
            profitFactor: nvl(prevStats?.profitFactor),
            recoveryFactor: nvl(prevStats?.recoveryFactor),
            payoffRatio: nvl(prevStats?.payoffRatio),
            lastUpdatedAt: nvl(prevStats?.lastUpdatedAt),
            firstPosition: nvl(prevStats?.firstPosition),
            lastPosition: nvl(prevStats?.lastPosition)
        };
    }

    private initStats(prevStats?: Stats): Stats {
        return {
            initialBalance: nvl(prevStats?.initialBalance),
            currentBalance: nvl(prevStats?.currentBalance, nvl(prevStats?.initialBalance)),
            tradesCount: nvl(prevStats?.tradesCount, 0),
            tradesWinning: nvl(prevStats?.tradesWinning, 0),
            tradesLosing: nvl(prevStats?.tradesLosing, 0),
            winRate: nvl(prevStats?.winRate, 0),
            lossRate: nvl(prevStats?.lossRate, 0),
            sumBarsHeld: nvl(prevStats?.sumBarsHeld),
            avgBarsHeld: nvl(prevStats?.avgBarsHeld),
            sumBarsHeldWinning: nvl(prevStats?.sumBarsHeldWinning),
            avgBarsHeldWinning: nvl(prevStats?.avgBarsHeldWinning),
            sumBarsHeldLosing: nvl(prevStats?.sumBarsHeldLosing),
            avgBarsHeldLosing: nvl(prevStats?.avgBarsHeldLosing),
            netProfit: nvl(prevStats?.netProfit, 0),
            netProfitSMA: nvl(prevStats?.netProfitSMA),
            netProfitsSMA: nvl(prevStats?.netProfitsSMA, []),
            avgNetProfit: nvl(prevStats?.avgNetProfit),
            // positionsProfitPercents: nvl(prevStats?.positionsProfitPercents, []),
            percentNetProfit: nvl(prevStats?.percentNetProfit, 0),
            // sumPercentNetProfit: nvl(prevStats?.sumPercentNetProfit),
            //  avgPercentNetProfit: nvl(prevStats?.avgPercentNetProfit),
            // sumPercentNetProfitSqDiff: nvl(prevStats?.sumPercentNetProfitSqDiff),

            stdDevPercentNetProfit: nvl(prevStats?.stdDevPercentNetProfit),
            localMax: nvl(prevStats?.localMax, 0),
            grossProfit: nvl(prevStats?.grossProfit, 0),
            grossLoss: nvl(prevStats?.grossLoss, 0),
            avgGrossProfit: nvl(prevStats?.avgGrossProfit),
            avgGrossLoss: nvl(prevStats?.avgGrossLoss),
            percentGrossProfit: nvl(prevStats?.percentGrossProfit),
            percentGrossLoss: nvl(prevStats?.percentGrossLoss),
            maxConsecWins: nvl(prevStats?.maxConsecWins, 0),
            maxConsecLosses: nvl(prevStats?.maxConsecLosses, 0),
            currentWinSequence: nvl(prevStats?.currentWinSequence, 0),
            currentLossSequence: nvl(prevStats?.currentLossSequence, 0),
            maxDrawdown: nvl(prevStats?.maxDrawdown, 0),
            percentMaxDrawdown: nvl(prevStats?.percentMaxDrawdown, 0),
            maxDrawdownDate: nvl(prevStats?.maxDrawdownDate),
            percentMaxDrawdownDate: nvl(prevStats?.percentMaxDrawdownDate),
            amountProportion: nvl(prevStats?.amountProportion),
            profitFactor: nvl(prevStats?.profitFactor),
            recoveryFactor: nvl(prevStats?.recoveryFactor),
            payoffRatio: nvl(prevStats?.payoffRatio),
            sharpeRatio: nvl(prevStats?.sharpeRatio),
            rating: nvl(prevStats?.rating),
            lastUpdatedAt: nvl(prevStats?.lastUpdatedAt),
            firstPosition: nvl(prevStats?.firstPosition),
            lastPosition: nvl(prevStats?.lastPosition),
            equity: nvl(prevStats?.equity, []),
            equityAvg: nvl(prevStats?.equityAvg, []),
            seriesCount: nvl(prevStats?.seriesCount, 0),
            currentSeries: nvl(prevStats?.currentSeries)
        };
    }

    private initFullStats(positions: BasePosition[], fullStats: FullStats): FullStats {
        const stats = {
            ...this.initStats(fullStats),
            avgTradesCountYears: nvl(fullStats?.avgTradesCountYears),
            avgTradesCountQuarters: nvl(fullStats?.avgTradesCountQuarters),
            avgTradesCountMonths: nvl(fullStats?.avgTradesCountMonths),
            avgPercentNetProfitYears: nvl(fullStats?.avgPercentNetProfitYears),
            avgPercentNetProfitQuarters: nvl(fullStats?.avgPercentNetProfitQuarters),
            avgPercentNetProfitMonths: nvl(fullStats?.avgPercentNetProfitMonths),
            avgPercentGrossProfitYears: nvl(fullStats?.avgPercentGrossProfitYears),
            avgPercentGrossProfitQuarters: nvl(fullStats?.avgPercentGrossProfitQuarters),
            avgPercentGrossProfitMonths: nvl(fullStats?.avgPercentGrossProfitMonths),
            avgPercentGrossLossYears: nvl(fullStats?.avgPercentGrossLossYears),
            avgPercentGrossLossQuarters: nvl(fullStats?.avgPercentGrossLossQuarters),
            avgPercentGrossLossMonths: nvl(fullStats?.avgPercentGrossLossMonths),
            emulateNextPosition: nvl(fullStats?.emulateNextPosition, false),
            marginNextPosition: nvl(fullStats?.marginNextPosition, 1),
            zScore: nvl(fullStats?.zScore),
            maxLeverage: nvl(fullStats?.maxLeverage),
            periodStats: nvl(fullStats?.periodStats, {
                year: {},
                quarter: {},
                month: {}
            })
        };
        if (!stats.firstPosition) stats.firstPosition = positions[0];
        if (this.hasBalance && stats.initialBalance === null) {
            stats.initialBalance =
                this.meta.initialBalance || stats.firstPosition.volume * stats.firstPosition.entryPrice;
            stats.currentBalance = stats.initialBalance;
        }

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

                if (stats.currentSeries === -1) {
                    stats.currentSeries = 1;
                    stats.seriesCount += 1;
                }
            } else {
                stats.currentLossSequence += 1;
                stats.currentWinSequence = 0;
                if (stats.currentLossSequence > stats.maxConsecLosses)
                    stats.maxConsecLosses = stats.currentLossSequence;

                if (stats.currentSeries === 1) {
                    stats.currentSeries = -1;
                    stats.seriesCount += 1;
                }
            }

            if (!stats.currentSeries) {
                stats.currentSeries = profit > 0 ? 1 : -1;
                stats.seriesCount += 1;
            }

            const prevNetProfit = stats.netProfit;
            const prevLocalMax = stats.localMax;

            /*  if (this.hasBalance) {
                const percentProfit = (profit * 100) / stats.currentBalance;
                stats.positionsProfitPercents.push(percentProfit);
                stats.sumPercentNetProfit = sum(stats.sumPercentNetProfit, percentProfit);

            } */
            stats.netProfit = sum(stats.netProfit, profit);

            stats.currentBalance = sum(stats.initialBalance, stats.netProfit);
            if (this.meta.job.type === "robot") {
                stats.netProfitsSMA.push(stats.netProfit);
            }
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
                    stats.maxDrawdownDate = exitDate;
                }
            }

            if (this.hasBalance) {
                const percentDrawdown = (Math.abs(stats.maxDrawdown) / stats.currentBalance) * 100;
                if (percentDrawdown > stats.percentMaxDrawdown) {
                    stats.percentMaxDrawdown = percentDrawdown;
                    stats.percentMaxDrawdownDate = exitDate;
                }
            }

            stats.equity.push({
                x: dayjs.utc(exitDate).valueOf(),
                y: round(stats.netProfit, 2)
            });
        }

        const winningPositions = positions.filter(({ profit }) => profit > 0);
        const lossingPositions = positions.filter(({ profit }) => profit <= 0);

        stats.equity = stats.equity.sort((a, b) => sortAsc(a.x, b.x));
        stats.equityAvg = this.calculateEquityAvg(stats.equity);
        stats.tradesCount = stats.tradesCount + positions.length;
        stats.tradesWinning = stats.tradesWinning + winningPositions.length;
        stats.tradesLosing = stats.tradesLosing + lossingPositions.length;
        stats.winRate = (stats.tradesWinning / stats.tradesCount) * 100;
        stats.lossRate = (stats.tradesLosing / stats.tradesCount) * 100;
        stats.sumBarsHeld = sum(stats.sumBarsHeld, ...positions.map(({ barsHeld }) => barsHeld));
        if (!["portfolio", "userPortfolio"].includes(this.meta.job.type))
            stats.avgBarsHeld = stats.sumBarsHeld / stats.tradesCount;
        stats.sumBarsHeldWinning = sum(stats.sumBarsHeldWinning, ...winningPositions.map(({ barsHeld }) => barsHeld));
        stats.avgBarsHeldWinning = stats.sumBarsHeldWinning / stats.tradesCount;
        stats.sumBarsHeldLosing = sum(stats.sumBarsHeldLosing, ...lossingPositions.map(({ barsHeld }) => barsHeld));
        stats.avgBarsHeldLosing = stats.sumBarsHeldLosing / stats.tradesCount;

        stats.avgNetProfit = stats.netProfit / stats.tradesCount;
        stats.grossProfit = sum(stats.grossProfit, ...winningPositions.map(({ profit }) => profit));
        stats.grossLoss = sum(stats.grossLoss, ...lossingPositions.map(({ profit }) => profit));
        stats.avgGrossProfit = stats.grossProfit / stats.tradesWinning;
        stats.avgGrossLoss = stats.grossLoss / stats.tradesLosing;

        stats.profitFactor = Math.abs(divide(stats.grossProfit, stats.grossLoss));
        stats.recoveryFactor = divide(stats.netProfit, stats.maxDrawdown) * -1;
        stats.payoffRatio = Math.abs(divide(stats.avgGrossProfit, stats.avgGrossLoss));

        if (this.hasBalance) {
            stats.percentNetProfit = (stats.netProfit / stats.initialBalance) * 100;
            stats.percentGrossProfit = (stats.grossProfit / stats.initialBalance) * 100;
            stats.percentGrossLoss = (stats.grossLoss / stats.initialBalance) * 100;
            stats.amountProportion = 100 / stats.percentMaxDrawdown;

            /*  stats.avgPercentNetProfit = stats.sumPercentNetProfit / stats.tradesCount;
            stats.sumPercentNetProfitSqDiff = null;
            for (const percent of stats.positionsProfitPercents) {
                const percentProfitSqDiff = Math.pow(percent - stats.avgPercentNetProfit, 2);
                stats.sumPercentNetProfitSqDiff = sum(stats.sumPercentNetProfitSqDiff, percentProfitSqDiff);
            }
            if (stats.tradesCount > 1) {
                stats.stdDevPercentNetProfit = Math.sqrt(stats.sumPercentNetProfitSqDiff) / (stats.tradesCount - 1);
                stats.sharpeRatio = stats.avgPercentNetProfit / stats.stdDevPercentNetProfit;
            } */
        }

        stats.lastPosition = positions[positions.length - 1];
        stats.lastUpdatedAt = dayjs.utc(stats.lastPosition.exitDate).toISOString();

        if (this.meta.job.type === "robot" && this.meta.job.SMAWindow) {
            const window = this.meta.job.SMAWindow;
            stats.netProfitsSMA = stats.netProfitsSMA.slice(-window);
            if (stats.netProfitsSMA.length === window) stats.netProfitSMA = sum(...stats.netProfitsSMA) / window;
        }

        return stats;
    }

    private calcBaseStats(allPositions: BasePosition[], prevStats: BaseStats): BaseStats {
        const stats = { ...prevStats };

        const positions = allPositions.filter(({ exitDate }) =>
            stats.lastPosition ? dayjs.utc(exitDate).valueOf() > dayjs.utc(stats.lastPosition.exitDate).valueOf() : true
        );

        if (!positions.length) return stats;

        for (const { profit, worstProfit, exitDate } of positions) {
            const prevNetProfit = stats.netProfit;
            const prevLocalMax = stats.localMax;

            stats.netProfit = sum(stats.netProfit, profit);

            stats.currentBalance = sum(stats.initialBalance, stats.netProfit);

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
                    stats.maxDrawdownDate = exitDate;
                }
            }

            if (this.hasBalance) {
                const percentDrawdown = (Math.abs(stats.maxDrawdown) / stats.currentBalance) * 100;
                if (percentDrawdown > stats.percentMaxDrawdown) {
                    stats.percentMaxDrawdown = percentDrawdown;
                    stats.percentMaxDrawdownDate = exitDate;
                }
            }
        }

        const winningPositions = positions.filter(({ profit }) => profit > 0);
        const lossingPositions = positions.filter(({ profit }) => profit <= 0);

        stats.tradesCount = stats.tradesCount + positions.length;
        stats.tradesWinning = stats.tradesWinning + winningPositions.length;
        stats.tradesLosing = stats.tradesLosing + lossingPositions.length;
        stats.winRate = (stats.tradesWinning / stats.tradesCount) * 100;
        stats.lossRate = (stats.tradesLosing / stats.tradesCount) * 100;

        stats.avgNetProfit = stats.netProfit / stats.tradesCount;
        stats.grossProfit = sum(stats.grossProfit, ...winningPositions.map(({ profit }) => profit));
        stats.grossLoss = sum(stats.grossLoss, ...lossingPositions.map(({ profit }) => profit));
        stats.avgGrossProfit = stats.grossProfit / stats.tradesWinning;
        stats.avgGrossLoss = stats.grossLoss / stats.tradesLosing;

        stats.profitFactor = Math.abs(divide(stats.grossProfit, stats.grossLoss));
        stats.recoveryFactor = divide(stats.netProfit, stats.maxDrawdown) * -1;
        stats.payoffRatio = Math.abs(divide(stats.avgGrossProfit, stats.avgGrossLoss));

        if (this.hasBalance) {
            stats.percentNetProfit = (stats.netProfit / stats.initialBalance) * 100;
            stats.percentGrossProfit = (stats.grossProfit / stats.initialBalance) * 100;
            stats.percentGrossLoss = (stats.grossLoss / stats.initialBalance) * 100;
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

        for (const [key, value] of Object.entries(periodStats.year)) {
            stats.periodStats.year[key] = {
                ...value,
                stats: {
                    tradesCount: value.stats.tradesCount,
                    percentNetProfit: value.stats.percentNetProfit,
                    percentGrossProfit: value.stats.percentGrossProfit,
                    percentGrossLoss: value.stats.percentGrossLoss
                }
            };
        }

        for (const [key, value] of Object.entries(periodStats.quarter)) {
            stats.periodStats.quarter[key] = {
                ...value,
                stats: {
                    tradesCount: value.stats.tradesCount,
                    percentNetProfit: value.stats.percentNetProfit,
                    percentGrossProfit: value.stats.percentGrossProfit,
                    percentGrossLoss: value.stats.percentGrossLoss
                }
            };
        }

        for (const [key, value] of Object.entries(periodStats.month)) {
            stats.periodStats.month[key] = {
                ...value,
                stats: {
                    tradesCount: value.stats.tradesCount,
                    percentNetProfit: value.stats.percentNetProfit,
                    percentGrossProfit: value.stats.percentGrossProfit,
                    percentGrossLoss: value.stats.percentGrossLoss
                }
            };
        }

        const years = Object.values(stats.periodStats.year);
        const quarters = Object.values(stats.periodStats.quarter);
        const months = Object.values(stats.periodStats.month);
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

        if (this.hasBalance) {
            const prevMonths = months
                .sort((a, b) => sortAsc(dayjs.utc(a.dateFrom).valueOf(), dayjs.utc(b.dateFrom).valueOf()))
                .slice(0, -1);

            if (prevMonths && prevMonths.length > 2) {
                const positionsProfitPercents = prevMonths.map(({ stats }) => stats.percentNetProfit);
                const sumPercentNetProfit = sum(...positionsProfitPercents);

                const avgPercentNetProfit = sumPercentNetProfit / prevMonths.length;
                let sumPercentNetProfitSqDiff = null;
                for (const percent of positionsProfitPercents) {
                    const percentProfitSqDiff = Math.pow(percent - avgPercentNetProfit, 2);
                    sumPercentNetProfitSqDiff = sum(sumPercentNetProfitSqDiff, percentProfitSqDiff);
                }

                stats.stdDevPercentNetProfit = Math.sqrt(sumPercentNetProfitSqDiff) / (prevMonths.length - 1);
                stats.sharpeRatio = avgPercentNetProfit / stats.stdDevPercentNetProfit;
            }

            if (this.meta.job.type === "robot") {
                /* if (this.meta.job.margin) {
                    if (stats.lastPosition.profit < 0) stats.marginNextPosition = this.meta.job.margin;
                    else stats.marginNextPosition = 1;
                }
                if (this.meta.job.SMAWindow) {
                    if (stats.netProfitSMA) {
                        stats.emulateNextPosition = stats.netProfit < stats.netProfitSMA;
                    } else {
                        stats.emulateNextPosition = false;
                    }
                }*/

                if (stats.tradesCount >= 30) {
                    stats.zScore = calcZScore(
                        stats.tradesCount,
                        stats.seriesCount,
                        stats.tradesWinning,
                        stats.tradesLosing
                    );
                    if (stats.zScore > 2.5) {
                        if (stats.lastPosition.profit > 0) {
                            stats.emulateNextPosition = true;
                            stats.marginNextPosition = 1;
                        } else {
                            stats.emulateNextPosition = false;
                            stats.marginNextPosition = this.meta.job.margin;
                        }
                    } else if (stats.zScore < -2) {
                        if (stats.lastPosition.profit > 0) {
                            stats.emulateNextPosition = false;
                            stats.marginNextPosition = this.meta.job.margin;
                        } else {
                            stats.emulateNextPosition = true;
                            stats.marginNextPosition = 1;
                        }
                    } else {
                        stats.emulateNextPosition = false;
                        stats.marginNextPosition = 1;
                    }
                }
            }
        }
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
                    dayjs.utc(exitDate).isBetween(year.dateFrom, year.dateTo, null, "[]")
                );
                if (!periodStats.year[year.key]) {
                    periodStats.year[year.key] = {
                        period: "year",
                        year: year.year,
                        dateFrom: year.dateFrom,
                        dateTo: year.dateTo,
                        stats: this.initBaseStats()
                    };
                    const prevPeriodStats = Object.values(periodStats.year).find(
                        ({ dateFrom }) => dateFrom === dayjs.utc(year.dateFrom).add(-1, "year").toISOString()
                    );
                    if (currentPositions.length) {
                        if (!periodStats.year[year.key].stats.firstPosition)
                            periodStats.year[year.key].stats.firstPosition = currentPositions[0];
                        if (this.hasBalance && periodStats.year[year.key].stats.initialBalance === null) {
                            periodStats.year[year.key].stats.initialBalance =
                                prevPeriodStats?.stats?.currentBalance ||
                                this.meta.initialBalance ||
                                periodStats.year[year.key].stats.firstPosition.volume *
                                    periodStats.year[year.key].stats.firstPosition.entryPrice;
                            periodStats.year[year.key].stats.currentBalance =
                                periodStats.year[year.key].stats.initialBalance;
                        }
                    } else if (this.hasBalance) {
                        periodStats.year[year.key].stats.initialBalance =
                            prevPeriodStats?.stats?.currentBalance || null;
                        periodStats.year[year.year].stats.currentBalance =
                            periodStats.year[year.year].stats.initialBalance;
                    }
                }

                periodStats.year[year.key].stats = this.calcBaseStats(
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
                    dayjs.utc(exitDate).isBetween(quarter.dateFrom, quarter.dateTo, null, "[]")
                );
                if (!periodStats.quarter[quarter.key]) {
                    periodStats.quarter[quarter.key] = {
                        period: "quarter",
                        year: quarter.year,
                        quarter: quarter.quarter,
                        dateFrom: quarter.dateFrom,
                        dateTo: quarter.dateTo,
                        stats: this.initBaseStats()
                    };
                    const prevPeriodStats = Object.values(periodStats.quarter).find(
                        ({ dateFrom }) => dateFrom === dayjs.utc(quarter.dateFrom).add(-1, "quarter").toISOString()
                    );
                    if (currentPositions.length) {
                        if (!periodStats.quarter[quarter.key].stats.firstPosition)
                            periodStats.quarter[quarter.key].stats.firstPosition = currentPositions[0];
                        if (this.hasBalance && periodStats.quarter[quarter.key].stats.initialBalance === null) {
                            periodStats.quarter[quarter.key].stats.initialBalance =
                                prevPeriodStats?.stats?.currentBalance ||
                                this.meta.initialBalance ||
                                periodStats.quarter[quarter.key].stats.firstPosition.volume *
                                    periodStats.quarter[quarter.key].stats.firstPosition.entryPrice;
                            periodStats.quarter[quarter.key].stats.currentBalance =
                                periodStats.quarter[quarter.key].stats.initialBalance;
                        }
                    } else if (this.hasBalance) {
                        periodStats.quarter[quarter.key].stats.initialBalance =
                            prevPeriodStats?.stats?.currentBalance || null;
                        periodStats.quarter[quarter.key].stats.currentBalance =
                            periodStats.quarter[quarter.key].stats.initialBalance;
                    }
                }

                periodStats.quarter[quarter.key].stats = this.calcBaseStats(
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
                    dayjs.utc(exitDate).isBetween(month.dateFrom, month.dateTo, null, "[]")
                );
                if (!periodStats.month[month.key]) {
                    periodStats.month[month.key] = {
                        period: "month",
                        year: month.year,
                        month: month.month,
                        dateFrom: month.dateFrom,
                        dateTo: month.dateTo,
                        stats: this.initBaseStats()
                    };

                    const prevPeriodStats = Object.values(periodStats.month).find(
                        ({ dateFrom }) => dateFrom === dayjs.utc(month.dateFrom).add(-1, "month").toISOString()
                    );
                    if (currentPositions.length) {
                        if (!periodStats.month[month.key].stats.firstPosition)
                            periodStats.month[month.key].stats.firstPosition = currentPositions[0];
                        if (this.hasBalance && periodStats.month[month.key].stats.initialBalance === null) {
                            periodStats.month[month.key].stats.initialBalance =
                                prevPeriodStats?.stats?.currentBalance ||
                                this.meta.initialBalance ||
                                periodStats.month[month.key].stats.firstPosition.volume *
                                    periodStats.month[month.key].stats.firstPosition.entryPrice;
                            periodStats.month[month.key].stats.currentBalance =
                                periodStats.month[month.key].stats.initialBalance;
                        }
                    } else if (this.hasBalance) {
                        periodStats.month[month.key].stats.initialBalance =
                            prevPeriodStats?.stats?.currentBalance || null;
                        periodStats.month[month.key].stats.currentBalance =
                            periodStats.month[month.key].stats.initialBalance;
                    }
                }

                periodStats.month[month.key].stats = this.calcBaseStats(
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
