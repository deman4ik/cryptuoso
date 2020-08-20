import { expose } from "threads/worker";
import { round } from "@cryptuoso/helpers";
import { calcStatisticsCumulatively, CommonStats, PositionDataForStats } from "@cryptuoso/trade-statistics";

const statisticUtils = {
    calcStatistics(prevStats: CommonStats, positions: PositionDataForStats[]) {
        return calcStatisticsCumulatively(
            prevStats,
            positions.map((pos) => ({
                ...pos,
                profit: pos.fee && +pos.fee > 0 ? +round(pos.profit - pos.profit * pos.fee, 6) : pos.profit
            }))
        );
    }
};

export type StatisticUtils = typeof statisticUtils;
 
expose(statisticUtils);