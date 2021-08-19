import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import {
    TradeStatsRunnerEvents,
    TradeStatsRunnerPortfolio,
    TradeStatsRunnerPortfolioRobot,
    TradeStatsRunnerRecalcAllPortfolios,
    TradeStatsRunnerRecalcAllRobots,
    TradeStatsRunnerRecalcAllUserPortfolios,
    TradeStatsRunnerRecalcAllUserRobots,
    TradeStatsRunnerRobot,
    TradeStatsRunnerSchema,
    TradeStatsRunnerUserPortfolio,
    TradeStatsRunnerUserRobot
} from "@cryptuoso/trade-stats-events";
import { RobotStatus } from "@cryptuoso/robot-state";
import { UserRoles } from "@cryptuoso/user-state";
import { TradeStatsJob } from "@cryptuoso/trade-stats";
import { sql } from "@cryptuoso/postgres";
import { UserRobotDB } from "@cryptuoso/user-robot-state";

export type StatisticCalcWorkerServiceConfig = HTTPServiceConfig;

export default class StatisticCalcRunnerService extends HTTPService {
    constructor(config?: StatisticCalcWorkerServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                calcStatsRobot: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.ROBOT],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.handleStatsCalcRobotEvent.bind(this))
                },
                calcStatsPortfolio: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.PORTFOLIO],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.handleStatsCalcPortfolioEvent.bind(this))
                },
                calcStatsPortfolioRobot: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.PORTFOLIO_ROBOT],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.handleStatsCalcPortfolioRobotEvent.bind(this))
                },
                calcStatsUserRobot: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.USER_ROBOT],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.handleStatsCalcUserRobotEvent.bind(this))
                },
                calcStatsUserPortfolio: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.USER_PORTFOLIO],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.handleStatsCalcUserPortfolioEvent.bind(this))
                },
                recalcStatsAllRobots: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.RECALC_ALL_ROBOTS],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.handleRecalcAllRobotsEvent.bind(this))
                },
                recalcStatsAllUserRobots: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.RECALC_ALL_USER_ROBOTS],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.handleRecalcAllUserRobotsEvent.bind(this))
                },
                recalcStatsAllPortfolios: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.RECALC_ALL_PORTFOLIOS],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.handleRecalcAllPorfoliosEvent.bind(this))
                },
                recalcStatsAllUserPortfolios: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.RECALC_ALL_USER_PORTFOLIOS],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.handleRecalcAllUserPortfoliosEvent.bind(this))
                }
            });
            this.events.subscribe({
                [TradeStatsRunnerEvents.ROBOT]: {
                    schema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.ROBOT],
                    handler: this.handleStatsCalcRobotEvent.bind(this)
                },
                [TradeStatsRunnerEvents.PORTFOLIO_ROBOT]: {
                    schema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.PORTFOLIO_ROBOT],
                    handler: this.handleStatsCalcPortfolioRobotEvent.bind(this)
                },
                [TradeStatsRunnerEvents.USER_ROBOT]: {
                    schema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.USER_ROBOT],
                    handler: this.handleStatsCalcUserRobotEvent.bind(this)
                }
            });
            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error("Error while constructing StatisticCalcRunnerService", err);
        }
    }

    async onServiceStart() {
        this.createQueue("stats-calc");
    }

    async queueJob(job: TradeStatsJob) {
        const jobId = Object.keys(job)
            .filter((prop: keyof TradeStatsJob) => prop != "recalc" && job[prop])
            .sort()
            .map((key: keyof TradeStatsJob) => job[key])
            .join("-");

        await this.addJob("stats-calc", job.type, job, {
            jobId,
            removeOnComplete: true,
            removeOnFail: 100,
            attempts: 3,
            backoff: { type: "exponential", delay: 10000 }
        });
    }

    async handleStatsCalcRobotEvent(params: TradeStatsRunnerRobot) {
        const { recalc, robotId } = params;

        this.log.info(`New ${TradeStatsRunnerEvents.ROBOT} event - ${robotId}`);

        const robot = await this.db.pg.maybeOne<{ id: string }>(this.db.sql`
        SELECT id
        FROM robots
        WHERE id = ${robotId};
         `);

        if (!robot) return;

        await this.queueJob({ type: "robot", recalc, robotId });
    }

    async handleStatsCalcPortfolioRobotEvent(params: TradeStatsRunnerPortfolioRobot) {
        const { recalc, robotId } = params;

        this.log.info(`New ${TradeStatsRunnerEvents.ROBOT} event - ${robotId}`);

        const robot = await this.db.pg.maybeOne<{ id: string }>(this.db.sql`
            SELECT id
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!robot) return;

        const portfolios = await this.db.pg.any<{ portfolioId: string }>(
            sql`
            SELECT pr.portfolio_id 
            FROM portfolio_robots pr, portfolios p
            WHERE p.id = pr.portfolio_id
            and p.status = 'started'
            and pr.robot_id = ${robotId}
            and pr.active = true;
            `
        );
        for (const { portfolioId } of portfolios) {
            await this.queueJob({ type: "portfolio", recalc, portfolioId });
        }
    }

    async handleStatsCalcPortfolioEvent(params: TradeStatsRunnerPortfolio) {
        const { recalc, portfolioId, savePositions } = params;

        this.log.info(`New ${TradeStatsRunnerEvents.PORTFOLIO} event - ${portfolioId}`);
        await this.queueJob({ type: "portfolio", recalc, portfolioId, savePositions });
    }

    async handleStatsCalcUserRobotEvent(params: TradeStatsRunnerUserRobot) {
        const { recalc, userRobotId } = params;

        this.log.info(`New ${TradeStatsRunnerEvents.USER_ROBOT} event - ${userRobotId}`);
        const userRobot = await this.db.pg.maybeOne<{
            id: UserRobotDB["id"];
            userPortfolioId?: UserRobotDB["userPortfolioId"];
        }>(this.db.sql`
            SELECT ur.id, ur.user_portfolio_id
            FROM user_robots ur
            WHERE ur.id = ${userRobotId};
        `);

        if (!userRobot) return;

        await this.queueJob({ type: "userRobot", recalc, userRobotId });

        if (userRobot.userPortfolioId) {
            await this.queueJob({ type: "userPortfolio", recalc, userPortfolioId: userRobot.userPortfolioId });
        }
    }

    async handleStatsCalcUserPortfolioEvent(params: TradeStatsRunnerUserPortfolio) {
        const { recalc, userPortfolioId } = params;

        this.log.info(`New ${TradeStatsRunnerEvents.USER_PORTFOLIO} event - ${userPortfolioId}`);

        await this.queueJob({ type: "userPortfolio", recalc, userPortfolioId });
    }

    async handleRecalcAllRobotsEvent(params: TradeStatsRunnerRecalcAllRobots) {
        const { exchange, asset } = params;

        const conditionExchange = !exchange ? this.db.sql`` : this.db.sql`AND r.exchange=${exchange}`;
        const conditionAsset = !asset ? this.db.sql`` : this.db.sql`AND r.asset=${asset}`;

        const robots = await this.db.pg.any<{
            id: string;
            exchange: string;
            asset: string;
        }>(this.db.sql`
            SELECT r.id, r.exchange, r.asset
            FROM robots r
            WHERE r.status = ${RobotStatus.started}
                ${conditionExchange}
                ${conditionAsset};
        `);
        for (const { id: robotId } of robots) {
            await this.queueJob({ type: "robot", recalc: true, robotId });
        }
    }

    async handleRecalcAllPorfoliosEvent(params: TradeStatsRunnerRecalcAllPortfolios) {
        const { exchange, savePositions } = params;

        const conditionExchange = !exchange ? this.db.sql`` : this.db.sql`WHERE p.exchange=${exchange}`;

        const portfolios = await this.db.pg.any<{ portfolioId: string }>(
            sql`
            SELECT p.id as portfolio_id 
            FROM portfolios p
             ${conditionExchange};
            `
        );
        for (const { portfolioId } of portfolios) {
            await this.queueJob({ type: "portfolio", recalc: true, portfolioId, savePositions });
        }
    }

    async handleRecalcAllUserRobotsEvent(params: TradeStatsRunnerRecalcAllUserRobots) {
        const { exchange, asset, userId } = params;

        const conditionUserId = !userId ? this.db.sql`` : this.db.sql`AND ur.user_id=${userId}`;
        const conditionExchange = !exchange ? this.db.sql`` : this.db.sql`AND r.exchange=${exchange}`;
        const conditionAsset = !asset ? this.db.sql`` : this.db.sql`AND r.asset=${asset}`;

        const userRobots = await this.db.pg.any<{
            userRobotId: string;
            userId: string;
            exchange: string;
            asset: string;
        }>(this.db.sql`
            SELECT ur.id as user_robot_id, ur.user_id, r.exchange, r.asset
            FROM user_robots ur, robots r
            WHERE r.status = ${RobotStatus.started}
                ${conditionUserId}
                AND ur.robot_id = r.id
                ${conditionExchange}
                ${conditionAsset};
        `);
        for (const { userRobotId } of userRobots) {
            await this.queueJob({ type: "userRobot", recalc: true, userRobotId });
        }
    }

    async handleRecalcAllUserPortfoliosEvent(params: TradeStatsRunnerRecalcAllUserPortfolios) {
        const { exchange, userId } = params;

        const conditionUserId = !userId ? this.db.sql`` : this.db.sql`AND up.user_id=${userId}`;
        const conditionExchange = !exchange ? this.db.sql`` : this.db.sql`AND up.exchange=${exchange}`;

        const userPortfolios = await this.db.pg.any<{ userPortfolioId: string }>(
            sql`
        SELECT up.id as user_portfolio_id
        FROM user_portfolios up
        WHERE up.status != 'error'
        ${conditionExchange}
        ${conditionUserId};
        `
        );

        for (const { userPortfolioId } of userPortfolios) {
            await this.queueJob({ type: "userPortfolio", recalc: true, userPortfolioId });
        }
    }
}
