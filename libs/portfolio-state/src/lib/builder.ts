import logger, { Logger } from "@cryptuoso/logger";
import { PortfolioRobot, PortfolioState } from "@cryptuoso/portfolio-state";
import { BasePosition, calcPositionProfit } from "@cryptuoso/market";
import { TradeStats, TradeStatsCalc } from "@cryptuoso/trade-stats";
import { sum, uniqueElementsBy } from "@cryptuoso/helpers";
import calcCorrelation from "calculate-correlation";

interface PortoflioRobotState extends PortfolioRobot {
    proportion?: number;
    stats?: TradeStats;
    positions: BasePosition[];
}

interface PortfolioCalculated {
    robots: { [key: string]: PortoflioRobotState[] };
    tradeStats: TradeStats;
}

export class PortfolioBuilder {
    #log: Logger;
    portfolio: PortfolioState;

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
                    if (a.netProfit > b.netProfit) return 1;
                    if (a.netProfit < b.netProfit) return -1;
                }
                if (risk && !diversification && !profit && !moneyManagement && !winRate && !efficiency) {
                    if (a.maxDrawdown < b.maxDrawdown) return 1;
                    if (a.maxDrawdown > b.maxDrawdown) return -1;
                }
                if (moneyManagement && !diversification && !profit && !risk && !winRate && !efficiency) {
                    if (a.payoffRatio > b.payoffRatio) return 1;
                    if (a.payoffRatio < b.payoffRatio) return -1;
                }
                if (winRate && !diversification && !profit && !risk && !moneyManagement && !efficiency) {
                    if (a.winRate > b.winRate) return 1;
                    if (a.winRate < b.winRate) return -1;
                }
                if (efficiency && !diversification && !profit && !moneyManagement && !winRate && !risk) {
                    if (a.sharpeRatio > b.sharpeRatio) return 1;
                    if (a.sharpeRatio < b.sharpeRatio) return -1;
                }
                if (a.recoveryFactor > b.recoveryFactor) return 1;
                if (a.recoveryFactor < b.recoveryFactor) return -1;
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
                    profit: calcPositionProfit(pos.direction, pos.entryPrice, pos.exitPrice, volume)
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
        return {
            robots: robots.reduce((prev, cur) => ({ ...prev, [cur.robotId]: cur }), {}),
            tradeStats: tradeStatsCalc.calculate()
        };
    }

    percentBetween(a: number, b: number) {
        return ((a - b) / b) * 100;
    }

    approvePortfolio(prevPortfolio: PortfolioCalculated, currentPortfolio: PortfolioCalculated) {
        const { diversification, profit, risk, moneyManagement, winRate, efficiency } = this.portfolio.settings.options;
        const weights = [];
        if (diversification) {
            const prevMonthsNetProfit = Object.values(prevPortfolio.tradeStats.periodStats.month).map(
                (s) => s.stats.percentNetProfit
            );
            const currentMonthsProfit = Object.values(currentPortfolio.tradeStats.periodStats.month).map(
                (s) => s.stats.percentNetProfit
            );

            console.log(prevMonthsNetProfit, currentMonthsProfit);
            const correlation = calcCorrelation(prevMonthsNetProfit, currentMonthsProfit);

            if (correlation < 1) weights.push(100);
            else weights.push(0);
        }

        if (profit) {
            const prevNetProfit = prevPortfolio.tradeStats.fullStats.avgPercentNetProfitQuarters;
            const currentNetProfit = currentPortfolio.tradeStats.fullStats.avgPercentNetProfitQuarters;

            weights.push({
                prevNetProfit,
                currentNetProfit,
                value: this.percentBetween(prevNetProfit, currentNetProfit)
            });
        }

        if (risk) {
            const prevMaxDrawdown = prevPortfolio.tradeStats.fullStats.maxDrawdown;
            const currentMaxDrawdown = currentPortfolio.tradeStats.fullStats.maxDrawdown;

            weights.push({
                prevMaxDrawdown,
                currentMaxDrawdown,
                value: this.percentBetween(prevMaxDrawdown, currentMaxDrawdown)
            });
        }

        if (moneyManagement) {
            const prevPayoffRatio = prevPortfolio.tradeStats.fullStats.payoffRatio;
            const currentPayoffRatio = currentPortfolio.tradeStats.fullStats.payoffRatio;

            weights.push({
                prevPayoffRatio,
                currentPayoffRatio,
                value: this.percentBetween(prevPayoffRatio, currentPayoffRatio)
            });
        }

        if (winRate) {
            const prevWinRate = prevPortfolio.tradeStats.fullStats.winRate;
            const currentWinRate = currentPortfolio.tradeStats.fullStats.winRate;

            weights.push({
                prevWinRate,
                currentWinRate,
                value: this.percentBetween(prevWinRate, currentWinRate)
            });
        }

        if (efficiency) {
            const prevSharpeRatio = prevPortfolio.tradeStats.fullStats.sharpeRatio;
            const currentSharpeRatio = currentPortfolio.tradeStats.fullStats.sharpeRatio;

            weights.push({
                prevSharpeRatio,
                currentSharpeRatio,
                value: this.percentBetween(prevSharpeRatio, currentSharpeRatio)
            });
        }

        return weights;
    }

    async build() {
        try {
            this.calculateRobotsStats();
            this.sortRobots();
            for (const robotId of this.sortedRobotsList) {
                if (!this.prevPortfolio) {
                    this.currentRobotsList = [robotId];
                    this.prevPortfolio = this.calcPortfolio(this.currentRobotsList);
                    continue;
                }
                this.currentPortfolio = this.calcPortfolio([...this.currentRobotsList, robotId]);
            }
            return true;
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }
}
