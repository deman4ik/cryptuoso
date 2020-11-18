import { BasePosition } from "@cryptuoso/market";
import { TradeStats } from "./types";
import StatisticsCalculator from "./statistics-calculator";

export { checkTradeStats } from "./statistics-calculator";

// It is now expected that every value is rounded after each cumulative calculatuion
export function calcStatistics(previousRobotStatistics: TradeStats, positions: BasePosition[]): TradeStats {
    if (!positions || positions.length < 1) return previousRobotStatistics;

    return new StatisticsCalculator(previousRobotStatistics, positions).getStats();
}
