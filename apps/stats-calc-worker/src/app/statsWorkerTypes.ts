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
    Simple = "simple",
    CalcByPositionsVolume = "calcByPositionsVolume",
    CalcByProvidedVolumes = "calcByProvidedVolumes"
}

export type CalcStatistics = {
    (
        type: StatisticsType.Simple,
        prevStats: RobotStats,
        positions: PositionDataForStats[]
    ): RobotStats | Promise<RobotStats>;
    (
        type: StatisticsType.CalcByPositionsVolume,
        prevStats: RobotStats,
        positions: ExtendedStatsPositionWithVolume[]
    ): RobotStats | Promise<RobotStats>;
    (
        type: StatisticsType.CalcByProvidedVolumes,
        prevStats: RobotStats,
        positions: ExtendedStatsPosition[],
        volumes: SettingsVolume[]
    ): RobotStats | Promise<RobotStats>;
};

export type StatisticUtils = {
    calcStatistics: CalcStatistics
};
