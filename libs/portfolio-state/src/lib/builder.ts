import logger, { Logger } from "@cryptuoso/logger";
import { Subject } from "threads/observable";
import { PortfolioOptions, PortfolioRobot, PortfolioState, UserPortfolioState } from "./types";
import { BasePosition } from "@cryptuoso/market";
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
    #subject: Subject<number>;
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

    constructor(portfolio: T, subject?: Subject<number>) {
        this.#log = logger;
        this.#subject = subject;
        this.portfolio = portfolio;
        this.#calcPortfolioVariables();
    }

    init(positions: BasePosition[]) {
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
                    priority: 0,
                    positions: positions.filter(({ robotId }) => robotId === cur)
                }
            }),
            {}
        );
        this.log.debug(`Portfolio #${this.portfolio.id} inited ${Object.keys(this.robots).length} robots`);
    }

    progress(percent: number) {
        if (this.#subject) {
            this.#subject.next(percent);
        }
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

    get portfolioBalance() {
        return this.portfolio.variables.portfolioBalance;
    }

    get minRobotsCount() {
        return this.portfolio.variables.minRobotsCount;
    }

    get maxRobotsCount() {
        return this.portfolio.variables.maxRobotsCount;
    }

    get minBalance() {
        return this.portfolio.variables.minBalance;
    }

    get log() {
        return this.#log;
    }

    async calculateRobotsStats() {
        this.log.debug(`Portfolio #${this.portfolio.id} - Calculating robots stats`);
        const results = await Promise.all(
            Object.values(this.robots).map(async ({ robotId, positions }) => {
                const tradeStatsCalc = new TradeStatsCalc(
                    positions,
                    {
                        job: { type: "robot", robotId, recalc: true },
                        initialBalance: this.portfolio.settings.initialBalance
                    },
                    null
                );

                return {
                    robotId,
                    stats: await tradeStatsCalc.calculate()
                };
            })
        );

        for (const { robotId, stats } of results) {
            this.robots[robotId].stats = stats;
        }

        /*  for (const { robotId, positions } of Object.values(this.robots)) {
            const tradeStatsCalc = new TradeStatsCalc(
                positions,
                {
                    job: { type: "robot", robotId, recalc: true },
                    initialBalance: this.portfolio.settings.initialBalance
                },
                null
            );

            this.robots[robotId].stats = tradeStatsCalc.calculate();
        } */
    }

    async sortRobots(robots: { [key: string]: PortoflioRobotState }) {
        this.log.debug(`Portfolio #${this.portfolio.id} - Sorting ${Object.keys(robots).length} robots`);
        const { diversification, profit, risk, moneyManagement, winRate, efficiency } = this.portfolio.settings.options;
        return Object.values(robots)
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
            .map(({ robotId }) => robotId)
            .reverse();
    }

    async calcAmounts(robotIds: string[]): Promise<
        Readonly<{
            [key: string]: PortoflioRobotState;
        }>
    > {
        const robots: {
            [key: string]: PortoflioRobotState;
        } = Object.values({ ...this.robots })
            .filter(({ robotId }) => robotIds.includes(robotId))
            .reduce((p, c) => ({ ...p, [c.robotId]: { ...c } }), {});
        this.log.debug(
            `Portfolio #${this.portfolio.id} - Calculating amounts for ${Object.keys(robots).length} robots`
        );
        const propСoefficient = 100 / sum(...Object.values(robots).map((r) => r.stats.fullStats.amountProportion));

        for (const [key, robot] of Object.entries(robots)) {
            robots[key].share = round(robot.stats.fullStats.amountProportion * propСoefficient, 2);
        }

        const minShare = Math.min(...Object.values(robots).map((r) => r.share));
        this.portfolio.variables.minBalance =
            round((this.portfolio.context.minTradeAmount * 100) / minShare / 100) * 100;

        for (const [key, robot] of Object.entries(robots)) {
            robots[key].positions = robot.positions.map((pos) => {
                return {
                    ...pos,
                    meta: {
                        portfolioShare: robot.share
                    }
                };
            });
        }
        return robots;
    }

    async calcPortfolioStats(robots: Readonly<{ [key: string]: PortoflioRobotState }>) {
        this.log.debug(`Portfolio #${this.portfolio.id} - Calculating portfolio stats`);
        const positions = Object.values(robots).reduce((prev, cur) => [...prev, ...cur.positions], []);
        const tradeStatsCalc = new TradeStatsCalc(
            positions,
            {
                job: {
                    type: "portfolio",
                    portfolioId: this.portfolio.id,
                    recalc: true,
                    feeRate: this.portfolio.context.feeRate,
                    savePositions: false
                },
                initialBalance: this.portfolio.settings.initialBalance,
                leverage: this.portfolio.settings.leverage
            },
            null
        );

        return tradeStatsCalc.calculate();
    }

    async calcPortfolio(robotIds: string[]): Promise<PortfolioCalculated> {
        this.log.debug(`Portfolio #${this.portfolio.id} - Calculating portfolio with ${robotIds.length} robots`);
        const robots = await this.calcAmounts(robotIds);
        const tradeStats = await this.calcPortfolioStats(robots);
        return {
            robots,
            tradeStats
        };
    }

    async comparePortfolios(prevPortfolio: PortfolioCalculated, currentPortfolio: PortfolioCalculated) {
        this.log.debug(`Portfolio #${this.portfolio.id} - Comparing portfolios `);
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
            this.log.debug(`Portfolio #${this.portfolio.id} - Building portfolio`);
            await this.calculateRobotsStats();
            const robotsList = await this.sortRobots(this.robots); // сортировка от худших к лучшим
            const steps = [];

            let currentRobotsList = [...robotsList];
            let prevPortfolio: PortfolioCalculated = Object.freeze(await this.calcPortfolio(robotsList));
            let currentPortfolio: PortfolioCalculated;
            let currentRobot = 0;
            for (const robotId of robotsList) {
                currentRobot += 1;
                console.log(robotId);
                const list = currentRobotsList.filter((r) => r !== robotId);
                if (list.length < this.portfolio.variables.minRobotsCount) break;
                currentPortfolio = await this.calcPortfolio(list);

                const result = await this.comparePortfolios(prevPortfolio, currentPortfolio);
                if (result.approve) {
                    prevPortfolio = Object.freeze({ ...currentPortfolio });
                    currentRobotsList = [...list];
                }
                steps.push(result);
                this.progress(round((currentRobot / robotsList.length) * 100));
            }
            if (currentRobotsList.length > this.portfolio.variables.maxRobotsCount) {
                this.log.debug(
                    `Portfolio #${this.portfolio.id} - Portfolio builded to much ${currentRobotsList.length} robots max is ${this.portfolio.variables.maxRobotsCount}`
                );
                const list = currentRobotsList.slice(-this.portfolio.variables.maxRobotsCount);
                currentPortfolio = await this.calcPortfolio(list);
                prevPortfolio = Object.freeze({ ...currentPortfolio });
                currentRobotsList = [...list];
            }
            this.log.debug(`Portfolio #${this.portfolio.id} - Portfolio builded ${currentRobotsList.length} robots`);

            return {
                portfolio: {
                    ...this.portfolio,
                    fullStats: prevPortfolio.tradeStats.fullStats,
                    periodStats: periodStatsToArray(prevPortfolio.tradeStats.periodStats),
                    robots: Object.values(prevPortfolio.robots).map((r, index) => ({
                        robotId: r.robotId,
                        active: true,
                        share: r.share,
                        priority: Object.keys(prevPortfolio.robots).length - index // сортировка от лучших к худшим по порядку
                    })),
                    positions: prevPortfolio.tradeStats.positions
                },
                steps
            };
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }

    async buildOnce(): Promise<{ portfolio: T }> {
        try {
            this.log.debug(`Portfolio #${this.portfolio.id} - Building portfolio once`);
            await this.calculateRobotsStats();
            const robotsList = await this.sortRobots(this.robots); // сортировка от худших к лучшим

            const currentPortfolio = Object.freeze(await this.calcPortfolio(robotsList));
            this.log.debug(`Portfolio #${this.portfolio.id} - Portfolio builded ${robotsList.length} robots`);

            return {
                portfolio: {
                    ...this.portfolio,
                    fullStats: currentPortfolio.tradeStats.fullStats,
                    periodStats: periodStatsToArray(currentPortfolio.tradeStats.periodStats),
                    robots: Object.values(currentPortfolio.robots).map((r, index) => ({
                        robotId: r.robotId,
                        active: true,
                        share: r.share,
                        priority: Object.keys(currentPortfolio.robots).length - index // сортировка от лучших к худшим по порядку
                    }))
                }
            };
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }
}
