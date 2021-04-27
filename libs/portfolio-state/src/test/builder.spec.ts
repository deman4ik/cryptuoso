import positions from "./data/positions";
import { PortfolioBuilder } from "../lib/builder";
import { PortfolioState } from "../lib/types";
import util from "util";
import fs from "fs";
import combinate from "combinate";

const portfolio: PortfolioState = {
    id: "testId",
    code: "testCode",
    exchange: "binance_futures",
    available: 5,
    settings: {
        options: {
            diversification: true,
            profit: true,
            risk: true,
            moneyManagement: true,
            winRate: true,
            efficiency: true
        },
        minBalance: 0,
        initialBalance: 0,
        feeRate: 0.01,
        minTradeAmount: 65
    }
};

describe("Test portfolio state", () => {
    describe("Test Portfolio Build", () => {
        it("Should init", async () => {
            const portfolioBuilder = new PortfolioBuilder(portfolio, positions);

            expect(Object.keys(portfolioBuilder.robots).length).toBe(55);
        });
        it("Should calculate robots stats", async () => {
            const portfolioBuilder = new PortfolioBuilder(portfolio, positions);
            portfolioBuilder.calculateRobotsStats();
            expect(portfolioBuilder.robots[positions[0].robotId].stats.fullStats).toBeDefined();
        });
        it("Should sort robots", async () => {
            const portfolioBuilder = new PortfolioBuilder(portfolio, positions);
            portfolioBuilder.calculateRobotsStats();
            portfolioBuilder.sortRobots();
            expect(portfolioBuilder.sortedRobotsList.length).toBe(55);
        });
        it("Should calc amounts", async () => {
            const portfolioBuilder = new PortfolioBuilder(portfolio, positions);
            portfolioBuilder.calculateRobotsStats();
            portfolioBuilder.sortRobots();
            const result = portfolioBuilder.calcAmounts(portfolioBuilder.sortedRobotsList);
            fs.writeFileSync(
                "./testResults/amounts.json",
                JSON.stringify(
                    result.robots.map((r) => ({
                        robotId: r.robotId,
                        amountInCurrency: r.amountInCurrency,
                        share: r.share
                    }))
                )
            );
            expect(result).toBeDefined();
        });
        it("Should calc portfolio", async () => {
            const portfolioBuilder = new PortfolioBuilder(portfolio, positions);
            portfolioBuilder.calculateRobotsStats();
            portfolioBuilder.sortRobots();
            const result = portfolioBuilder.calcPortfolio([
                portfolioBuilder.sortedRobotsList[0],
                portfolioBuilder.sortedRobotsList[1]
            ]);
            expect(result).toBeDefined();
        });
        it("Should comparePortfolios", async () => {
            const portfolioBuilder = new PortfolioBuilder(portfolio, positions);
            portfolioBuilder.calculateRobotsStats();
            portfolioBuilder.sortRobots();
            const prevPortfolio = portfolioBuilder.calcPortfolio([portfolioBuilder.sortedRobotsList[0]]);
            const currentPortfolio = portfolioBuilder.calcPortfolio([
                portfolioBuilder.sortedRobotsList[0],
                portfolioBuilder.sortedRobotsList[1]
            ]);
            const result = portfolioBuilder.comparePortfolios(prevPortfolio, currentPortfolio);
            expect(result.approve).toBe(false);
        });
        it("Should build new portfolio", async () => {
            const portfolioBuilder = new PortfolioBuilder(portfolio, positions);
            const result = await portfolioBuilder.build();

            fs.writeFileSync("./testResults/pf.json", JSON.stringify(result));
            // console.log(util.inspect(result.steps, false, null, true));
        });
    });
});
