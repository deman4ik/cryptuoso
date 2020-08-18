import {
    PositionDataForStats,
    PositionDirection,
    RobotStats,
    isRobotStats,
    isPositionDataForStats,
    RobotNumberValue,
    RobotStringValue,
    PerformanceVals
} from "./trade-statistics";
import dayjs from "@cryptuoso/dayjs";
import { round } from "@cryptuoso/helpers";

function initializeValues(stat: RobotNumberValue): RobotNumberValue {
    const values = { ...stat };
    for (const key in values) if (values[key] == null) values[key] = 0;
    return values;
}

export function roundRobotStatVals(vals: RobotNumberValue, decimals = 0): RobotNumberValue {
    const result = { ...vals };

    for (const key in result) {
        result[key] = result[key] ? round(result[key], decimals) : null;
    }

    return result;
}

// ignores integers
function roundStatisticsValues(statistics: RobotStats): RobotStats {
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
    result.grossLoss = roundRobotStatVals(result.grossLoss, 2);
    result.avgLoss = roundRobotStatVals(result.avgLoss, 2);
    result.payoffRatio = roundRobotStatVals(result.payoffRatio, 2);
    result.maxDrawdown = roundRobotStatVals(result.maxDrawdown, 2);
    result.profitFactor = roundRobotStatVals(result.profitFactor, 2);
    result.recoveryFactor = roundRobotStatVals(result.recoveryFactor, 2);

    return result;
}

function validateArguments(...args: any[]) {
    const reasonMsg = "Updating methods might have been called in wrong order.";
    for (const arg of args) {
        if (arg == null) {
            throw new Error(`Validation error: argument ${args.indexOf(arg)} cannot be null. ` + reasonMsg);
        }
    }
}

export default class StatisticsCalculator {
    private readonly positions: PositionDataForStats[];
    private prevStatistics: RobotStats;
    private currentStatistics: RobotStats;
    private newPosition: PositionDataForStats;
    private dir: PositionDirection;
    private currentPositionIndex = 0;

    public constructor(prevStatistics: RobotStats, positions: PositionDataForStats[]) {
        if (positions.length < 1) throw new Error("At least 1 position expected");

        for (const pos of positions) if (!isPositionDataForStats(pos)) throw new Error("Invalid position provided");

        if (prevStatistics != null && !isRobotStats(prevStatistics))
            throw new Error("Invalid statistics object provided"); // calculations are allowed if null or valid obj is provided

        if (prevStatistics && prevStatistics.lastPositionExitDate != "")
            this.positions = positions.filter(
                (pos) => dayjs.utc(pos.exitDate).valueOf() > dayjs.utc(prevStatistics.lastPositionExitDate).valueOf()
            );
        else this.positions = positions;

        this.setPosition(0);
        this.setStatistics(prevStatistics);
    }

    public getStats(): RobotStats {
        while (this.currentPositionIndex < this.positions.length) {
            this.selectNextPosition();
            this.updateStatisticsValues();
            if (this.currentPositionIndex !== this.positions.length) this.setStatistics(this.currentStatistics);
        }

        return this.currentStatistics;
    }

    private setStatistics(prevStats: RobotStats) {
        this.prevStatistics = prevStats || new RobotStats();
        this.currentStatistics = JSON.parse(JSON.stringify(this.prevStatistics));
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
            .updateAvgLoss()
            .updateProfitFactor()
            .updatePayoffRatio()
            .updateMaxSequence()
            .updateMaxDrawdown()
            .updateMaxDrawdownDate()
            .updatePerformance()
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
        this.currentStatistics.avgNetProfit = this.calculateAverageProfit(
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
                this.currentStatistics.tradesWinning
            );
        this.currentStatistics.avgProfit = initializeValues(this.currentStatistics.avgProfit);
        return this;
    }

    private updateAvgLoss(): StatisticsCalculator {
        if (this.newPosition.profit < 0)
            this.currentStatistics.avgLoss = this.calculateAverageProfit(
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
        this.currentStatistics.maxDrawdown = this.calculateMaxDrawdown(
            this.prevStatistics.maxDrawdown,
            this.currentStatistics.netProfit,
            this.currentStatistics.localMax
        );
        return this;
    }

    private updateMaxDrawdownDate(): StatisticsCalculator {
        this.currentStatistics.maxDrawdownDate = this.calculateMaxDrawdownDate(
            this.prevStatistics.maxDrawdownDate,
            this.newPosition.exitDate
        );
        return this;
    }

    private updatePerformance(): StatisticsCalculator {
        this.currentStatistics.performance = this.calculatePerformance(
            this.prevStatistics.performance,
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
        this.currentStatistics.lastUpdatedAt = dayjs.utc().toISOString();

        return this;
    }

    private validateRating(): StatisticsCalculator {
        this.calculateRating(
            this.currentStatistics.profitFactor,
            this.currentStatistics.payoffRatio,
            this.currentStatistics.recoveryFactor
        );

        return this;
    }

    private updateLastExitDate(): StatisticsCalculator {
        this.currentStatistics.lastPositionExitDate = this.newPosition.exitDate;
        return this;
    }
    //#endregion

    //#region Public methods
    public incrementTradesCount(tradesCount: RobotNumberValue): RobotNumberValue {
        validateArguments(tradesCount.all, tradesCount[this.dir]);

        const newTradesCount = { ...tradesCount };

        newTradesCount.all++;
        newTradesCount[this.dir]++;

        return newTradesCount;
    }

    public calculateRate(
        prevRate: RobotNumberValue,
        currentTradesRated: RobotNumberValue,
        currentTradesCount: RobotNumberValue
    ): RobotNumberValue {
        validateArguments(
            currentTradesRated.all,
            currentTradesRated[this.dir],
            currentTradesCount.all,
            currentTradesCount[this.dir]
        );

        const newRate = { ...prevRate };

        newRate.all = (currentTradesRated.all / currentTradesCount.all) * 100;
        newRate[this.dir] = (currentTradesRated[this.dir] / currentTradesCount[this.dir]) * 100;

        return newRate;
    }

    public calculateAverageBarsHeld(
        prevAvgBars: RobotNumberValue,
        prevTradesCount: RobotNumberValue,
        newTradesCount: RobotNumberValue,
        newBars: number
    ): RobotNumberValue {
        validateArguments(
            prevTradesCount.all,
            prevTradesCount[this.dir],
            newTradesCount.all,
            newTradesCount[this.dir],
            newBars
        );

        const newAvgBars = { ...prevAvgBars };

        const prevBarsAll = prevAvgBars.all * prevTradesCount.all;
        const prevBarsDir = prevAvgBars[this.dir] * prevTradesCount[this.dir];

        newAvgBars.all = (prevBarsAll + newBars) / newTradesCount.all;
        newAvgBars[this.dir] = (prevBarsDir + newBars) / newTradesCount[this.dir];

        return newAvgBars;
    }

    public calculateProfit(prevProfit: RobotNumberValue, profit: number): RobotNumberValue {
        validateArguments(profit);

        const newProfit = { ...prevProfit };

        newProfit.all = prevProfit.all + profit;
        newProfit[this.dir] = prevProfit[this.dir] + profit;

        return newProfit;
    }

    public calculateAverageProfit(
        prevAvgProfit: RobotNumberValue,
        currentProfit: RobotNumberValue,
        currentTradesCount: RobotNumberValue
    ): RobotNumberValue {
        validateArguments(
            currentProfit.all,
            currentProfit[this.dir],
            currentTradesCount.all,
            currentTradesCount[this.dir]
        );

        const newAvgProfit = { ...prevAvgProfit };

        newAvgProfit.all = currentProfit.all / currentTradesCount.all;
        newAvgProfit[this.dir] = currentProfit[this.dir] / currentTradesCount[this.dir];

        return newAvgProfit;
    }

    public calculateRatio(profitStat: RobotNumberValue, lossStat: RobotNumberValue): RobotNumberValue {
        validateArguments(profitStat.all, profitStat[this.dir], lossStat.all, lossStat[this.dir]);

        return new RobotNumberValue(
            Math.abs(profitStat.all / lossStat.all),
            Math.abs(profitStat.long / lossStat.long),
            Math.abs(profitStat.short / lossStat.short)
        );
    }

    public nullifySequence(prevSequence: RobotNumberValue): RobotNumberValue {
        validateArguments(prevSequence.all, prevSequence[this.dir]);

        const newSequence = { ...prevSequence };

        newSequence.all = 0;
        newSequence[this.dir] = 0;

        return newSequence;
    }

    public incrementSequence(prevSequence: RobotNumberValue): RobotNumberValue {
        validateArguments(prevSequence.all, prevSequence[this.dir]);

        const newSequence = { ...prevSequence };

        newSequence.all = prevSequence.all + 1;
        newSequence[this.dir] = prevSequence[this.dir] + 1;

        return newSequence;
    }

    public incrementMaxSequence(prevSequence: RobotNumberValue, maxSequence: RobotNumberValue): RobotNumberValue {
        validateArguments(prevSequence.all, prevSequence[this.dir], maxSequence.all, maxSequence[this.dir]);

        const newMax = { ...maxSequence };

        newMax.all = Math.max(maxSequence.all, prevSequence.all + 1);
        newMax[this.dir] = Math.max(maxSequence[this.dir], prevSequence[this.dir] + 1);

        return newMax;
    }

    public calculateMaxDrawdown(
        prevDrawdown: RobotNumberValue,
        netProfit: RobotNumberValue,
        localMax: RobotNumberValue
    ): RobotNumberValue {
        validateArguments(netProfit.all, netProfit[this.dir], localMax);

        const currentDrawdownAll = netProfit.all - localMax.all;
        const currentDrawdownDir = netProfit[this.dir] - localMax[this.dir];

        const newDrawdown = { ...prevDrawdown };

        newDrawdown.all = currentDrawdownAll > prevDrawdown.all ? 0 : currentDrawdownAll;
        newDrawdown[this.dir] = currentDrawdownDir > prevDrawdown[this.dir] ? 0 : currentDrawdownDir;

        return newDrawdown;
    }

    public calculateMaxDrawdownDate(prevDate: RobotStringValue, exitDate: string): RobotStringValue {
        validateArguments(exitDate);

        const newDate = { ...prevDate };

        newDate.all = exitDate;
        newDate[this.dir] = exitDate;

        return newDate;
    }

    public calculatePerformance(prevPerformance: PerformanceVals, profit: number, exitDate: string): PerformanceVals {
        validateArguments(profit, exitDate);

        const newPerformance = [...prevPerformance];
        const prevSum = prevPerformance.length > 0 ? prevPerformance[prevPerformance.length - 1].y : 0;

        newPerformance.push({ x: dayjs.utc(exitDate).valueOf(), y: round(prevSum + profit, 2) });

        return newPerformance;
    }

    public calculateRecoveryFactor(
        prevFactor: RobotNumberValue,
        netProfit: RobotNumberValue,
        maxDrawdown: RobotNumberValue
    ): RobotNumberValue {
        validateArguments(netProfit, maxDrawdown);

        const newFactor = { ...prevFactor };

        newFactor.all = (netProfit.all / maxDrawdown.all) * -1;
        newFactor[this.dir] = (netProfit[this.dir] / maxDrawdown[this.dir]) * -1;

        return newFactor;
    }

    public calculateLocalMax(prevMax: RobotNumberValue, netProfit: RobotNumberValue) {
        validateArguments(prevMax.all, prevMax[this.dir], netProfit);

        const newMax = { ...prevMax };

        newMax.all = Math.max(prevMax.all, netProfit.all);
        newMax[this.dir] = Math.max(prevMax[this.dir], netProfit[this.dir]);

        return newMax;
    }

    public calculateRating(
        profitFactor: RobotNumberValue,
        payoffRatio: RobotNumberValue,
        recoveryFactor: RobotNumberValue,
        profitFactorWeight = 0.35,
        recoveryFactorWeight = 0.25,
        payoffRatioWeight = 0.4
    ): RobotNumberValue {
        validateArguments(
            profitFactor.all,
            profitFactor.long,
            profitFactor.short,
            payoffRatio.all,
            payoffRatio.long,
            payoffRatio.short,
            recoveryFactor.all
        );

        if (!isFinite(profitFactorWeight) || !isFinite(recoveryFactorWeight) || !isFinite(payoffRatioWeight))
            throw new Error("Arguments must be finite numbers");

        if (Math.abs(profitFactorWeight + recoveryFactorWeight + payoffRatioWeight - 1) > Number.EPSILON)
            throw new Error("Sum of weights must be equal to 1");

        return new RobotNumberValue(
            (profitFactorWeight * (profitFactor.all + profitFactor.long + profitFactor.short)) / 3 +
                (payoffRatioWeight * (payoffRatio.all + payoffRatio.long + payoffRatio.short)) / 3 +
                recoveryFactorWeight * recoveryFactor.all // check calculateRecoveryFactor method
        );
    }
    //#endregion
}
