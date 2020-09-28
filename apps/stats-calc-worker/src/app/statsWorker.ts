import { expose } from "threads/worker";
import { calcStatistics, TradeStats } from "@cryptuoso/stats-calc";
import { BasePosition } from "@cryptuoso/market";

const statisticUtils = {
    calcStatistics(prevStats: TradeStats, positions: BasePosition[]) {
        return calcStatistics(prevStats, positions);
    }
};

export type StatisticsUtils = typeof statisticUtils;

expose(statisticUtils);
