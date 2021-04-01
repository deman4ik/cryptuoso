import { TradeStatsCalc } from "../lib/trade-stats";
import { positions } from "./data/positions";
import { result } from "./data/results";
import util from "util";
import fs from "fs";

describe("Test 'trade-stats'", () => {
    describe("Test calc with no previous statistics", () => {
        it("Should  calculate statistics", async () => {
            const tradeStatsCalculator = new TradeStatsCalc(positions, {
                type: "robot"
            });
            const stats = tradeStatsCalculator.calculate();

            expect(stats).toEqual(result);
            // console.log(util.inspect(stats.periodStats.month, false, null, true));
            // let data = JSON.stringify(stats);
            //fs.writeFileSync("stats.json", data);
        });
    });
});
