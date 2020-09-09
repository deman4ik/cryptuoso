import { expose } from "threads/worker";
import {
    calcStatisticsCumulatively,
    RobotStats,
    PositionDataForStats,
    PositionDirection
} from "@cryptuoso/trade-statistics";
import {
    ExtendedStatsPosition,
    ExtendedStatsPositionWithVolume,
    SettingsVolume
} from "@cryptuoso/user-state";
import { round } from "@cryptuoso/helpers";
import { StatisticsType } from "./statsWorkerTypes";

const getVolume = (pos: ExtendedStatsPosition, volumes: SettingsVolume[]) =>
    volumes.find((el) => pos.entryDate >= el.activeFrom).volume;

function prepareRobot(positions: PositionDataForStats[]) {
    return positions.map((pos) => ({
        ...pos,
        profit: pos.fee && +pos.fee > 0 ? +round(pos.profit - pos.profit * pos.fee, 6) : pos.profit
    }));
}

function prepareSignalByPositionsVolume(positions: ExtendedStatsPositionWithVolume[]) {
    return positions.map((pos) => {
        let profit = 0;
        if (pos.direction === PositionDirection.long) {
            profit = +round((pos.exitPrice - pos.entryPrice) * pos.userSignalVolume, 6);
        } else {
            profit = +round((pos.entryPrice - pos.exitPrice) * pos.userSignalVolume, 6);
        }
        profit = pos.fee && +pos.fee > 0 ? +round(profit - profit * pos.fee, 6) : profit;
        return {
            ...pos,
            volume: pos.userSignalVolume,
            profit
        };
    });
}

function prepareSignalByItsVolumes(positions: ExtendedStatsPosition[], volumes: SettingsVolume[]) {
    return positions.map((pos) => {
        const userSignalVolume = getVolume(pos, volumes);
        let profit = 0;
        if (pos.direction === PositionDirection.long) {
            profit = +round((pos.exitPrice - pos.entryPrice) * userSignalVolume, 6);
        } else {
            profit = +round((pos.entryPrice - pos.exitPrice) * userSignalVolume, 6);
        }
        profit = pos.fee && +pos.fee > 0 ? +round(profit - profit * pos.fee, 6) : profit;
        return {
            ...pos,
            volume: userSignalVolume,
            profit
        };
    });
}

const statisticUtils = {
    calcStatistics(
        prevStats: RobotStats,
        positions: any[],
        type?: StatisticsType,
        volumes?: SettingsVolume[]
    ) {
        /* if (type == StatisticsType.Robot) positions = prepareRobot(positions);
        else  */if (type == StatisticsType.CalcByPositionsVolume) positions = prepareSignalByPositionsVolume(positions);
        else if (type == StatisticsType.CalcByProvidedVolumes) positions = prepareSignalByItsVolumes(positions, volumes);

        return calcStatisticsCumulatively(prevStats, positions);
    }
};

expose(statisticUtils);
