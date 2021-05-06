import { TradeStatsCalc } from "../lib/trade-stats";
import { positions } from "./data/positions";
import { result } from "./data/results";
import util from "util";
import fs from "fs";
import dayjs from "@cryptuoso/dayjs";

describe("Test 'trade-stats'", () => {
    describe("Test calc with no previous statistics", () => {
        it("Should calculate statistics", async () => {
            const tradeStatsCalculator = new TradeStatsCalc(positions, {
                job: { robotId: "test", type: "robot", recalc: true, SMAWindow: 10 },
                initialBalance: 100000
            });
            const stats = tradeStatsCalculator.calculate();
            const { sharpeRatio } = stats.fullStats;
            /*  console.log(
                Object.values(stats.periodStats.month).map(({ dateFrom, stats }) => ({
                    dateFrom,
                    percentNetProfit: stats.percentNetProfit,
                    netProfit: stats.netProfit
                }))
            ); */
            console.log({
                sharpeRatio
            });
            // expect(stats.fullStats).toEqual(result.fullStats);
            // console.log(util.inspect(stats.periodStats.month, false, null, true));
            //  const data = JSON.stringify(stats);
            // fs.writeFileSync("stats.json", data);
            //
            // fs.writeFileSync("positions.json", JSON.stringify(positions));
        });
    });

    describe("Test calc with with previous statistics", () => {
        it("Should  calculate statistics", async () => {
            const prevTradeStatsCalculator = new TradeStatsCalc(
                positions.filter(
                    ({ exitDate }) => dayjs.utc(exitDate).valueOf() < dayjs.utc("2021-03-16T00:00:58.425").valueOf()
                ),
                {
                    job: { robotId: "test", type: "robot", recalc: false, round: false },
                    initialBalance: 1000
                }
            );
            const prevStats = prevTradeStatsCalculator.calculate();

            //  console.log(prevStats.fullStats);

            const tradeStatsCalculator = new TradeStatsCalc(
                positions.filter(
                    ({ exitDate }) => dayjs.utc(exitDate).valueOf() >= dayjs.utc("2021-03-16T00:00:58.425").valueOf()
                ),
                {
                    job: { robotId: "test", type: "robot", recalc: false, round: false },
                    initialBalance: 1000
                },
                prevStats
            );
            const stats = tradeStatsCalculator.calculate();

            const tradeStatsCalculatorAll = new TradeStatsCalc(positions, {
                job: { robotId: "test", type: "robot", recalc: true, round: false },
                initialBalance: 1000
            });
            const statsAll = tradeStatsCalculatorAll.calculate();

            expect(stats).toEqual(statsAll);
            const { netProfitsSMA, netProfitSMA, netProfit, emulateNextPosition } = statsAll.fullStats;
            console.log({
                netProfitsSMA,
                netProfitSMA,
                netProfit,
                emulateNextPosition
            });
            //  console.log(stats.fullStats);
            // expect(stats.fullStats).toEqual(result.fullStats);
            // console.log(util.inspect(stats.periodStats.month, false, null, true));
            //  const data = JSON.stringify(stats);
            //  fs.writeFileSync("stats.json", data);

            // fs.writeFileSync("positions.json", JSON.stringify(positions));
        });
    });
});
