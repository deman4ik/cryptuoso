import { Statistics, TradeStats, TradeStatsClass, StatsNumberValue, StatsStringValue, PerformanceVals } from "./types";
import dayjs from "@cryptuoso/dayjs";
import { round, chunkArray } from "@cryptuoso/helpers";
import { BasePosition, PositionDirection } from "@cryptuoso/market";
import {
    makeValidateFunc,
    PositionForStatsSchema,
    PositionsForStatsSchema,
    StatisticsSchema,
    TradeStatsSchema
} from "./schemes";

function initializeValues(stat: StatsNumberValue): StatsNumberValue {
    const values = { ...stat };
    for (const key in values) if (values[key] == null) values[key] = 0;
    return values;
}

function divide(a: number, b: number) {
    if (a === 0) return 0;
    if (!a || !b || b === 0) return null;
    return a / b;
}

export function roundToNumberOrNull(num: number, decimals = 0): number {
    if (!isFinite(num) || (!num && num != 0)) return null;

    return round(num, decimals);
}

export function roundRobotStatVals(vals: StatsNumberValue, decimals = 0): StatsNumberValue {
    const result = { ...vals };

    for (const key in result) {
        result[key] = roundToNumberOrNull(result[key], decimals);
    }

    return result;
}

export const checkPositionForStats = makeValidateFunc<BasePosition>(PositionForStatsSchema);

export const checkPositionsForStats = makeValidateFunc<BasePosition[]>(PositionsForStatsSchema);

export const checkStatistics = makeValidateFunc<Statistics>(StatisticsSchema);

export const checkTradeStats = makeValidateFunc<TradeStats>(TradeStatsSchema);

// ignores integers
function roundStatisticsValues(statistics: Statistics): Statistics {
    const result = { ...statistics };

    result.winRate = roundRobotStatVals(result.winRate);
    result.lossRate = roundRobotStatVals(result.lossRate);
    result.avgBarsHeld = roundRobotStatVals(result.avgBarsHeld, 2);
    result.avgBarsHeldWinning = roundRobotStatVals(result.avgBarsHeldWinning, 2);
    result.avgBarsHeldLosing = roundRobotStatVals(result.avgBarsHeldLosing, 2);
    result.netProfit = roundRobotStatVals(result.netProfit, 2);
    result.avgNetProfit = roundRobotStatVals(result.avgNetProfit, 2);
    result.grossProfit = roundRobotStatVals(result.grossProfit, 2);
    result.avgProfit = roundRobotStatVals(result.avgProfit, 2);
    result.avgProfitWinners = roundRobotStatVals(result.avgProfitWinners, 2);
    result.grossLoss = roundRobotStatVals(result.grossLoss, 2);
    result.avgLoss = roundRobotStatVals(result.avgLoss, 2);
    result.payoffRatio = roundRobotStatVals(result.payoffRatio, 2);
    result.maxDrawdown = roundRobotStatVals(result.maxDrawdown, 2);
    result.profitFactor = roundRobotStatVals(result.profitFactor, 2);
    result.recoveryFactor = roundRobotStatVals(result.recoveryFactor, 2);
    result.rating = roundRobotStatVals(result.rating, 2);

    return result;
}

/*function validateArguments(...args: any[]) {
    const reasonMsg = "Updating methods might have been called in wrong order.";
    for (const arg of args) {
        if (arg == null) {
            throw new Error(`Validation error: argument ${args.indexOf(arg)} cannot be null. ` + reasonMsg);
        }
    }
}*/

export default class StatisticsCalculator {
    private readonly positions: BasePosition[];
    //private prevStatistics: Statistics;
    //private currentStatistics: Statistics;
    private prevTradeStats: TradeStats;
    private currentTradeStats: TradeStats;
    private newPosition: BasePosition;
    private dir: PositionDirection;
    private currentPositionIndex = 0;

    private get prevStatistics() {
        return this.prevTradeStats.statistics;
    }
    private set prevStatistics(value: Statistics) {
        this.prevTradeStats.statistics = value;
    }

    private get currentStatistics() {
        return this.currentTradeStats.statistics;
    }
    private set currentStatistics(value: Statistics) {
        this.currentTradeStats.statistics = value;
    }

    public constructor(prevTradeStats: TradeStats, positions: BasePosition[]) {
        if (positions.length < 1) throw new Error("At least 1 position expected");

        /*  const checkPositions = checkPositionsForStats(positions);
        if (checkPositions !== true)
            throw new BaseError(`Invalid positions provided - ${checkPositions.map((e) => e.message).join(" ")}`); */

        /*  if (prevTradeStats != null) {
            const checkStats = checkTradeStats(prevTradeStats);
            if (checkStats !== true) {
                throw new Error(
                    `Invalid robotStatistics object provided - ${checkStats.map((e) => e.message).join(" ")}`
                ); // calculations are allowed if null or valid obj is provided
            }
        } */

        if (prevTradeStats && prevTradeStats.lastPositionExitDate != "") {
            this.positions = positions.filter(
                (pos) => dayjs.utc(pos.exitDate).valueOf() > dayjs.utc(prevTradeStats.lastPositionExitDate).valueOf()
            );

            if (this.positions.length < 1) throw new Error("At least 1 fresh position expected");
        } else this.positions = positions;

        this.setPosition(0);
        this.setTradeStats(prevTradeStats);
    }

    public getStats(): TradeStats {
        while (this.currentPositionIndex < this.positions.length) {
            this.selectNextPosition();
            this.updateStatisticsValues();
            if (this.currentPositionIndex !== this.positions.length) this.setTradeStats(this.currentTradeStats);
        }

        this.updateEquityAvg();

        //this.currentTradeStats.statistics = this.currentStatistics;

        return this.currentTradeStats;
    }

    private setTradeStats(prevStats: TradeStats) {
        this.prevTradeStats = prevStats || new TradeStatsClass();
        //this.prevStatistics = this.prevTradeStats.statistics;
        this.currentTradeStats = JSON.parse(JSON.stringify(this.prevTradeStats));
        //this.currentStatistics = this.currentTradeStats.statistics;
    }

    updateEquityAvg() {
        this.currentTradeStats.equityAvg = this.calculateEquityAvg(this.currentTradeStats.equity);
        return this;
    }

    calculateEquityAvg(equity: PerformanceVals): PerformanceVals {
        const maxEquityLength = 50;
        //const equityChart = this.currentTradeStats.equity;

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

    private selectNextPosition() {
        this.setPosition(this.getNextPositionIndex());
    }

    private setPosition(idx: number) {
        this.newPosition = this.positions[idx];
        this.dir = this.newPosition.direction;
    }

    private getNextPositionIndex() {
        return this.currentPositionIndex++;
    }

    //updating is consecutive
    private updateStatisticsValues(): StatisticsCalculator {
        this.updateTradesAll()
            .updateTradesWinning()
            .updateTradesLosing()
            .updateWinRate()
            .updateLossRate()
            .updateAvgBarsHeld()
            .updateAvgBarsHeldWinning()
            .updateAvgBarsHeldLosing()
            .updateNetProfit()
            .updateLocalMax()
            .updateGrossProfit()
            .updateGrossLoss()
            .updateAvgNetProfit()
            .updateAvgProfit()
            .updateAvgProfitWinners()
            .updateAvgLoss()
            .updateProfitFactor()
            .updatePayoffRatio()
            .updateMaxSequence()
            .updateMaxDrawdown()
            .updateEquity()
            .updateRecoveryFactor()
            .validateRating()
            .roundCurrentStatistics()
            .updateLastExitDate()
            .updateLastUpdated();

        return this;
    }

    //#region Private methods
    private roundCurrentStatistics(): StatisticsCalculator {
        this.currentStatistics = roundStatisticsValues(this.currentStatistics);
        return this;
    }

    private updateTradesAll(): StatisticsCalculator {
        this.currentStatistics.tradesCount = this.incrementTradesCount(this.prevStatistics.tradesCount);

        return this;
    }

    private updateTradesWinning(): StatisticsCalculator {
        if (this.newPosition.profit > 0)
            this.currentStatistics.tradesWinning = this.incrementTradesCount(this.prevStatistics.tradesWinning);

        return this;
    }

    private updateTradesLosing(): StatisticsCalculator {
        if (this.newPosition.profit < 0)
            this.currentStatistics.tradesLosing = this.incrementTradesCount(this.prevStatistics.tradesLosing);

        return this;
    }

    private updateWinRate(): StatisticsCalculator {
        this.currentStatistics.winRate = this.calculateRate(
            this.prevStatistics.winRate,
            this.currentStatistics.tradesWinning,
            this.currentStatistics.tradesCount
        );

        return this;
    }

    private updateLossRate(): StatisticsCalculator {
        this.currentStatistics.lossRate = this.calculateRate(
            this.prevStatistics.lossRate,
            this.currentStatistics.tradesLosing,
            this.currentStatistics.tradesCount
        );

        return this;
    }

    private updateAvgBarsHeld(): StatisticsCalculator {
        this.currentStatistics.avgBarsHeld = this.calculateAverageBarsHeld(
            this.prevStatistics.avgBarsHeld,
            this.prevStatistics.tradesCount,
            this.currentStatistics.tradesCount,
            this.newPosition.barsHeld
        );

        return this;
    }

    private updateAvgBarsHeldWinning(): StatisticsCalculator {
        if (this.newPosition.profit > 0) {
            this.currentStatistics.avgBarsHeldWinning = this.calculateAverageBarsHeld(
                this.prevStatistics.avgBarsHeldWinning,
                this.prevStatistics.tradesWinning,
                this.currentStatistics.tradesWinning,
                this.newPosition.barsHeld
            );
        }

        return this;
    }

    private updateAvgBarsHeldLosing(): StatisticsCalculator {
        if (this.newPosition.profit < 0) {
            this.currentStatistics.avgBarsHeldLosing = this.calculateAverageBarsHeld(
                this.prevStatistics.avgBarsHeldLosing,
                this.prevStatistics.tradesLosing,
                this.currentStatistics.tradesLosing,
                this.newPosition.barsHeld
            );
        }

        return this;
    }

    private updateNetProfit(): StatisticsCalculator {
        this.currentStatistics.netProfit = this.calculateProfit(this.prevStatistics.netProfit, this.newPosition.profit);

        return this;
    }

    private updateGrossProfit(): StatisticsCalculator {
        if (this.newPosition.profit > 0)
            this.currentStatistics.grossProfit = this.calculateProfit(
                this.prevStatistics.grossProfit,
                this.newPosition.profit
            );
        this.currentStatistics.grossProfit = initializeValues(this.currentStatistics.grossProfit);
        return this;
    }

    private updateGrossLoss(): StatisticsCalculator {
        if (this.newPosition.profit < 0)
            this.currentStatistics.grossLoss = this.calculateProfit(
                this.prevStatistics.grossLoss,
                this.newPosition.profit
            );
        this.currentStatistics.grossLoss = initializeValues(this.currentStatistics.grossLoss);
        return this;
    }

    private updateAvgNetProfit(): StatisticsCalculator {
        this.currentStatistics.avgNetProfit = this.calculateAverageMark(
            this.prevStatistics.avgNetProfit,
            this.currentStatistics.netProfit,
            this.currentStatistics.tradesCount
        );

        return this;
    }

    private updateAvgProfit(): StatisticsCalculator {
        if (this.newPosition.profit > 0)
            this.currentStatistics.avgProfit = this.calculateAverageProfit(
                this.prevStatistics.avgProfit,
                this.currentStatistics.grossProfit,
                this.currentStatistics.grossLoss,
                this.currentStatistics.tradesCount
            );
        this.currentStatistics.avgProfit = initializeValues(this.currentStatistics.avgProfit);
        return this;
    }

    private updateAvgProfitWinners(): StatisticsCalculator {
        if (this.newPosition.profit > 0)
            this.currentStatistics.avgProfitWinners = this.calculateAverageMark(
                this.prevStatistics.avgProfitWinners,
                this.currentStatistics.grossProfit,
                this.currentStatistics.tradesWinning
            );
        this.currentStatistics.avgProfit = initializeValues(this.currentStatistics.avgProfit);
        return this;
    }

    private updateAvgLoss(): StatisticsCalculator {
        if (this.newPosition.profit < 0)
            this.currentStatistics.avgLoss = this.calculateAverageMark(
                this.prevStatistics.avgLoss,
                this.currentStatistics.grossLoss,
                this.currentStatistics.tradesLosing
            );
        this.currentStatistics.avgLoss = initializeValues(this.currentStatistics.avgLoss);
        return this;
    }

    private updateProfitFactor(): StatisticsCalculator {
        this.currentStatistics.profitFactor = this.calculateRatio(
            this.currentStatistics.grossProfit,
            this.currentStatistics.grossLoss
        );

        return this;
    }

    private updatePayoffRatio(): StatisticsCalculator {
        this.currentStatistics.payoffRatio = this.calculateRatio(
            this.currentStatistics.avgProfit,
            this.currentStatistics.avgLoss
        );

        return this;
    }

    private updateMaxSequence(): StatisticsCalculator {
        if (this.newPosition.profit <= 0) {
            this.currentStatistics.currentWinSequence = this.nullifySequence(this.prevStatistics.currentWinSequence);
            this.currentStatistics.currentLossSequence = this.incrementSequence(
                this.prevStatistics.currentLossSequence
            );
            this.currentStatistics.maxConsecLosses = this.incrementMaxSequence(
                this.prevStatistics.currentLossSequence,
                this.prevStatistics.maxConsecLosses
            );
        } else {
            this.currentStatistics.currentLossSequence = this.nullifySequence(this.prevStatistics.currentLossSequence);
            this.currentStatistics.currentWinSequence = this.incrementSequence(this.prevStatistics.currentWinSequence);
            this.currentStatistics.maxConsecWins = this.incrementMaxSequence(
                this.prevStatistics.currentWinSequence,
                this.prevStatistics.maxConsecWins
            );
        }

        return this;
    }

    private updateMaxDrawdown(): StatisticsCalculator {
        const { newDrawdown, newDate } = this.calculateMaxDrawdown(
            this.prevStatistics.maxDrawdown,
            this.prevStatistics.maxDrawdownDate,
            this.newPosition.exitDate,
            this.currentStatistics.netProfit,
            this.currentStatistics.localMax
        );
        this.currentStatistics.maxDrawdown = newDrawdown;
        this.currentStatistics.maxDrawdownDate = newDate;
        return this;
    }

    private updateEquity(): StatisticsCalculator {
        this.currentTradeStats.equity = this.calculateEquity(
            this.currentTradeStats.equity,
            this.newPosition.profit,
            this.newPosition.exitDate
        );

        return this;
    }

    private updateRecoveryFactor(): StatisticsCalculator {
        this.currentStatistics.recoveryFactor = this.calculateRecoveryFactor(
            this.prevStatistics.recoveryFactor,
            this.currentStatistics.netProfit,
            this.currentStatistics.maxDrawdown
        );

        return this;
    }

    private updateLocalMax(): StatisticsCalculator {
        this.currentStatistics.localMax = this.calculateLocalMax(
            this.prevStatistics.localMax,
            this.currentStatistics.netProfit
        );

        return this;
    }

    private updateLastUpdated(): StatisticsCalculator {
        this.currentTradeStats.lastUpdatedAt = dayjs.utc().toISOString();

        return this;
    }

    private validateRating(): StatisticsCalculator {
        this.currentStatistics.rating = this.calculateRating(
            this.currentStatistics.profitFactor,
            this.currentStatistics.payoffRatio,
            this.currentStatistics.recoveryFactor
        );

        return this;
    }

    private updateLastExitDate(): StatisticsCalculator {
        this.currentTradeStats.lastPositionExitDate = this.newPosition.exitDate;
        return this;
    }
    //#endregion

    //#region Public methods
    public incrementTradesCount(tradesCount: StatsNumberValue): StatsNumberValue {
        //validateArguments(tradesCount.all, tradesCount[this.dir]);

        const newTradesCount = { ...tradesCount };

        newTradesCount.all++;
        newTradesCount[this.dir]++;

        return newTradesCount;
    }

    public calculateRate(
        prevRate: StatsNumberValue,
        currentTradesRated: StatsNumberValue,
        currentTradesCount: StatsNumberValue
    ): StatsNumberValue {
        /*validateArguments(
            currentTradesRated.all,
            currentTradesRated[this.dir],
            currentTradesCount.all,
            currentTradesCount[this.dir]
        ); */

        const newRate = { ...prevRate };

        newRate.all = (currentTradesRated.all / currentTradesCount.all) * 100;
        newRate[this.dir] = (currentTradesRated[this.dir] / currentTradesCount[this.dir]) * 100;

        return newRate;
    }

    public calculateAverageBarsHeld(
        prevAvgBars: StatsNumberValue,
        prevTradesCount: StatsNumberValue,
        newTradesCount: StatsNumberValue,
        newBars: number
    ): StatsNumberValue {
        /*validateArguments(
            prevTradesCount.all,
            prevTradesCount[this.dir],
            newTradesCount.all,
            newTradesCount[this.dir],
            newBars
        ); */

        const newAvgBars = { ...prevAvgBars };

        const prevBarsAll = prevAvgBars.all * prevTradesCount.all;
        const prevBarsDir = prevAvgBars[this.dir] * prevTradesCount[this.dir];

        newAvgBars.all = (prevBarsAll + newBars) / newTradesCount.all;
        newAvgBars[this.dir] = (prevBarsDir + newBars) / newTradesCount[this.dir];

        return newAvgBars;
    }

    public calculateProfit(prevProfit: StatsNumberValue, profit: number): StatsNumberValue {
        //validateArguments(profit);

        const newProfit = { ...prevProfit };

        newProfit.all = prevProfit.all + profit;
        newProfit[this.dir] = prevProfit[this.dir] + profit;

        return newProfit;
    }

    public calculateAverageProfit(
        prevAvgProfit: StatsNumberValue,
        currentGrossProfit: StatsNumberValue,
        currentGrossLoss: StatsNumberValue,
        currentTradesCount: StatsNumberValue
    ): StatsNumberValue {
        /*validateArguments(
            currentGrossProfit.all,
            currentGrossProfit[this.dir],
            currentGrossLoss.all,
            currentGrossLoss[this.dir],
            currentTradesCount.all,
            currentTradesCount[this.dir]
        ); */

        const newAvgProfit = { ...prevAvgProfit };

        newAvgProfit.all = (currentGrossProfit.all + currentGrossLoss.all) / currentTradesCount.all;
        newAvgProfit[this.dir] =
            (currentGrossProfit[this.dir] + currentGrossLoss[this.dir]) / currentTradesCount[this.dir];

        return newAvgProfit;
    }

    public calculateAverageMark(
        prevAvgProfit: StatsNumberValue,
        currentMark: StatsNumberValue,
        currentTradesCount: StatsNumberValue
    ): StatsNumberValue {
        //validateArguments(currentMark.all, currentMark[this.dir], currentTradesCount.all, currentTradesCount[this.dir]);

        const newAvgProfit = { ...prevAvgProfit };

        newAvgProfit.all = currentMark.all / currentTradesCount.all;
        newAvgProfit[this.dir] = currentMark[this.dir] / currentTradesCount[this.dir];

        return newAvgProfit;
    }

    public calculateRatio(profitStat: StatsNumberValue, lossStat: StatsNumberValue): StatsNumberValue {
        //validateArguments(profitStat.all, profitStat[this.dir], lossStat.all, lossStat[this.dir]);

        return new StatsNumberValue(
            Math.abs(divide(profitStat.all, lossStat.all)),
            Math.abs(divide(profitStat.long, lossStat.long)),
            Math.abs(divide(profitStat.short, lossStat.short))
        );
    }

    public nullifySequence(prevSequence: StatsNumberValue): StatsNumberValue {
        //validateArguments(prevSequence.all, prevSequence[this.dir]);

        const newSequence = { ...prevSequence };

        newSequence.all = 0;
        newSequence[this.dir] = 0;

        return newSequence;
    }

    public incrementSequence(prevSequence: StatsNumberValue): StatsNumberValue {
        //validateArguments(prevSequence.all, prevSequence[this.dir]);

        const newSequence = { ...prevSequence };

        newSequence.all = prevSequence.all + 1;
        newSequence[this.dir] = prevSequence[this.dir] + 1;

        return newSequence;
    }

    public incrementMaxSequence(prevSequence: StatsNumberValue, maxSequence: StatsNumberValue): StatsNumberValue {
        //validateArguments(prevSequence.all, prevSequence[this.dir], maxSequence.all, maxSequence[this.dir]);

        const newMax = { ...maxSequence };

        newMax.all = Math.max(maxSequence.all, prevSequence.all + 1);
        newMax[this.dir] = Math.max(maxSequence[this.dir], prevSequence[this.dir] + 1);

        return newMax;
    }

    public calculateMaxDrawdown(
        prevDrawdown: StatsNumberValue,
        prevDate: StatsStringValue,
        exitDate: string,
        netProfit: StatsNumberValue,
        localMax: StatsNumberValue
    ): { newDrawdown: StatsNumberValue; newDate: StatsStringValue } {
        //validateArguments(netProfit.all, netProfit[this.dir], localMax.all, localMax[this.dir]);

        const currentDrawdownAll = netProfit.all - localMax.all;
        const currentDrawdownDir = netProfit[this.dir] - localMax[this.dir];

        const newDrawdown = { ...prevDrawdown };
        const newDate = { ...prevDate };
        if (prevDrawdown.all > currentDrawdownAll) {
            newDrawdown.all = currentDrawdownAll;
            newDate.all = exitDate;
        }

        if (prevDrawdown[this.dir] > currentDrawdownDir) {
            newDrawdown[this.dir] = currentDrawdownDir;
            newDate[this.dir] = exitDate;
        }
        return { newDrawdown, newDate };
    }

    public calculateEquity(prevPerformance: PerformanceVals, profit: number, exitDate: string): PerformanceVals {
        //validateArguments(profit, exitDate);

        const newPerformance = [...prevPerformance];
        const prevSum = prevPerformance.length > 0 ? prevPerformance[prevPerformance.length - 1].y : 0;

        newPerformance.push({ x: dayjs.utc(exitDate).valueOf(), y: round(prevSum + profit, 2) });

        return newPerformance;
    }

    public calculateRecoveryFactor(
        prevFactor: StatsNumberValue,
        netProfit: StatsNumberValue,
        maxDrawdown: StatsNumberValue
    ): StatsNumberValue {
        //validateArguments(netProfit.all, netProfit[this.dir], maxDrawdown.all, maxDrawdown[this.dir]);

        const newFactor = { ...prevFactor };

        newFactor.all = divide(netProfit.all, maxDrawdown.all) * -1;
        newFactor[this.dir] = divide(netProfit[this.dir], maxDrawdown[this.dir]) * -1;

        return newFactor;
    }

    public calculateLocalMax(prevMax: StatsNumberValue, netProfit: StatsNumberValue) {
        //validateArguments(prevMax.all, prevMax[this.dir], netProfit);

        const newMax = { ...prevMax };

        newMax.all = Math.max(prevMax.all, netProfit.all);
        newMax[this.dir] = Math.max(prevMax[this.dir], netProfit[this.dir]);

        return newMax;
    }

    public calculateRating(
        profitFactor: StatsNumberValue,
        payoffRatio: StatsNumberValue,
        recoveryFactor: StatsNumberValue,
        profitFactorWeight = 0.35,
        recoveryFactorWeight = 0.25,
        payoffRatioWeight = 0.4
    ): StatsNumberValue {
        //validateArguments(profitFactor.all, payoffRatio.all, recoveryFactor.all);

        if (!isFinite(profitFactorWeight) || !isFinite(recoveryFactorWeight) || !isFinite(payoffRatioWeight))
            throw new Error("Arguments must be finite numbers");

        if (Math.abs(profitFactorWeight + recoveryFactorWeight + payoffRatioWeight - 1) > Number.EPSILON)
            throw new Error("Sum of weights must be equal to 1");

        return new StatsNumberValue(
            profitFactorWeight * profitFactor.all +
                payoffRatioWeight * payoffRatio.all +
                recoveryFactorWeight * recoveryFactor.all
        );
    }
    //#endregion
}
