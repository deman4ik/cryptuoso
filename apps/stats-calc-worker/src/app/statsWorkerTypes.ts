import {
    RobotStats,
    PositionDataForStats
} from "@cryptuoso/trade-statistics";
import {
    ExtendedStatsPosition,
    ExtendedStatsPositionWithVolume,
    SettingsVolume
} from "@cryptuoso/user-state";

export enum StatisticsType {
    CalcByPositionsVolume = "calcByPositionsVolume",
    CalcByProvidedVolumes = "calcByProvidedVolumes"
}

export type CalcStatistics = {
    (
        prevStats: RobotStats,
        positions: PositionDataForStats[]
    ): RobotStats | Promise<RobotStats>;
    (
        prevStats: RobotStats,
        positions: ExtendedStatsPositionWithVolume[],
        type: StatisticsType.CalcByPositionsVolume
    ): RobotStats | Promise<RobotStats>;
    (
        prevStats: RobotStats,
        positions: ExtendedStatsPosition[],
        type: StatisticsType.CalcByProvidedVolumes,
        volumes: SettingsVolume[]
    ): RobotStats | Promise<RobotStats>;
};

export type StatisticUtils = {
    calcStatistics: CalcStatistics
};
