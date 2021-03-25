import { TradeStatsCalc } from "../lib/trade-stats";
import { positions } from "./data/positions";

describe("Test 'trade-stats'", () => {
    // Refactored to automatically round every value
    describe("Test calc with no previous statistics", () => {
        it("Should  calculate statistics", async () => {
            const tradeStatsCalculator = new TradeStatsCalc(positions, {
                type: "robotsAggr"
            });
            const stats = tradeStatsCalculator.calculate();
            //console.log(stats.fullStats);
            console.log(stats.periodStats.year["2021"]);
        });
    });
});
