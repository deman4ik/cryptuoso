import { expose } from "threads/worker";
import { calcStatistics, TradeStats } from "@cryptuoso/stats-calc";
import { round } from "@cryptuoso/helpers";
import { StatisticsType, Volumes } from "./statsWorkerTypes";
import { BasePosition, PositionDirection } from "@cryptuoso/market";

const getVolume = (pos: BasePosition, volumes: Volumes) =>
    (volumes.find((el) => pos.entryDate >= el.activeFrom) || { volume: null }).volume;

/* function calcSimpleProfit(positions: PositionDataForStats[]) {
    return positions.map((pos) => ({
        ...pos,
        profit: pos.fee && +pos.fee > 0 ? +round(pos.profit - pos.profit * pos.fee, 6) : pos.profit
    }));
} */

function calcProfitByPositionsVolume(positions: BasePosition[]) {
    return positions.map((pos) => {
        let profit = 0;
        if (pos.direction === PositionDirection.long) {
            profit = +round((pos.exitPrice - pos.entryPrice) * pos.volume, 6);
        } else {
            profit = +round((pos.entryPrice - pos.exitPrice) * pos.volume, 6);
        }
        profit = pos.fee && +pos.fee > 0 ? +round(profit - profit * pos.fee, 6) : profit;
        return {
            ...pos,
            volume: pos.volume,
            profit
        };
    });
}

function calcProfitByProvidedVolumes(positions: BasePosition[], volumes: Volumes) {
    return positions.map((pos) => {
        const signalVolume = getVolume(pos, volumes);
        let profit = 0;
        if (pos.direction === PositionDirection.long) {
            profit = +round((pos.exitPrice - pos.entryPrice) * signalVolume, 6);
        } else {
            profit = +round((pos.entryPrice - pos.exitPrice) * signalVolume, 6);
        }
        profit = pos.fee && +pos.fee > 0 ? +round(profit - profit * pos.fee, 6) : profit;
        return {
            ...pos,
            volume: signalVolume,
            profit
        };
    });
}

const statisticUtils = {
    calcStatistics(type: StatisticsType, prevStats: TradeStats, positions: any[], volumes?: Volumes) {
        if (type == StatisticsType.CalcByPositionsVolume) positions = calcProfitByPositionsVolume(positions);
        else if (type == StatisticsType.CalcByProvidedVolumes)
            positions = calcProfitByProvidedVolumes(positions, volumes);
        else if (type != StatisticsType.Simple) throw new Error("Unknow calculation type");

        return calcStatistics(prevStats, positions);
    }
};

expose(statisticUtils);
