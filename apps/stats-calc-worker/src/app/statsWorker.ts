import { expose } from "threads/worker";
import { calcStatisticsCumulatively, CommonStats, PositionDataForStats } from "@cryptuoso/trade-statistics";

const statisticUtils = {
    calcStatistics(prevStats: CommonStats, positions: PositionDataForStats[]) {
        return calcStatisticsCumulatively(prevStats, positions);
    }
};

export type StatisticUtils = typeof statisticUtils;

expose(statisticUtils);