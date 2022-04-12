import { spawn, Pool, Worker as ThreadsWorker } from "threads";
import { Job } from "bullmq";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import {
    TradeStatsRunnerEvents,
    TradeStatsRunnerPortfolio,
    TradeStatsRunnerPortfolioRobot,
    TradeStatsRunnerRecalcAllPortfolios,
    TradeStatsRunnerRecalcAllRobots,
    TradeStatsRunnerRecalcAllSignalSubscriptions,
    TradeStatsRunnerRecalcAllUserPortfolios,
    TradeStatsRunnerRecalcAllUserRobots,
    TradeStatsRunnerRobot,
    TradeStatsRunnerSchema,
    TradeStatsRunnerSignalSubscription,
    TradeStatsRunnerUserPortfolio,
    TradeStatsRunnerUserRobot,
    TradeStatsWorkerErrorEvent,
    TradeStatsWorkerEvents
} from "@cryptuoso/trade-stats-events";
import { RobotStatus } from "@cryptuoso/robot-types";
import { UserRoles } from "@cryptuoso/user-state";
import { UserRobotDB } from "@cryptuoso/user-robot-state";
import { StatsWorker } from "./worker";
import { TradeStatsJob } from "@cryptuoso/trade-stats";
import dayjs from "@cryptuoso/dayjs";
import { sql } from "@cryptuoso/postgres";

export type StatisticCalcWorkerServiceConfig = HTTPServiceConfig;

export default class StatisticCalcWorkerService extends HTTPService {
    private pool: Pool<any>;

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
                calcSignalSubscription: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.SIGNAL_SUBSCRIPTION],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.handleStatsCalcSignalSubscriptionEvent.bind(this))
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
                },
                recalcStatsAllSignalSubscriptions: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.RECALC_ALL_USER_PORTFOLIOS],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.handleRecalcAllSignalSubscriptionsEvent.bind(this))
                }
            });

            this.addOnStartHandler(this.onServiceStart);
            this.addOnStopHandler(this.onServiceStop);
        } catch (err) {
            this.log.error("Error in StatisticCalcWorkerService constructor", err);
        }
    }

    private async onServiceStart(): Promise<void> {
        this.pool = Pool(() => spawn<StatsWorker>(new ThreadsWorker("./worker")), {
            name: "stats-calc-worker",
            concurrency: this.workerConcurrency,
            size: this.workerThreads
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
            },
            [TradeStatsRunnerEvents.SIGNAL_SUBSCRIPTION]: {
                schema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.SIGNAL_SUBSCRIPTION],
                handler: this.handleStatsCalcSignalSubscriptionEvent.bind(this)
            }
        });
        this.createQueue("stats-calc");
        this.createWorker("stats-calc", this.process);
    }

    private async onServiceStop(): Promise<void> {
        await this.pool.terminate();
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
        const { recalc, portfolioId, savePositions, dateFrom, dateTo } = params;

        this.log.info(`New ${TradeStatsRunnerEvents.PORTFOLIO} event - ${portfolioId}`);
        await this.queueJob({ type: "portfolio", recalc, portfolioId, savePositions, dateFrom, dateTo });
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

    async handleStatsCalcSignalSubscriptionEvent(params: TradeStatsRunnerSignalSubscription) {
        const { recalc, signalSubscriptionId } = params;

        this.log.info(`New ${TradeStatsRunnerEvents.SIGNAL_SUBSCRIPTION} event - ${signalSubscriptionId}`);

        await this.queueJob({ type: "signalSubscription", recalc, signalSubscriptionId });
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

    async handleRecalcAllSignalSubscriptionsEvent(params: TradeStatsRunnerRecalcAllSignalSubscriptions) {
        const { exchange } = params;

        const conditionExchange = !exchange ? this.db.sql`` : this.db.sql`AND ss.exchange=${exchange}`;

        const signalSubscriptions = await this.db.pg.any<{ signalSubscriptionId: string }>(
            sql`
        SELECT ss.id as signal_subscription_id
        FROM signal_subscriptions ss
        WHERE ss.status = 'started'
        ${conditionExchange};
        `
        );

        for (const { signalSubscriptionId } of signalSubscriptions) {
            await this.queueJob({ type: "signalSubscription", recalc: true, signalSubscriptionId });
        }
    }

    async process(job: Job<TradeStatsJob>) {
        try {
            this.log.info(`Starting job ${job.id}`);

            await this.pool.queue(async (worker: StatsWorker) => worker.process(job.data));

            this.log.info(`Job ${job.id} finished`);
            return { result: "ok" };
        } catch (err) {
            this.log.error(`Error while processing job ${job.id}`, err);
            this.log.debug(job.data);
            await this.events.emit<TradeStatsWorkerErrorEvent>({
                type: TradeStatsWorkerEvents.ERROR,
                data: {
                    job: job.data,
                    timestamp: dayjs.utc().toISOString(),
                    error: err.message
                }
            });
            throw err;
        }
    }
}
