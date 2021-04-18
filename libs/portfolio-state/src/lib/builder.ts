import logger, { Logger } from "@cryptuoso/logger";
import { PortfolioRobot, PortfolioState } from "@cryptuoso/portfolio-state";
import { BasePosition } from "@cryptuoso/market";
import { TradeStats, TradeStatsCalc } from "@cryptuoso/trade-stats";
import { uniqueElementsBy } from "@cryptuoso/helpers";

export class PortfolioBuilder {
    #log: Logger;
    portfolio: PortfolioState;

    robots: {
        [key: string]: PortfolioRobot & {
            stats?: TradeStats;
            positions: BasePosition[];
        };
    } = {};

    constructor(portfolio: PortfolioState, positions: BasePosition[]) {
        this.#log = logger;
        this.portfolio = portfolio;
        const robotIds = uniqueElementsBy(
            positions.map(({ robotId }) => robotId),
            (a, b) => a === b
        );
        for (const id of robotIds) {
            this.robots[id] = {
                robotId: id,
                active: false,
                share: 0,
                positions: positions.filter(({ robotId }) => robotId === id)
            };
        }
    }

    get log() {
        return this.#log;
    }

    calculateRobotsStats() {
        for (const { robotId, positions } of Object.values(this.robots)) {
            const tradeStatsCalc = new TradeStatsCalc(
                positions,
                { job: { type: "robot", robotId, recalc: true } },
                null
            );

            this.robots[robotId].stats = tradeStatsCalc.calculate();
        }
    }

    async build() {
        try {
            this.calculateRobotsStats();
            return true;
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }
}
