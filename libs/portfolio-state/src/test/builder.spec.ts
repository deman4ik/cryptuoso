import positions from "./data/positions";
import { PortfolioBuilder } from "../lib/builder";
import { PortfolioState } from "../lib/types";

const portfolio: PortfolioState = {
    id: "testId",
    code: "testCode",
    exchange: "binance_futures",
    available: 5,
    settings: {
        options: {
            diversification: false,
            profit: true,
            risk: true,
            moneyManagement: true,
            winRate: true,
            efficiency: true
        },
        minBalance: 0,
        initialBalance: 1000
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
        it("Should approvePortfolio", async () => {
            const portfolioBuilder = new PortfolioBuilder(portfolio, positions);
            portfolioBuilder.calculateRobotsStats();
            portfolioBuilder.sortRobots();
            const prevPortfolio = portfolioBuilder.calcPortfolio([portfolioBuilder.sortedRobotsList[0]]);
            const currentPortfolio = portfolioBuilder.calcPortfolio([
                portfolioBuilder.sortedRobotsList[0],
                portfolioBuilder.sortedRobotsList[1]
            ]);
            const result = portfolioBuilder.approvePortfolio(prevPortfolio, currentPortfolio);
            console.log(result);
        });
    });
});
