import { expose } from "threads/worker";
import {
    calcStatistics,
    ExtendedStatsPosition,
    ExtendedStatsPositionWithVolume,
    SettingsVolume,
    TradeStats,
    //PositionDataForStats,
    PositionDirection
} from "@cryptuoso/trade-statistics";
import { round } from "@cryptuoso/helpers";
import { StatisticsType } from "./statsWorkerTypes";

const getVolume = (pos: ExtendedStatsPosition, volumes: SettingsVolume[]) =>
    (volumes.find((el) => pos.entryDate >= el.activeFrom) || { volume: null }).volume;

/* function prepareRobot(positions: PositionDataForStats[]) {
    return positions.map((pos) => ({
        ...pos,
        profit: pos.fee && +pos.fee > 0 ? +round(pos.profit - pos.profit * pos.fee, 6) : pos.profit
    }));
} */

function prepareSignalByPositionsVolume(positions: ExtendedStatsPositionWithVolume[]) {
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

function prepareSignalByItsVolumes(positions: ExtendedStatsPosition[], volumes: SettingsVolume[]) {
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
    calcStatistics(type: StatisticsType, prevStats: TradeStats, positions: any[], volumes?: SettingsVolume[]) {
        if (type == StatisticsType.CalcByPositionsVolume) positions = prepareSignalByPositionsVolume(positions);
        else if (type == StatisticsType.CalcByProvidedVolumes)
            positions = prepareSignalByItsVolumes(positions, volumes);
        else if (type != StatisticsType.Simple) throw new Error("Unknow calculation type");

        return calcStatistics(prevStats, positions);
    }
};

expose(statisticUtils);
