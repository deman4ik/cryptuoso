import { BasePosition } from "@cryptuoso/market";
import { TradeStats } from "@cryptuoso/stats-calc";

export enum StatisticsType {
    Simple = "simple",
    CalcByPositionsVolume = "calcByPositionsVolume",
    CalcByProvidedVolumes = "calcByProvidedVolumes"
}

export interface Volume {
    activeFrom: string;
    volume: number;
}

export type Volumes = Volume[];

export type CalcStatistics = {
    (type: StatisticsType.Simple, prevStats: TradeStats, positions: BasePosition[]): TradeStats | Promise<TradeStats>;
    (type: StatisticsType.CalcByPositionsVolume, prevStats: TradeStats, positions: BasePosition[]):
        | TradeStats
        | Promise<TradeStats>;
    /**
     * @param volumes - must be sorted in ascending order
     */
    (type: StatisticsType.CalcByProvidedVolumes, prevStats: TradeStats, positions: BasePosition[], volumes: Volumes):
        | TradeStats
        | Promise<TradeStats>;
};

export type StatisticsUtils = {
    calcStatistics: CalcStatistics;
};
