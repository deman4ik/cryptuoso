import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import {
    TradeStatsRunnerEvent,
    TradeStatsRunnerEvents,
    TradeStatsRunnerPortfolio,
    TradeStatsRunnerRecalcAllPortfolios,
    TradeStatsRunnerRecalcAllRobots,
    TradeStatsRunnerRecalcAllUserPortfolios,
    TradeStatsRunnerRecalcAllUserRobots,
    TradeStatsRunnerRobot,
    TradeStatsRunnerSchema,
    TradeStatsRunnerUserPortfolio,
    TradeStatsRunnerUserRobot,
    TradeStatsRunnerUserSignal,
    TradeStatsRunnerUserSignalDeleted
} from "@cryptuoso/trade-stats-events";
import { RobotStatus } from "@cryptuoso/robot-state";
import { UserRoles } from "@cryptuoso/user-state";
import { TradeStatsJob, TradeStatsAggrJob } from "@cryptuoso/trade-stats";
import { uniqueElementsBy } from "@cryptuoso/helpers";

export type StatisticCalcWorkerServiceConfig = HTTPServiceConfig;

export default class StatisticCalcRunnerService extends HTTPService {
    constructor(config?: StatisticCalcWorkerServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                calcStatsRobot: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.ROBOT],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this._HTTPHandler.bind(this, this.handleStatsCalcRobotEvent.bind(this))
                },
                calcStatsPortfolio: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.PORTFOLIO],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this._HTTPHandler.bind(this, this.handleStatsCalcPortfolioEvent.bind(this))
                },
                calcStatsUserSignal: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.USER_SIGNAL],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this._HTTPHandler.bind(this, this.handleCalcUserSignalEvent.bind(this))
                },
                calcStatsUserRobot: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.USER_ROBOT],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this._HTTPHandler.bind(this, this.handleStatsCalcUserRobotEvent.bind(this))
                },
                calcStatsUserPortfolio: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.USER_PORTFOLIO],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this._HTTPHandler.bind(this, this.handleStatsCalcUserPortfolioEvent.bind(this))
                },
                recalcStatsAllRobots: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.RECALC_ALL_ROBOTS],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this._HTTPHandler.bind(this, this.handleRecalcAllRobotsEvent.bind(this))
                },
                recalcStatsAllUserRobots: {
                    inputSchema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.RECALC_ALL_USER_ROBOTS],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this._HTTPHandler.bind(this, this.handleRecalcAllUserRobotsEvent.bind(this))
                }
            });
            this.events.subscribe({
                [TradeStatsRunnerEvents.USER_SIGNAL_DELETED]: {
                    schema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.USER_SIGNAL_DELETED],
                    handler: this.handleUserSignalDeletedEvent.bind(this)
                },
                [TradeStatsRunnerEvents.USER_ROBOT_DELETED]: {
                    schema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.USER_ROBOT_DELETED],
                    handler: this.handleUserRobotDeletedEvent.bind(this)
                },
                [TradeStatsRunnerEvents.ROBOT]: {
                    schema: TradeStatsRunnerSchema[TradeStatsRunnerEvents.ROBOT],
                    handler: this.handleStatsCalcRobotEvent.bind(this)
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

    async _HTTPHandler(
        handler: {
            (params: TradeStatsRunnerEvent): Promise<void>;
        },
        req: {
            body: {
                input: TradeStatsRunnerEvent;
            };
        },
        res: any
    ) {
        await handler(req.body.input);

        res.send({ result: "OK" });

        res.end();
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

    async queueAggrJob(job: TradeStatsAggrJob, exchange?: string, asset?: string) {
        await this.queueJob(job);
        if (exchange) await this.queueJob({ ...job, exchange });
        if (job.type === "allPortfoliosAggr" || job.type === "allUserPortfoliosAggr") return;
        if (asset) await this.queueJob({ ...job, asset });
        if (exchange && asset) await this.queueJob({ ...job, exchange, asset });
    }

    async handleStatsCalcRobotEvent(params: TradeStatsRunnerRobot) {
        const { recalc, robotId } = params;

        this.log.info(`New ${TradeStatsRunnerEvents.ROBOT} event - ${robotId}`);

        const robot = await this.db.pg.maybeOne<{ exchange: string; asset: string }>(this.db.sql`
            SELECT exchange, asset
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!robot) return;

        const { exchange, asset } = robot;
        /*   await this.queueJob({ type: "robot", recalc, robotId });

        const userSignals = await this.db.pg.any<{
            userSignalId: string;
            userId: string;
        }>(this.db.sql`
            SELECT us.id as user_signal_id, us.user_id
            FROM user_signals us
            WHERE us.robot_id = ${robotId};
        `);

        for (const { userSignalId } of userSignals) {
            await this.queueJob({ type: "userSignal", recalc, userSignalId });
        }

        for (const userId of uniqueElementsBy(
            userSignals.map(({ userId }) => userId),
            (a, b) => a === b
        )) {
            await this.queueAggrJob({ type: "userSignalsAggr", recalc, userId }, exchange, asset);
        }*/

        await this.queueAggrJob({ type: "allRobotsAggr", recalc }, exchange, asset);
        //TODO: PORTFOLIO */
    }

    async handleStatsCalcPortfolioEvent(params: TradeStatsRunnerPortfolio) {
        const { recalc, portfolioId } = params;

        this.log.info(`New ${TradeStatsRunnerEvents.PORTFOLIO} event - ${portfolioId}`);

        //TODO: PORTFOLIO
    }

    async handleCalcUserSignalEvent(params: TradeStatsRunnerUserSignal) {
        const { recalc, userId, robotId } = params;

        const userSignal: {
            userSignalId: string;
            exchange: string;
            asset: string;
        } = await this.db.pg.maybeOne(this.db.sql`
            SELECT us.id as user_signal_id, r.exchange, r.asset
            FROM user_signals us, robots r
            WHERE us.user_id = ${userId}
                AND us.robot_id = ${robotId}
                AND us.robot_id = r.id;
        `);

        if (!userSignal) return;

        const { userSignalId, exchange, asset } = userSignal;

        await this.queueJob({
            type: "userSignal",
            recalc,
            userSignalId
        });
        await this.queueAggrJob({ type: "userSignalsAggr", recalc, userId }, exchange, asset);
    }

    async handleStatsCalcUserRobotEvent(params: TradeStatsRunnerUserRobot) {
        const { recalc, userRobotId } = params;

        this.log.info(`New ${TradeStatsRunnerEvents.USER_ROBOT} event - ${userRobotId}`);
        const userRobot = await this.db.pg.maybeOne<{
            userId: string;
            exchange: string;
            asset: string;
        }>(this.db.sql`
            SELECT ur.user_id, r.exchange, r.asset
            FROM user_robots ur,
                    robots r
            WHERE ur.id = ${userRobotId}
                AND r.id = ur.robot_id;
        `);

        if (!userRobot) return;

        const { userId, exchange, asset } = userRobot;

        await this.queueJob({ type: "userRobot", recalc, userRobotId });
        await this.queueAggrJob({ type: "userRobotsAggr", recalc, userId }, exchange, asset);
        await this.queueAggrJob({ type: "allUserRobotsAggr", recalc }, exchange, asset);
    }

    async handleStatsCalcUserPortfolioEvent(params: TradeStatsRunnerUserPortfolio) {
        const { recalc, userPortfolioId } = params;

        this.log.info(`New ${TradeStatsRunnerEvents.USER_PORTFOLIO} event - ${userPortfolioId}`);

        //TODO: PORTFOLIO
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

        for (const { exchange, asset } of uniqueElementsBy(
            [...robots],
            (a, b) => a.exchange === b.exchange && a.asset === b.asset
        )) {
            await this.queueAggrJob({ type: "allRobotsAggr", recalc: true }, exchange, asset);
        }

        const userSignals = await this.db.pg.any<{
            userSignalId: string;
            userId: string;
            exchange: string;
            asset: string;
        }>(this.db.sql`
            SELECT us.id as user_signal_id, us.user_id, r.exchange, r.asset
            FROM user_signals us, robots r
            WHERE r.status = ${RobotStatus.started}
                AND us.robot_id = r.id
                ${conditionExchange}
                ${conditionAsset};
        `);
        for (const { userSignalId } of userSignals) {
            await this.queueJob({
                type: "userSignal",
                recalc: true,
                userSignalId
            });
        }

        for (const { userId, exchange, asset } of uniqueElementsBy(
            [...userSignals],
            (a, b) => a.userId === b.userId && a.exchange === b.exchange && a.asset === b.asset
        )) {
            await this.queueAggrJob({ type: "userSignalsAggr", recalc: true, userId }, exchange, asset);
        }
    }

    async handleRecalcAllPorfoliosEvent(params: TradeStatsRunnerRecalcAllPortfolios) {
        const { exchange } = params;

        const conditionExchange = !exchange ? this.db.sql`` : this.db.sql`AND r.exchange=${exchange}`;

        //TODO: PORTFOLIO
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

        for (const { userId, exchange, asset } of uniqueElementsBy(
            [...userRobots],
            (a, b) => a.userId === b.userId && a.exchange === b.exchange && a.asset === b.asset
        )) {
            await this.queueAggrJob({ type: "userRobotsAggr", recalc: true, userId }, exchange, asset);
        }

        for (const { exchange, asset } of uniqueElementsBy(
            [...userRobots],
            (a, b) => a.exchange === b.exchange && a.asset === b.asset
        )) {
            await this.queueAggrJob({ type: "allUserRobotsAggr", recalc: true }, exchange, asset);
        }
    }

    async handleRecalcAllUserPortfoliosEvent(params: TradeStatsRunnerRecalcAllUserPortfolios) {
        const { exchange, userId } = params;

        const conditionUserId = !userId ? this.db.sql`` : this.db.sql`AND ur.user_id=${userId}`;
        const conditionExchange = !exchange ? this.db.sql`` : this.db.sql`AND r.exchange=${exchange}`;

        //TODO: PORTFOLIO
    }

    async handleUserSignalDeletedEvent(params: TradeStatsRunnerUserSignalDeleted) {
        const { userId, robotId } = params;

        const robot: {
            exchange: string;
            asset: string;
        } = await this.db.pg.maybeOne(this.db.sql`
            SELECT exchange, asset
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!robot) return;

        const { exchange, asset } = robot;

        await this.queueAggrJob({ type: "userSignalsAggr", recalc: true, userId }, exchange, asset);
    }

    async handleUserRobotDeletedEvent(params: { userId: string; robotId: string }) {
        const { userId, robotId } = params;

        const robot: {
            exchange: string;
            asset: string;
        } = await this.db.pg.maybeOne(this.db.sql`
            SELECT exchange, asset
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!robot) return;

        const { exchange, asset } = robot;

        await this.queueAggrJob({ type: "userRobotsAggr", recalc: true, userId }, exchange, asset);
        await this.queueAggrJob({ type: "allUserRobotsAggr", recalc: true }, exchange, asset);
    }
}
