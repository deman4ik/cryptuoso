import positions from "./data/positions";
import { PortfolioBuilder } from "../lib/builder";
import { PortfolioState } from "../lib/types";
import { amounts } from "./data/amountsResults";
import { portfolioResult } from "./data/portfolioResult";
//import util from "util";
//import fs from "fs";

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
        tradingAmountType: "balancePercent",
        balancePercent: 100,
        initialBalance: 100000,
        leverage: 3
    },
    context: {
        minTradeAmount: 65,
        feeRate: 0.01,
        currentBalance: 100000
    },
    base: true
};

describe("Test portfolio state", () => {
    describe("Test Portfolio Build", () => {
        it("Should init", async () => {
            const portfolioBuilder = new PortfolioBuilder(portfolio);
            portfolioBuilder.init(positions);

            expect(Object.keys(portfolioBuilder.robots).length).toBe(55);
        });
        it("Should calculate robots stats", async () => {
            const portfolioBuilder = new PortfolioBuilder(portfolio);
            portfolioBuilder.init(positions);
            await portfolioBuilder.calculateRobotsStats();
            expect(portfolioBuilder.robots[positions[0].robotId].stats.fullStats).toBeDefined();
        });
        it("Should sort robots", async () => {
            const portfolioBuilder = new PortfolioBuilder(portfolio);
            portfolioBuilder.init(positions);
            await portfolioBuilder.calculateRobotsStats();
            const sortedRobotsList = await portfolioBuilder.sortRobots(portfolioBuilder.robots);
            expect(sortedRobotsList.length).toBe(55);
        });
        it("Should calc amounts", async () => {
            const portfolioBuilder = new PortfolioBuilder(portfolio);
            portfolioBuilder.init(positions);
            await portfolioBuilder.calculateRobotsStats();
            const sortedRobotsList = await portfolioBuilder.sortRobots(portfolioBuilder.robots);
            const result = await portfolioBuilder.calcAmounts(sortedRobotsList);
            expect(
                Object.values(result.robots).map((r) => ({
                    robotId: r.robotId,
                    amountInCurrency: r.amountInCurrency,
                    share: r.share
                }))
            ).toEqual(amounts);
        });
        it("Should calc portfolio", async () => {
            const portfolioBuilder = new PortfolioBuilder(portfolio);
            portfolioBuilder.init(positions);
            await portfolioBuilder.calculateRobotsStats();
            const sortedRobotsList = await portfolioBuilder.sortRobots(portfolioBuilder.robots);
            const result = portfolioBuilder.calcPortfolio([sortedRobotsList[0], sortedRobotsList[1]]);
            expect(result).toBeDefined();
        });
        it("Should compare portfolios", async () => {
            const portfolioBuilder = new PortfolioBuilder(portfolio);
            portfolioBuilder.init(positions);
            await portfolioBuilder.calculateRobotsStats();
            const sortedRobotsList = await portfolioBuilder.sortRobots(portfolioBuilder.robots);
            const prevPortfolio = await portfolioBuilder.calcPortfolio([sortedRobotsList[0]]);
            const currentPortfolio = await portfolioBuilder.calcPortfolio([sortedRobotsList[0], sortedRobotsList[1]]);
            const result = await portfolioBuilder.comparePortfolios(prevPortfolio, currentPortfolio);
            expect(result.approve).toBe(false);
        });
        it("Should build new portfolio", async () => {
            const portfolioBuilder = new PortfolioBuilder(portfolio);
            portfolioBuilder.init(positions);
            const result = await portfolioBuilder.build();
            expect(result).toBeDefined();
            //  expect(result).toEqual(portfolioResult);
        });
        it("Should build new portfolio with 30 robots", async () => {
            const portfolioBuilder = new PortfolioBuilder({
                ...portfolio,
                settings: { ...portfolio.settings, maxRobotsCount: 30 }
            });
            portfolioBuilder.init(positions);
            const result = await portfolioBuilder.build();
            expect(result.portfolio.robots.length).toBe(30);
        });
        it("Should build new portfolio with 5 robots", async () => {
            const portfolioBuilder = new PortfolioBuilder({
                ...portfolio,
                settings: { ...portfolio.settings, initialBalance: 325 }
            });
            portfolioBuilder.init(positions);
            const result = await portfolioBuilder.build();
            expect(result.portfolio.robots.length).toBe(5);
        });
        it("Should build new portfolio with 6 robots", async () => {
            const portfolioBuilder = new PortfolioBuilder({
                ...portfolio,
                settings: { ...portfolio.settings, initialBalance: 390, maxRobotsCount: 6, minRobotsCount: 6 }
            });
            portfolioBuilder.init(positions);
            const result = await portfolioBuilder.build();
            expect(result.portfolio.robots.length).toBe(6);
        });
        it("Should throw Error (Portfolio balance is insufficient) with wrong min robots count", async () => {
            try {
                new PortfolioBuilder({
                    ...portfolio,
                    settings: { ...portfolio.settings, initialBalance: 325, maxRobotsCount: 6, minRobotsCount: 6 }
                });
            } catch (e) {
                expect(e.message).toBe("Portfolio balance is insufficient");
            }
        });
        it("Should throw Error (Portfolio balance is insufficient) with low initital balance", async () => {
            try {
                new PortfolioBuilder({ ...portfolio, settings: { ...portfolio.settings, initialBalance: 324 } });
            } catch (e) {
                expect(e.message).toBe("Portfolio balance is insufficient");
            }
        });
    });
});
