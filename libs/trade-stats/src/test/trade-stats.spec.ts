import { TradeStatsCalc } from "../lib/trade-stats";
import { positions } from "./data/positions";
import { robotStatsResult, portfolioStatsResult } from "./data/results";
//import util from "util";
//import fs from "fs";
import dayjs from "@cryptuoso/dayjs";
import { TradeStats } from "../lib/types";

describe("Test 'trade-stats'", () => {
    describe("Test calc with no previous statistics", () => {
        it("Should calculate robot statistics", async () => {
            const tradeStatsCalculator = new TradeStatsCalc(positions, {
                job: { robotId: "test", type: "robot", recalc: true, SMAWindow: 10 },
                initialBalance: 100000
            });
            const stats = await tradeStatsCalculator.calculate();
            //  const data = JSON.stringify(stats);
            //  fs.writeFileSync("testResults/robotStatsResults.json", data);
            expect(stats.fullStats).toEqual(robotStatsResult.fullStats);
            expect(stats.periodStats).toEqual(robotStatsResult.periodStats);
        });
        it("Should calculate portfolio statistics", async () => {
            const tradeStatsCalculator = new TradeStatsCalc(
                positions.map((pos) => ({ ...pos, meta: { portfolioShare: 100 } })),
                {
                    job: { portfolioId: "test", type: "portfolio", recalc: true },
                    initialBalance: 100000
                }
            );
            const stats = await tradeStatsCalculator.calculate();
            // const data = JSON.stringify(stats);
            // fs.writeFileSync("testResults/portfolioStatsResults.json", data);
            expect(stats.fullStats).toEqual(portfolioStatsResult.fullStats);
            expect(stats.periodStats).toEqual(portfolioStatsResult.periodStats);
        });
    });

    describe("Test calc with with previous statistics", () => {
        it("Should calculate statistics", async () => {
            const prevTradeStatsCalculator = new TradeStatsCalc(
                positions.filter(
                    ({ exitDate }) => dayjs.utc(exitDate).valueOf() < dayjs.utc("2021-03-16T00:00:58.425").valueOf()
                ),
                {
                    job: { robotId: "test", type: "robot", recalc: false, round: false },
                    initialBalance: 1000
                }
            );
            const prevStats = await prevTradeStatsCalculator.calculate();

            const prevPeriodStats: TradeStats["periodStats"] = {
                year: {},
                quarter: {},
                month: {}
            };

            const time = dayjs.utc("2021-03-16T00:00:58.425").valueOf();
            for (const [key, value] of Object.entries(prevStats.periodStats.year)) {
                if (dayjs.utc(value.dateFrom).valueOf() <= time && dayjs.utc(value.dateTo).valueOf() >= time)
                    prevPeriodStats.year[key] = value;
            }

            for (const [key, value] of Object.entries(prevStats.periodStats.quarter)) {
                if (dayjs.utc(value.dateFrom).valueOf() <= time && dayjs.utc(value.dateTo).valueOf() >= time)
                    prevPeriodStats.quarter[key] = value;
            }

            for (const [key, value] of Object.entries(prevStats.periodStats.month)) {
                if (dayjs.utc(value.dateFrom).valueOf() <= time && dayjs.utc(value.dateTo).valueOf() >= time)
                    prevPeriodStats.month[key] = value;
            }

            const tradeStatsCalculator = new TradeStatsCalc(
                positions.filter(({ exitDate }) => dayjs.utc(exitDate).valueOf() >= time),
                {
                    job: { robotId: "test", type: "robot", recalc: false, round: false },
                    initialBalance: 1000
                },
                {
                    fullStats: prevStats.fullStats,
                    periodStats: prevPeriodStats
                }
            );
            const stats = await tradeStatsCalculator.calculate();

            const tradeStatsCalculatorAll = new TradeStatsCalc(positions, {
                job: { robotId: "test", type: "robot", recalc: true, round: false },
                initialBalance: 1000
            });
            const statsAll = await tradeStatsCalculatorAll.calculate();
            expect(stats.fullStats).toEqual(statsAll.fullStats);

            expect(stats.periodStats.year["2021"]).toEqual(statsAll.periodStats.year["2021"]);
            expect(stats.periodStats.quarter["2021.1"]).toEqual(statsAll.periodStats.quarter["2021.1"]);
            expect(stats.periodStats.month["2021.3"]).toEqual(statsAll.periodStats.month["2021.3"]);
        });
    });
});
