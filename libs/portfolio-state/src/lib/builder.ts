import logger, { Logger } from "@cryptuoso/logger";
import { PortfolioOptions, PortfolioRobot, PortfolioState, UserPortfolioState } from "./types";
import { BasePosition, calcPositionProfit } from "@cryptuoso/market";
import { periodStatsToArray, TradeStats, TradeStatsCalc } from "@cryptuoso/trade-stats";
import { getPercentagePos, percentBetween, round, sum, uniqueElementsBy } from "@cryptuoso/helpers";
import Statistics from "statistics.js";
import { getPortfolioBalance, getPortfolioRobotsCount, getPortfolioMinBalance } from "./helpers";

interface PortoflioRobotState extends PortfolioRobot {
    stats?: TradeStats;
    positions: BasePosition[];
}

interface PortfolioCalculated {
    robots: { [key: string]: PortoflioRobotState };
    tradeStats: TradeStats;
    correlationPercent?: number;
}

export class PortfolioBuilder<T extends PortfolioState | UserPortfolioState> {
    #log: Logger;
    portfolio: T;
    optionWeights: { [Weight in keyof PortfolioOptions]: number } = {
        diversification: 1.1,
        profit: 1.1,
        risk: 1.1,
        moneyManagement: 1,
        winRate: 1,
        efficiency: 1.2
    };
    robots: {
        [key: string]: PortoflioRobotState;
    } = {};
    sortedRobotsList: string[] = [];
    currentRobotsList: string[] = [];
    prevPortfolio: PortfolioCalculated;

    currentPortfolio: PortfolioCalculated;

    constructor(portfolio: T, positions: BasePosition[]) {
        this.#log = logger;
        this.portfolio = portfolio;
        this.#calcPortfolioVariables();
        const robotIds = uniqueElementsBy(
            positions.map(({ robotId }) => robotId),
            (a, b) => a === b
        );

        this.robots = robotIds.reduce(
            (prev, cur) => ({
                ...prev,
                [cur]: {
                    robotId: cur,
                    active: false,
                    share: 0,
                    amountInCurrency: 0,
                    positions: positions.filter(({ robotId }) => robotId === cur)
                }
            }),
            {}
        );
    }

    #calcPortfolioVariables = () => {
        const { initialBalance, tradingAmountType, balancePercent, tradingAmountCurrency } = this.portfolio.settings;
        const { minTradeAmount } = this.portfolio.context;
        const portfolioBalance = getPortfolioBalance(
            initialBalance,
            tradingAmountType,
            balancePercent,
            tradingAmountCurrency
        );
        const minBalance = getPortfolioMinBalance(
            portfolioBalance,
            minTradeAmount,
            this.portfolio.settings.minRobotsCount
        );
        let maxRobotsCount = getPortfolioRobotsCount(portfolioBalance, minTradeAmount);
        if (this.portfolio.settings.maxRobotsCount) {
            maxRobotsCount = this.portfolio.settings.maxRobotsCount || maxRobotsCount;
        }

        const minRobotsCount =
            this.portfolio.settings.minRobotsCount || getPortfolioRobotsCount(minBalance, minTradeAmount);

        this.portfolio.variables = {
            portfolioBalance,
            maxRobotsCount,
            minRobotsCount,
            minBalance
        };
    };

    get log() {
        return this.#log;
    }

    calculateRobotsStats() {
        for (const { robotId, positions } of Object.values(this.robots)) {
            const tradeStatsCalc = new TradeStatsCalc(
                positions,
                {
                    job: { type: "robot", robotId, recalc: true },
                    initialBalance: this.portfolio.settings.initialBalance
                },
                null
            );

            this.robots[robotId].stats = tradeStatsCalc.calculate();
        }
    }

    sortRobots() {
        const { diversification, profit, risk, moneyManagement, winRate, efficiency } = this.portfolio.settings.options;
        this.sortedRobotsList = Object.values(this.robots)
            .sort(({ stats: { fullStats: a } }, { stats: { fullStats: b } }) => {
                if (profit && !diversification && !risk && !moneyManagement && !winRate && !efficiency) {
                    if (a.netProfit > b.netProfit) return -1;
                    if (a.netProfit < b.netProfit) return 1;
                }
                if (risk && !diversification && !profit && !moneyManagement && !winRate && !efficiency) {
                    if (a.maxDrawdown > b.maxDrawdown) return 1;
                    if (a.maxDrawdown < b.maxDrawdown) return -1;
                }
                if (moneyManagement && !diversification && !profit && !risk && !winRate && !efficiency) {
                    if (a.payoffRatio > b.payoffRatio) return -1;
                    if (a.payoffRatio < b.payoffRatio) return 1;
                }
                if (winRate && !diversification && !profit && !risk && !moneyManagement && !efficiency) {
                    if (a.winRate > b.winRate) return -1;
                    if (a.winRate < b.winRate) return 1;
                }
                if (efficiency && !diversification && !profit && !moneyManagement && !winRate && !risk) {
                    if (a.sharpeRatio > b.sharpeRatio) return -1;
                    if (a.sharpeRatio < b.sharpeRatio) return 1;
                }
                if (a.recoveryFactor > b.recoveryFactor) return -1;
                if (a.recoveryFactor < b.recoveryFactor) return 1;
                return 0;
            })
            .map(({ robotId }) => robotId);
    }

    calcAmounts(robotIds: string[]) {
        const robots = Object.values(this.robots).filter(({ robotId }) => robotIds.includes(robotId));

        const propСoefficient = 100 / sum(...robots.map((r) => r.stats.fullStats.amountProportion));

        for (const robot of robots) {
            robot.share = robot.stats.fullStats.amountProportion * propСoefficient;
        }

        const minShare = Math.min(...robots.map((r) => r.share));
        this.portfolio.variables.minBalance =
            round((this.portfolio.context.minTradeAmount * 100) / minShare / 100) * 100;

        const leveragedBalance = this.portfolio.variables.portfolioBalance * (this.portfolio.settings.leverage || 1);
        for (const robot of robots) {
            robot.amountInCurrency = (leveragedBalance * robot.share) / 100;
            robot.positions = robot.positions.map((pos) => {
                const volume = robot.amountInCurrency / pos.entryPrice;
                return {
                    ...pos,
                    volume,
                    profit: calcPositionProfit(
                        pos.direction,
                        pos.entryPrice,
                        pos.exitPrice,
                        volume,
                        this.portfolio.context.feeRate
                    ),
                    worstProfit: calcPositionProfit(
                        pos.direction,
                        pos.entryPrice,
                        pos.maxPrice,
                        volume,
                        this.portfolio.context.feeRate
                    )
                };
            });
        }
        return {
            robots
        };
    }

    calcPortfolioStats(robots: PortoflioRobotState[]) {
        const positions = robots.reduce((prev, cur) => [...prev, ...cur.positions], []);
        const tradeStatsCalc = new TradeStatsCalc(
            positions,
            {
                job: { type: "portfolio", portfolioId: this.portfolio.id, recalc: true },
                initialBalance: this.portfolio.settings.initialBalance
            },
            null
        );

        return tradeStatsCalc.calculate();
    }

    calcPortfolio(robotIds: string[]): PortfolioCalculated {
        const { robots } = this.calcAmounts(robotIds);
        const tradeStats = this.calcPortfolioStats(robots);
        const robotsList: {
            [key: string]: PortoflioRobotState;
        } = {};
        for (const robot of robots) {
            robotsList[robot.robotId] = robot;
        }
        return {
            robots: robotsList,
            tradeStats
        };
    }

    comparePortfolios(prevPortfolio: PortfolioCalculated, currentPortfolio: PortfolioCalculated) {
        const { diversification, profit, risk, moneyManagement, winRate, efficiency } = this.portfolio.settings.options;
        const comparison: {
            [Comparison in keyof PortfolioOptions]?: {
                prev: number;
                current: number;
                diff: number;
            };
        } = {};
        let skip = false;
        if (diversification) {
            const prevMonthsNetProfit = Object.values(prevPortfolio.tradeStats.periodStats.month).map(
                (s) => s.stats.percentNetProfit
            );
            const currentMonthsProfit = Object.values(currentPortfolio.tradeStats.periodStats.month).map(
                (s) => s.stats.percentNetProfit
            );

            const arr = prevMonthsNetProfit.map((val, ind) => ({ prev: val, cur: currentMonthsProfit[ind] }));
            const stats = new Statistics(arr, {
                prev: "interval",
                cur: "interval"
            });
            const { correlationCoefficient } = stats.correlationCoefficient("prev", "cur");

            currentPortfolio.correlationPercent = getPercentagePos(1, -1, correlationCoefficient);

            const diff = prevPortfolio.correlationPercent
                ? percentBetween(prevPortfolio.correlationPercent, currentPortfolio.correlationPercent)
                : currentPortfolio.correlationPercent;

            comparison.diversification = {
                prev: prevPortfolio.correlationPercent || 0,
                current: currentPortfolio.correlationPercent,
                diff: diff * this.optionWeights.diversification
            };
        }

        if (profit) {
            const prevNetProfit = prevPortfolio.tradeStats.fullStats.avgPercentNetProfitQuarters;
            const currentNetProfit = currentPortfolio.tradeStats.fullStats.avgPercentNetProfitQuarters;

            if (currentNetProfit < 0) skip = true;

            const diff = percentBetween(prevNetProfit, currentNetProfit);
            comparison.profit = {
                prev: prevNetProfit,
                current: currentNetProfit,
                diff: diff * this.optionWeights.profit
            };
        }

        if (risk) {
            const prevMaxDrawdown = prevPortfolio.tradeStats.fullStats.maxDrawdown;
            const currentMaxDrawdown = currentPortfolio.tradeStats.fullStats.maxDrawdown;

            const diff = percentBetween(prevMaxDrawdown, currentMaxDrawdown);
            comparison.risk = {
                prev: prevMaxDrawdown,
                current: currentMaxDrawdown,
                diff: diff * this.optionWeights.risk
            };
        }

        if (moneyManagement) {
            const prevPayoffRatio = prevPortfolio.tradeStats.fullStats.payoffRatio;
            const currentPayoffRatio = currentPortfolio.tradeStats.fullStats.payoffRatio;

            const diff = percentBetween(prevPayoffRatio, currentPayoffRatio);
            comparison.moneyManagement = {
                prev: prevPayoffRatio,
                current: currentPayoffRatio,
                diff: diff * this.optionWeights.moneyManagement
            };
        }

        if (winRate) {
            const prevWinRate = prevPortfolio.tradeStats.fullStats.winRate;
            const currentWinRate = currentPortfolio.tradeStats.fullStats.winRate;

            const diff = percentBetween(prevWinRate, currentWinRate);
            comparison.winRate = {
                prev: prevWinRate,
                current: currentWinRate,
                diff: diff * this.optionWeights.winRate
            };
        }

        if (efficiency) {
            const prevSharpeRatio = prevPortfolio.tradeStats.fullStats.sharpeRatio;
            const currentSharpeRatio = currentPortfolio.tradeStats.fullStats.sharpeRatio;

            const diff = percentBetween(prevSharpeRatio, currentSharpeRatio);
            comparison.efficiency = {
                prev: prevSharpeRatio,
                current: currentSharpeRatio,
                diff: diff * this.optionWeights.efficiency
            };
        }

        const rating = Object.values(comparison).reduce((prev, cur) => prev + cur.diff, 0);

        return {
            prevPortfolioRobots: Object.keys(prevPortfolio.robots),
            currentPortfolioRobots: Object.keys(currentPortfolio.robots),
            comparison,
            rating,
            approve: skip ? false : rating > 0
        };
    }

    async build(): Promise<{ portfolio: T; steps: any }> {
        try {
            this.calculateRobotsStats();
            this.sortRobots();
            const steps = [];
            const robotsList = this.sortedRobotsList.reverse();
            this.currentRobotsList = [...robotsList];
            this.prevPortfolio = this.calcPortfolio(this.sortedRobotsList);

            for (const robotId of robotsList) {
                const list = this.currentRobotsList.filter((r) => r !== robotId);
                if (list.length < this.portfolio.variables.minRobotsCount) break;
                this.currentPortfolio = this.calcPortfolio(list);

                const result = this.comparePortfolios(this.prevPortfolio, this.currentPortfolio);
                if (result.approve) {
                    this.prevPortfolio = this.currentPortfolio;
                    this.currentRobotsList = [...list];
                }
                steps.push(result);
            }

            if (this.currentRobotsList.length > this.portfolio.variables.maxRobotsCount) {
                const list = this.currentRobotsList.slice(-this.portfolio.variables.maxRobotsCount);
                this.currentPortfolio = this.calcPortfolio(list);
                this.prevPortfolio = this.currentPortfolio;
                this.currentRobotsList = [...list];
            }

            return {
                portfolio: {
                    ...this.portfolio,
                    fullStats: this.prevPortfolio.tradeStats.fullStats,
                    periodStats: periodStatsToArray(this.prevPortfolio.tradeStats.periodStats),
                    robots: Object.values(this.prevPortfolio.robots).map((r) => ({
                        robotId: r.robotId,
                        active: true,
                        share: r.share
                    }))
                },
                steps
            };
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }
}
