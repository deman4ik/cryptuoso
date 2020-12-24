import { BasePosition } from "@cryptuoso/market";
import { TradeStats } from "./types";
import StatisticsCalculator from "./statistics-calculator";

export { checkTradeStats } from "./statistics-calculator";

// It is now expected that every value is rounded after each cumulative calculatuion
export async function calcStatistics(
    previousRobotStatistics: TradeStats,
    positions: BasePosition[]
): Promise<TradeStats> {
    if (!positions || positions.length < 1) return previousRobotStatistics;

    const calculator = new StatisticsCalculator(previousRobotStatistics, positions);
    const result = await calculator.getStats();
    return result;
}
