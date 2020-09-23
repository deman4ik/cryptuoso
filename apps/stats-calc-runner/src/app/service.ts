import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { Queue, QueueEvents } from "bullmq";
import RedLock from "redlock";
import {
    STATS_CALC_PREFIX,
    StatsCalcJob,
    StatsCalcJobType,
    StatsCalcRunnerEvents,
    StatsCalcRunnerSchema
} from "@cryptuoso/stats-calc-events";
import { RobotStatus } from "@cryptuoso/robot-state";
import { UserRoles } from "@cryptuoso/user-state";

export type StatisticCalcWorkerServiceConfig = HTTPServiceConfig;

export default class StatisticCalcRunnerService extends HTTPService {
    queues: { [key: string]: Queue<any> };
    queueEvents: { [key: string]: QueueEvents };
    locker: RedLock;

    constructor(config?: StatisticCalcWorkerServiceConfig) {
        super(config);
        try {
            this.locker = new RedLock([this.redis], {
                driftFactor: 0.01,
                retryCount: 0
            });

            this.createRoutes({
                calcUserSignal: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_SIGNAL],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this._HTTPHandler.bind(this, this.handleCalcUserSignalEvent.bind(this))
                },
                calcUserSignals: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_SIGNALS],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this._HTTPHandler.bind(this, this.handleCalcUserSignalsEvent.bind(this))
                },
                calcRobot: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.ROBOT],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this._HTTPHandler.bind(this, this.handleStatsCalcRobotEvent.bind(this))
                },
                calcRobots: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.ROBOTS],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this._HTTPHandler.bind(this, this.handleStatsCalcRobotsEvent.bind(this))
                },
                calcUserRobot: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_ROBOT],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this._HTTPHandler.bind(this, this.handleStatsCalcUserRobotEvent.bind(this))
                },
                calcUserRobots: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_ROBOTS],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this._HTTPHandler.bind(this, this.handleStatsCalcUserRobotsEvent.bind(this))
                },
                recalcAllRobots: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.RECALC_ALL_ROBOTS],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this._HTTPHandler.bind(this, this.handleRecalcAllRobotsEvent.bind(this))
                },
                recalcAllUserSignals: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.RECALC_ALL_USER_SIGNALS],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this._HTTPHandler.bind(this, this.handleRecalcAllUserSignalsEvent.bind(this))
                },
                recalcAllUserRobots: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.RECALC_ALL_USER_ROBOTS],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this._HTTPHandler.bind(this, this.handleRecalcAllUserRobotsEvent.bind(this))
                }
            });
            this.events.subscribe({
                [StatsCalcRunnerEvents.USER_SIGNAL]: {
                    schema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_SIGNAL],
                    handler: this._eventsHandler.bind(this, this.handleCalcUserSignalEvent.bind(this))
                },
                [StatsCalcRunnerEvents.USER_SIGNALS]: {
                    schema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_SIGNALS],
                    handler: this._eventsHandler.bind(this, this.handleCalcUserSignalsEvent.bind(this))
                },
                [StatsCalcRunnerEvents.ROBOT]: {
                    schema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.ROBOT],
                    handler: this._eventsHandler.bind(this, this.handleStatsCalcRobotEvent.bind(this))
                },
                [StatsCalcRunnerEvents.ROBOTS]: {
                    schema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.ROBOTS],
                    handler: this._eventsHandler.bind(this, this.handleStatsCalcRobotsEvent.bind(this))
                },
                [StatsCalcRunnerEvents.USER_ROBOT]: {
                    schema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_ROBOT],
                    handler: this._eventsHandler.bind(this, this.handleStatsCalcUserRobotEvent.bind(this))
                },
                [StatsCalcRunnerEvents.USER_ROBOTS]: {
                    schema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_ROBOTS],
                    handler: this._eventsHandler.bind(this, this.handleStatsCalcUserRobotsEvent.bind(this))
                }
            });
            this.addOnStartHandler(this._onStartService);
            this.addOnStopHandler(this._onStopService);
        } catch (err) {
            this.log.error(err, "While consctructing StatisticCalcRunnerService");
        }
    }

    async _onStartService() {
        this.queues = {
            calcStatistics: new Queue("calcStatistics", { connection: this.redis })
        };
        this.queueEvents = {
            calcStatistics: new QueueEvents("calcStatistics", { connection: this.redis })
        };

        this.queueEvents.calcStatistics.on("failed", this._queueFailHandler.bind(this));
    }

    async _onStopService() {
        await this.queues?.calcStatistics?.close();
        await this.queueEvents?.calcStatistics?.close();
        //await this.locker?.quit();
    }

    async _HTTPHandler(
        handler: {
            (params: StatsCalcJob): Promise<void>;
        },
        req: {
            body: {
                input: StatsCalcJob;
            };
        },
        res: any
    ) {
        try {
            await handler(req.body.input);

            res.send({ success: true });
        } catch (err) {
            res.send({ success: false, error: err.message });
        }

        res.end();
    }

    async _eventsHandler(
        handler: {
            (params: StatsCalcJob): Promise<void>;
        },
        params: StatsCalcJob
    ) {
        try {
            await handler(params);

            return { success: true };
        } catch (err) {
            this.log.error(err);
            return { success: false, error: err.message };
        }
    }

    async _queueFailHandler(args: { jobId: string; failedReason: string; prev?: string }) {
        const { jobId } = args;

        try {
            await this.locker.lock(`lock:${this.name}:error.${jobId}`, 5e3);

            const { name, data } = await this.queues.calcStatistics.getJob(jobId);

            await this.events.emit({
                type: `errors.${STATS_CALC_PREFIX}.${name}`,
                data
            });

            // await sleep(...);
            // await lock.unlock();
        } catch (err) {
            this.log.error(err);
        }
    }

    async queueJob(type: StatsCalcJobType, job: StatsCalcJob) {
        await this.queues.calcStatistics.add(type, job, {
            removeOnComplete: true,
            removeOnFail: 100,
            attempts: 3,
            backoff: { type: "exponential", delay: 10000 }
        });
    }

    async queueJobWithExchangeAssetOption(
        type: StatsCalcJobType,
        job: StatsCalcJob,
        exchange?: string,
        asset?: string
    ) {
        await this.queueJob(type, job);
        if (exchange) await this.queueJob(type, { ...job, exchange });
        if (asset) await this.queueJob(type, { ...job, asset });
        if (exchange && asset) await this.queueJob(type, { ...job, exchange, asset });
    }

    async handleCalcUserSignalEvent(params: { calcAll?: boolean; userId: string; robotId: string }) {
        const { calcAll, userId, robotId } = params;

        const userSignal: {
            exchange: string;
            asset: string;
        } = await this.db.pg.maybeOne(this.db.sql`
            SELECT r.exchange, r.asset
            FROM user_signals us, robots r
            WHERE us.user_id = ${userId}
                AND us.robot_id = ${robotId}
                AND us.robot_id = r.id;
        `);

        if (!userSignal) return;

        const { exchange, asset } = userSignal;

        await this.queueJob(StatsCalcJobType.userSignal, {
            calcAll,
            userId,
            robotId
        });
        await this.queueJobWithExchangeAssetOption(
            StatsCalcJobType.userSignalsAggr,
            { calcAll, userId },
            exchange,
            asset
        );
    }

    async handleCalcUserSignalsEvent(params: { calcAll?: boolean; userId: string }) {
        const { calcAll, userId } = params;

        const userSignals: { robotId: string }[] = await this.db.pg.any(this.db.sql`
            SELECT robot_id
            FROM user_signals
            WHERE user_id = ${userId};
        `);
        if (userSignals.length === 0) return;

        for (const { robotId } of userSignals) {
            await this.queueJob(StatsCalcJobType.userSignal, {
                calcAll,
                userId,
                robotId
            });
        }

        const exchangesAssets: {
            exchange: string;
            asset: string;
        }[] = await this.db.pg.any(this.db.sql`
            SELECT r.exchange, r.asset
            FROM user_signals us, robots r 
            WHERE us.user_id = ${userId}
                AND us.robot_id = r.id
            GROUP BY r.exchange, r.asset;
        `);
        if (exchangesAssets.length === 0) return;

        await this.queueJob(StatsCalcJobType.userSignalsAggr, {
            calcAll,
            userId
        });

        const exchangesSet = new Set(exchangesAssets.map((e) => e.exchange));
        exchangesSet.delete(null);
        const exchanges = [...exchangesSet];
        for (const exchange of exchanges) {
            await this.queueJob(StatsCalcJobType.userSignalsAggr, {
                calcAll,
                userId,
                exchange
            });
        }

        const assetsSet = new Set(exchangesAssets.map((e) => e.asset));
        assetsSet.delete(null);
        const assets = [...assetsSet];
        for (const asset of assets) {
            await this.queueJob(StatsCalcJobType.userSignalsAggr, {
                calcAll,
                userId,
                asset
            });
        }

        for (const { exchange, asset } of exchangesAssets) {
            if (exchange && asset)
                await this.queueJob(StatsCalcJobType.userSignalsAggr, {
                    calcAll,
                    userId,
                    exchange,
                    asset
                });
        }
    }

    async handleStatsCalcRobotEvent(
        params: {
            calcAll?: boolean;
            robotId: string;
        },
        needCalcCommonAggr = true
    ) {
        const { calcAll, robotId } = params;

        this.log.info(`New ${StatsCalcRunnerEvents.ROBOT} event - ${robotId}`);

        const { exchange, asset }: { exchange: string; asset: string } = await this.db.pg.maybeOne(this.db.sql`
            SELECT exchange, asset
            FROM robots
            WHERE id = ${robotId};
        `);
        await this.queueJob(StatsCalcJobType.robot, { calcAll, robotId });
        await this.queueJob(StatsCalcJobType.userSignals, { calcAll, robotId });

        if (needCalcCommonAggr) {
            await this.queueJobWithExchangeAssetOption(StatsCalcJobType.robotsAggr, { calcAll }, exchange, asset);
        }

        const usersByRobotId: {
            userId: string;
            exchange: string;
            asset: string;
        }[] = await this.db.pg.any(this.db.sql`
            SELECT us.user_id, r.exchange, r.asset
            FROM user_signals us, robots r
            WHERE us.robot_id = ${robotId}
                AND us.robot_id = r.id;
        `);

        for (const { userId, exchange: uExchange, asset: uAsset } of usersByRobotId) {
            await this.queueJobWithExchangeAssetOption(
                StatsCalcJobType.userSignalsAggr,
                { calcAll, userId },
                uExchange == exchange ? uExchange : null,
                uAsset == asset ? uAsset : null
            );
        }
    }

    async handleStatsCalcRobotsEvent(params: { calcAll?: boolean }) {
        const { calcAll } = params;

        const startedRobots: {
            id: string;
        }[] = await this.db.pg.any(this.db.sql`
            SELECT id
            FROM robots
            WHERE status = ${RobotStatus.started};
        `);

        for (const { id: robotId } of startedRobots) {
            await this.handleStatsCalcRobotEvent({ calcAll, robotId });
        }
    }

    async handleStatsCalcUserRobotEvent(
        params: {
            calcAll?: boolean;
            userRobotId: string;
        },
        needCalcCommonAggr = true
    ) {
        const { calcAll, userRobotId } = params;

        this.log.info(`New ${StatsCalcRunnerEvents.USER_ROBOT} event - ${userRobotId}`);
        const { userId, exchange, asset } = await this.db.pg.maybeOne(this.db.sql`
            SELECT ur.user_id, r.exchange, r.asset
            FROM user_robots ur,
                    robots r
            WHERE ur.id = ${userRobotId}
                AND r.id = ur.robot_id;
        `);

        await this.queueJob(StatsCalcJobType.userRobot, { calcAll, userRobotId });

        if (needCalcCommonAggr) {
            await this.queueJobWithExchangeAssetOption(StatsCalcJobType.usersRobotsAggr, { calcAll }, exchange, asset);
        }

        await this.queueJobWithExchangeAssetOption(
            StatsCalcJobType.userRobotAggr,
            { calcAll, userId },
            exchange,
            asset
        );
    }

    async handleStatsCalcUserRobotsEvent(
        params: {
            calcAll?: boolean;
            userId: string;
            exchange?: string;
            asset?: string;
        },
        needCalcCommonAggr = true
    ) {
        const { calcAll, userId, exchange, asset } = params;

        this.log.info(`New ${StatsCalcRunnerEvents.USER_ROBOTS} event - ${userId}, ${exchange}, ${asset}`);

        await this.queueJobWithExchangeAssetOption(
            StatsCalcJobType.userRobotAggr,
            { calcAll, userId },
            exchange,
            asset
        );

        if (needCalcCommonAggr) {
            await this.queueJobWithExchangeAssetOption(StatsCalcJobType.usersRobotsAggr, { calcAll }, exchange, asset);
        }
    }

    async handleRecalcAllRobotsEvent(params: {
        exchange?: string;
        asset?: string;
        currency?: string;
        strategy?: string;
    }) {
        const { exchange, asset, currency, strategy } = params;

        const conditionExchange = !exchange ? this.db.sql`` : this.db.sql`AND r.exchange=${exchange}`;
        const conditionAsset = !asset ? this.db.sql`` : this.db.sql`AND r.asset=${asset}`;
        const conditionCurrency = !currency ? this.db.sql`` : this.db.sql`AND r.currency=${currency}`;
        const conditionStrategy = !strategy ? this.db.sql`` : this.db.sql`AND r.strategy=${strategy}`;

        const startedRobots: {
            id: string;
        }[] = await this.db.pg.any(this.db.sql`
            SELECT r.id
            FROM robots r
            WHERE r.status = ${RobotStatus.started}
                ${conditionExchange}
                ${conditionAsset}
                ${conditionCurrency}
                ${conditionStrategy};
        `);
        for (const { id: robotId } of startedRobots) {
            await this.handleStatsCalcRobotEvent({ robotId, calcAll: true }, false);
        }

        await this.queueJobWithExchangeAssetOption(StatsCalcJobType.robotsAggr, { calcAll: true }, exchange, asset);

        const startedSignals: {
            robotId: string;
            userId: string;
        }[] = await this.db.pg.any(this.db.sql`
            SELECT us.robot_id, us.user_id
            FROM user_signals us, robots r
            WHERE r.status = ${RobotStatus.started}
                AND us.robot_id = r.id
                ${conditionExchange}
                ${conditionAsset}
                ${conditionCurrency}
                ${conditionStrategy};
        `);
        for (const { robotId, userId } of startedSignals) {
            await this.handleCalcUserSignalEvent({ robotId, userId, calcAll: true });
        }
    }

    async handleRecalcAllUserSignalsEvent(params: {
        exchange?: string;
        asset?: string;
        currency?: string;
        strategy?: string;
        robotId?: string;
        userId?: string;
    }) {
        const { exchange, asset, currency, strategy, robotId, userId } = params;

        const conditionRobotId = !robotId ? this.db.sql`` : this.db.sql`AND us.robot_id=${robotId}`;
        const conditionUserId = !userId ? this.db.sql`` : this.db.sql`AND us.user_id=${userId}`;
        const conditionExchange = !exchange ? this.db.sql`` : this.db.sql`AND r.exchange=${exchange}`;
        const conditionAsset = !asset ? this.db.sql`` : this.db.sql`AND r.asset=${asset}`;
        const conditionCurrency = !currency ? this.db.sql`` : this.db.sql`AND r.currency=${currency}`;
        const conditionStrategy = !strategy ? this.db.sql`` : this.db.sql`AND r.strategy=${strategy}`;

        const startedSignals: {
            robotId: string;
            userId: string;
        }[] = await this.db.pg.any(this.db.sql`
            SELECT us.robot_id, us.user_id
            FROM user_signals us, robots r
            WHERE r.status = ${RobotStatus.started}
                ${conditionRobotId}
                ${conditionUserId}
                AND us.robot_id = r.id
                ${conditionExchange}
                ${conditionAsset}
                ${conditionCurrency}
                ${conditionStrategy}
        `);
        for (const { robotId, userId } of startedSignals) {
            await this.handleCalcUserSignalEvent({ robotId, userId, calcAll: true });
        }
    }

    async handleRecalcAllUserRobotsEvent(params: {
        exchange?: string;
        asset?: string;
        currency?: string;
        strategy?: string;
        robotId?: string;
        userId?: string;
    }) {
        const { exchange, asset, currency, strategy, robotId, userId } = params;

        const conditionRobotId = !robotId ? this.db.sql`` : this.db.sql`AND ur.robot_id=${robotId}`;
        const conditionUserId = !userId ? this.db.sql`` : this.db.sql`AND ur.user_id=${userId}`;
        const conditionExchange = !exchange ? this.db.sql`` : this.db.sql`AND r.exchange=${exchange}`;
        const conditionAsset = !asset ? this.db.sql`` : this.db.sql`AND r.asset=${asset}`;
        const conditionCurrency = !currency ? this.db.sql`` : this.db.sql`AND r.currency=${currency}`;
        const conditionStrategy = !strategy ? this.db.sql`` : this.db.sql`AND r.strategy=${strategy}`;

        const startedUserRobots: {
            id: string;
        }[] = await this.db.pg.any(this.db.sql`
            SELECT ur.id
            FROM user_robots ur, robots r
            WHERE r.status = ${RobotStatus.started}
                ${conditionRobotId}
                ${conditionUserId}
                AND ur.robot_id = r.id
                ${conditionExchange}
                ${conditionAsset}
                ${conditionCurrency}
                ${conditionStrategy};
        `);
        for (const { id: userRobotId } of startedUserRobots) {
            await this.handleStatsCalcUserRobotEvent({ userRobotId, calcAll: true }, false);
        }

        await this.queueJobWithExchangeAssetOption(
            StatsCalcJobType.usersRobotsAggr,
            { calcAll: true },
            exchange,
            asset
        );
    }
}
