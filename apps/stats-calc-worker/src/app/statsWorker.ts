import { expose } from "threads/worker";
import { calcStatisticsCumulatively, RobotStats, PositionDataForStats } from "@cryptuoso/trade-statistics";

const statisticUtils = {
    calcStatistics(prevStats: RobotStats, positions: PositionDataForStats[]) {
        return calcStatisticsCumulatively(prevStats, positions);
    }
};

export type StatisticUtils = typeof statisticUtils;

expose(statisticUtils);