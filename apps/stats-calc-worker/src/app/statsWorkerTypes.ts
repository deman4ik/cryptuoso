import {
    TradeStats,
    PositionDataForStats,
    ExtendedStatsPosition,
    ExtendedStatsPositionWithVolume,
    SettingsVolume
} from "@cryptuoso/trade-statistics";

export enum StatisticsType {
    Simple = "simple",
    CalcByPositionsVolume = "calcByPositionsVolume",
    CalcByProvidedVolumes = "calcByProvidedVolumes"
}

export type CalcStatistics = {
    (type: StatisticsType.Simple, prevStats: TradeStats, positions: PositionDataForStats[]):
        | TradeStats
        | Promise<TradeStats>;
    (type: StatisticsType.CalcByPositionsVolume, prevStats: TradeStats, positions: ExtendedStatsPositionWithVolume[]):
        | TradeStats
        | Promise<TradeStats>;
    /**
     * @param volumes - must be sorted in ascending order
     */
    (
        type: StatisticsType.CalcByProvidedVolumes,
        prevStats: TradeStats,
        positions: ExtendedStatsPosition[],
        volumes: SettingsVolume[]
    ): TradeStats | Promise<TradeStats>;
};

export type StatisticsUtils = {
    calcStatistics: CalcStatistics;
};
