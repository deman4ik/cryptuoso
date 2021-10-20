import logger, { Logger } from "@cryptuoso/logger";
import { Subject } from "threads/observable";
import { PortfolioOptions, PortfolioOptionWeights, PortfolioRobot, PortfolioState, UserPortfolioState } from "./types";
import { BasePosition } from "@cryptuoso/market";
import { periodStatsToArray, TradeStats, TradeStatsCalc } from "@cryptuoso/trade-stats";
import { percentBetween, round, sum, uniqueElementsBy } from "@cryptuoso/helpers";
import { getPortfolioBalance, getPortfolioRobotsCount, getPortfolioMinBalance } from "./helpers";

export interface PortoflioRobotState extends PortfolioRobot {
    minAmountCurrency?: number;
    stats?: TradeStats;
    positions: BasePosition[];
}

export interface PortfolioCalculated {
    robots: { [key: string]: PortoflioRobotState };
    tradeStats: TradeStats;
    correlationPercent?: number;
}

export class PortfolioBuilder<T extends PortfolioState | UserPortfolioState> {
    #log: Logger;
    #subject: Subject<number>;
    portfolio: T;
    optionWeights: PortfolioOptionWeights;
    robots: {
        [key: string]: PortoflioRobotState;
    } = {};

    constructor(portfolio: T, subject?: Subject<number>) {
        this.#log = logger;
        this.#subject = subject;
        this.portfolio = portfolio;
        this.optionWeights = {
            profit: 1.1,
            risk: 1.1,
            moneyManagement: 1,
            winRate: 1,
            efficiency: 1.2,
            ...this.portfolio.settings.optionWeights
        };
        this.#calcPortfolioVariables();
    }

    init(positions: BasePosition[]) {
        const robotIds = uniqueElementsBy(
            positions.map(({ robotId }) => robotId),
            (a, b) => a === b
        );

        this.robots = robotIds.reduce((prev, cur) => {
            const robotPositions = positions.filter(({ robotId }) => robotId === cur);
            return {
                ...prev,
                [cur]: {
                    robotId: cur,
                    active: false,
                    share: 0,
                    amountInCurrency: 0,
                    priority: 0,
                    minAmountCurrency: robotPositions[0].minAmountCurrency,
                    positions: robotPositions
                }
            };
        }, {});
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
        const minBalance =
            this.portfolio.context.minBalance ||
            getPortfolioMinBalance(
                portfolioBalance,
                minTradeAmount,
                this.portfolio.settings.minRobotsCount,
                this.portfolio.settings.leverage,
                !!this.portfolio.settings.maxRobotsCount
            );
        const maxRobotsCount =
            this.portfolio.context.robotsCount ||
            this.portfolio.settings.maxRobotsCount ||
            getPortfolioRobotsCount(portfolioBalance, minTradeAmount);

        const minRobotsCount =
            this.portfolio.context.robotsCount ||
            this.portfolio.settings.minRobotsCount ||
            getPortfolioRobotsCount(minBalance, minTradeAmount);

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
    }

    async sortRobots(robots: { [key: string]: PortoflioRobotState }) {
        this.log.debug(`Portfolio #${this.portfolio.id} - Sorting ${Object.keys(robots).length} robots`);
        const { profit, risk, moneyManagement, winRate, efficiency } = this.portfolio.settings.options;
        return Object.values(robots)
            .filter(
                ({
                    stats: {
                        fullStats: { netProfit }
                    }
                }) => netProfit > 0
            )
            .sort(({ stats: { fullStats: a } }, { stats: { fullStats: b } }) => {
                let value = 0;

                if (profit === true) {
                    value += percentBetween(a.percentNetProfit, b.percentNetProfit) * this.optionWeights.profit;
                }
                if (risk === true) {
                    value += -percentBetween(a.percentMaxDrawdown, b.percentMaxDrawdown) * this.optionWeights.risk;
                }
                if (moneyManagement === true) {
                    value += percentBetween(a.payoffRatio, b.payoffRatio) * this.optionWeights.moneyManagement;
                }
                if (winRate === true) {
                    value += percentBetween(a.winRate, b.winRate) * this.optionWeights.winRate;
                }
                if (efficiency === true) {
                    value += percentBetween(a.sharpeRatio, b.sharpeRatio) * this.optionWeights.efficiency;
                }
                return value;
            })

            .map(({ robotId }) => robotId);
    }

    async calcAmounts(
        robotIds: string[],
        currentRobotId?: string
    ): Promise<
        Readonly<
            | {
                  [key: string]: PortoflioRobotState;
              }
            | false
        >
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

            if (this.portfolio.settings.robotsShare && this.portfolio.settings.robotsShare[key]) {
                robots[key].share = this.portfolio.settings.robotsShare[key];
            }

            if (currentRobotId && key === currentRobotId) {
                if (robots[key].share < 1) return false;
                /*  if (robots[key].minAmountCurrency) {
                    const amountInCurrency = calcPercentValue(
                        this.portfolio.settings.initialBalance,
                        robots[key].share
                    );
                    if (amountInCurrency < robots[key].minAmountCurrency) return false;
                }*/
            }
        }

        //const minShare = Math.min(...Object.values(robots).map((r) => r.share));
        // this.portfolio.variables.minBalance = round(this.portfolio.context.minTradeAmount * (100 / minShare));
        const portfolioRobots: {
            [key: string]: PortoflioRobotState;
        } = Object.values(robots)
            .filter((r) => r.share)
            .reduce((p, c) => ({ ...p, [c.robotId]: { ...c } }), {});
        for (const [key, robot] of Object.entries(portfolioRobots)) {
            portfolioRobots[key].positions = robot.positions.map((pos) => {
                return {
                    ...pos,
                    meta: {
                        portfolioShare: robot.share
                    }
                };
            });
        }
        return portfolioRobots;
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
                    feeRate: this.portfolio.settings.feeRate || this.portfolio.context.feeRate,
                    savePositions: true
                },
                initialBalance: this.portfolio.settings.initialBalance,
                leverage: this.portfolio.settings.leverage
            },
            null
        );

        return tradeStatsCalc.calculate();
    }

    async calcPortfolio(robotIds: string[], currentRobotId?: string): Promise<PortfolioCalculated | false> {
        this.log.debug(`Portfolio #${this.portfolio.id} - Calculating portfolio with ${robotIds.length} robots`);
        const robots = await this.calcAmounts(robotIds, currentRobotId);
        if (!robots) return false;
        const tradeStats = await this.calcPortfolioStats(robots);
        return {
            robots,
            tradeStats
        };
    }

    async comparePortfolios(prevPortfolio: PortfolioCalculated, currentPortfolio: PortfolioCalculated) {
        this.log.debug(`Portfolio #${this.portfolio.id} - Comparing portfolios `);
        const { profit, risk, moneyManagement, winRate, efficiency } = this.portfolio.settings.options;
        const comparison: {
            [Comparison in keyof PortfolioOptions]?: {
                prev: number;
                current: number;
                diff: number;
            };
        } = {};
        let skip = false;

        if (profit === true) {
            const prevNetProfit = prevPortfolio.tradeStats.fullStats.netProfit;
            const currentNetProfit = currentPortfolio.tradeStats.fullStats.netProfit;

            if (currentNetProfit < 0) skip = true;

            const diff = percentBetween(prevNetProfit, currentNetProfit);
            comparison.profit = {
                prev: prevNetProfit,
                current: currentNetProfit,
                diff: diff * this.optionWeights.profit
            };
        }

        if (risk === true) {
            const prevMaxDrawdown = prevPortfolio.tradeStats.fullStats.percentMaxDrawdown;
            const currentMaxDrawdown = currentPortfolio.tradeStats.fullStats.percentMaxDrawdown;

            const diff = -percentBetween(prevMaxDrawdown, currentMaxDrawdown);
            comparison.risk = {
                prev: prevMaxDrawdown,
                current: currentMaxDrawdown,
                diff: diff * this.optionWeights.risk
            };
        }

        if (moneyManagement === true) {
            const prevPayoffRatio = prevPortfolio.tradeStats.fullStats.payoffRatio;
            const currentPayoffRatio = currentPortfolio.tradeStats.fullStats.payoffRatio;

            const diff = percentBetween(prevPayoffRatio, currentPayoffRatio);
            comparison.moneyManagement = {
                prev: prevPayoffRatio,
                current: currentPayoffRatio,
                diff: diff * this.optionWeights.moneyManagement
            };
        }

        if (winRate === true) {
            const prevWinRate = prevPortfolio.tradeStats.fullStats.winRate;
            const currentWinRate = currentPortfolio.tradeStats.fullStats.winRate;

            const diff = percentBetween(prevWinRate, currentWinRate);
            comparison.winRate = {
                prev: prevWinRate,
                current: currentWinRate,
                diff: diff * this.optionWeights.winRate
            };
        }

        if (efficiency === true) {
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

    async build(): Promise<{
        portfolio: T;
        steps: {
            prevPortfolioRobots: string[];
            currentPortfolioRobots: string[];
            comparison: {
                [Comparison in keyof PortfolioOptions]?: {
                    prev: number;
                    current: number;
                    diff: number;
                };
            };
            rating: number;
            approve: boolean;
        }[];
    }> {
        try {
            this.log.debug(`Portfolio #${this.portfolio.id} - Building portfolio`);
            await this.calculateRobotsStats();
            const robotsList = await this.sortRobots(this.robots); // сортировка от худших к лучшим
            const steps: {
                prevPortfolioRobots: string[];
                currentPortfolioRobots: string[];
                comparison: {
                    [Comparison in keyof PortfolioOptions]?: {
                        prev: number;
                        current: number;
                        diff: number;
                    };
                };
                rating: number;
                approve: boolean;
            }[] = [];

            const robotsCount = this.minRobotsCount || 1;
            let currentRobotsList = [...robotsList.slice(0, robotsCount)];
            let prevPortfolio: PortfolioCalculated | false = Object.freeze(await this.calcPortfolio(currentRobotsList));
            if (!prevPortfolio) throw new Error("Failed to build portfolio");
            let currentPortfolio: PortfolioCalculated | false;
            let currentRobot = robotsCount;
            for (const robotId of robotsList.splice(robotsCount)) {
                currentRobot += 1;

                const list = [...currentRobotsList, robotId];

                currentPortfolio = await this.calcPortfolio(list, robotId);
                if (!currentPortfolio) continue;
                const result = await this.comparePortfolios(prevPortfolio, currentPortfolio);
                if (result.approve) {
                    prevPortfolio = Object.freeze({ ...currentPortfolio });
                    currentRobotsList = [...list];
                }
                steps.push(result);
                this.progress(round((currentRobot / robotsList.length) * 100));
            }

            if (currentRobotsList.length > robotsCount) {
                const bestRobots = [...robotsList.slice(0, robotsCount)];

                for (const robotId of bestRobots) {
                    const list = currentRobotsList.filter((r) => r !== robotId);

                    currentPortfolio = await this.calcPortfolio(list, robotId);
                    if (!currentPortfolio) continue;
                    const result = await this.comparePortfolios(prevPortfolio, currentPortfolio);
                    if (result.approve) {
                        prevPortfolio = Object.freeze({ ...currentPortfolio });
                        currentRobotsList = [...list];
                    }
                    steps.push(result);
                    if (currentRobotsList.length <= robotsCount) break;
                }
            }

            if (this.maxRobotsCount && currentRobotsList.length > this.maxRobotsCount) {
                this.log.debug(
                    `Portfolio #${this.portfolio.id} - Portfolio builded to much ${currentRobotsList.length} robots max is ${this.maxRobotsCount}`
                );
                const list = currentRobotsList.slice(-this.maxRobotsCount);
                currentPortfolio = await this.calcPortfolio(list);
                if (currentPortfolio) {
                    prevPortfolio = Object.freeze({ ...currentPortfolio });
                    currentRobotsList = [...list];
                }
            }
            this.log.debug(`Portfolio #${this.portfolio.id} - Portfolio builded ${currentRobotsList.length} robots`);
            if (!prevPortfolio) throw new Error("Failed to build portfolio");
            return {
                portfolio: {
                    ...this.portfolio,
                    fullStats: prevPortfolio.tradeStats.fullStats,
                    periodStats: periodStatsToArray(prevPortfolio.tradeStats.periodStats),
                    robots: Object.values(prevPortfolio.robots).map((r, index) => ({
                        robotId: r.robotId,
                        active: true,
                        share: r.share,
                        priority: Object.keys((prevPortfolio as PortfolioCalculated).robots).length - index // сортировка от лучших к худшим по порядку
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
}
