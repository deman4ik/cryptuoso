import logger, { Logger } from "@cryptuoso/logger";
import { PortfolioOptions, PortfolioRobot, PortfolioState } from "@cryptuoso/portfolio-state";
import { BasePosition, calcPositionProfit } from "@cryptuoso/market";
import { TradeStats, TradeStatsCalc } from "@cryptuoso/trade-stats";
import { getPercentagePos, percentBetween, sum, uniqueElementsBy } from "@cryptuoso/helpers";
import Statistics from "statistics.js";

interface PortoflioRobotState extends PortfolioRobot {
    proportion?: number;
    stats?: TradeStats;
    positions: BasePosition[];
}

interface PortfolioCalculated {
    robots: { [key: string]: PortoflioRobotState };
    tradeStats: TradeStats;
    correlationPercent?: number;
}

export class PortfolioBuilder {
    #log: Logger;
    portfolio: PortfolioState;
    optionWeights: { [Weight in keyof PortfolioOptions]: number } = {
        diversification: 1.1,
        profit: 1.1,
        risk: 1.1,
        moneyManagement: 1,
        winRate: 1,
        efficiency: 1.2
    };
    minRobotsCount = 1;
    robots: {
        [key: string]: PortoflioRobotState;
    } = {};
    sortedRobotsList: string[] = [];
    currentRobotsList: string[] = [];
    prevPortfolio: PortfolioCalculated;

    currentPortfolio: PortfolioCalculated;

    constructor(portfolio: PortfolioState, positions: BasePosition[]) {
        this.#log = logger;
        this.portfolio = portfolio;
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

    get log() {
        return this.#log;
    }

    calculateRobotsStats() {
        for (const { robotId, positions } of Object.values(this.robots)) {
            const tradeStatsCalc = new TradeStatsCalc(
                positions,
                {
                    job: { type: "robot", robotId, recalc: true },
                    userInitialBalance: this.portfolio.settings.initialBalance
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

    calcPortfolio(robotIds: string[]): PortfolioCalculated {
        const robots = Object.values(this.robots).filter(({ robotId }) => robotIds.includes(robotId));
        for (const robot of robots) {
            robot.proportion = this.portfolio.settings.initialBalance / Math.abs(robot.stats.fullStats.maxDrawdown);
        }
        const propСoefficient = this.portfolio.settings.initialBalance / sum(...robots.map((r) => r.proportion));

        for (const robot of robots) {
            robot.amountInCurrency = propСoefficient * robot.proportion;
            robot.share = (robot.amountInCurrency * 100) / this.portfolio.settings.initialBalance;
            robot.positions = robot.positions.map((pos) => {
                const volume = robot.amountInCurrency / pos.entryPrice;
                return {
                    ...pos,
                    volume,
                    profit: calcPositionProfit(pos.direction, pos.entryPrice, pos.exitPrice, volume),
                    worstProfit: calcPositionProfit(pos.direction, pos.entryPrice, pos.maxPrice, volume)
                };
            });
        }
        const positions = robots.reduce((prev, cur) => [...prev, ...cur.positions], []);
        const tradeStatsCalc = new TradeStatsCalc(
            positions,
            {
                job: { type: "portfolio", portfolioId: this.portfolio.id, recalc: true },
                userInitialBalance: this.portfolio.settings.initialBalance
            },
            null
        );
        const robotsList: {
            [key: string]: PortoflioRobotState;
        } = {};
        for (const robot of robots) {
            robotsList[robot.robotId] = robot;
        }
        return {
            robots: robotsList,
            tradeStats: tradeStatsCalc.calculate()
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

        const rating =
            Object.values(comparison).reduce((prev, cur) => prev + cur.diff, 0) / Object.keys(comparison).length;

        return {
            prevPortfolioRobots: Object.keys(prevPortfolio.robots),
            currentPortfolioRobots: Object.keys(currentPortfolio.robots),
            comparison,
            rating,
            approve: skip ? false : rating > 0
        };
    }

    async build() {
        try {
            this.calculateRobotsStats();
            this.sortRobots();
            const steps = [];
            const robotsList = this.sortedRobotsList.reverse();
            this.currentRobotsList = [...robotsList];

            this.prevPortfolio = this.calcPortfolio(this.sortedRobotsList);

            for (const robotId of robotsList) {
                const list = this.currentRobotsList.filter((r) => r !== robotId);
                if (list.length < this.minRobotsCount) break;
                this.currentPortfolio = this.calcPortfolio(list);

                const result = this.comparePortfolios(this.prevPortfolio, this.currentPortfolio);
                if (result.approve) {
                    this.prevPortfolio = this.currentPortfolio;
                    this.currentRobotsList = [...list];
                }
                steps.push(result);
            }

            //TODO: set min balance
            return {
                portfolio: this.prevPortfolio,
                steps
            };
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }
}
