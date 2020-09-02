import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { Queue } from "bullmq";
//import { v4 as uuid } from "uuid";
import {
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

    constructor(config?: StatisticCalcWorkerServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                calcUserSignal: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_SIGNAL],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this.HTTPHandler.bind(this, this.handleCalcUserSignalEvent)
                },
                calcUserSignals: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_SIGNALS],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this.HTTPHandler.bind(this, this.handleCalcUserSignalsEvent)
                },
                calcRobot: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.ROBOT],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this.HTTPHandler.bind(this, this.handleStatsCalcRobotEvent)
                },
                calcRobots: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.ROBOTS],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this.HTTPHandler.bind(this, this.handleStatsCalcRobotsEvent)
                },
                calcUserRobot: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_ROBOT],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this.HTTPHandler.bind(this, this.handleStatsCalcUserRobotEvent)
                },
                calcUserRobots: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_ROBOTS],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this.HTTPHandler.bind(this, this.handleStatsCalcUserRobotsEvent)
                },
                recalcAllRobots: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.RECALC_ALL_ROBOTS],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this.HTTPHandler.bind(this, this.handleRecalcAllRobotsEvent)
                },
                recalcAllUserSignals: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.RECALC_ALL_USER_SIGNALS],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this.HTTPHandler.bind(this, this.handleRecalcAllUserSignalsEvent)
                },
                recalcAllUserRobots: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.RECALC_ALL_USER_ROBOTS],
                    auth: true,
                    roles: [UserRoles.admin],
                    handler: this.HTTPHandler.bind(this, this.handleRecalcAllUserRobotsEvent)
                }
            });
            this.events.subscribe({
                [StatsCalcRunnerEvents.USER_SIGNAL]: {
                    schema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_SIGNAL],
                    handler: this.handleCalcUserSignalEvent.bind(this)
                },
                [StatsCalcRunnerEvents.USER_SIGNALS]: {
                    schema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_SIGNALS],
                    handler: this.handleCalcUserSignalsEvent.bind(this)
                },
                [StatsCalcRunnerEvents.ROBOT]: {
                    schema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.ROBOT],
                    handler: this.handleStatsCalcRobotEvent.bind(this)
                },
                [StatsCalcRunnerEvents.ROBOTS]: {
                    schema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.ROBOTS],
                    handler: this.handleStatsCalcRobotsEvent.bind(this)
                },
                [StatsCalcRunnerEvents.USER_ROBOT]: {
                    schema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_ROBOT],
                    handler: this.handleStatsCalcUserRobotEvent.bind(this)
                },
                [StatsCalcRunnerEvents.USER_ROBOTS]: {
                    schema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_ROBOTS],
                    handler: this.handleStatsCalcUserRobotsEvent.bind(this)
                }
            });
            this.addOnStartHandler(this.onStartService);
            this.addOnStopHandler(this.onStopService);
        } catch (err) {
            this.log.error(err, "While consctructing StatisticCalcRunnerService");
        }
    }

    async onStartService() {
        this.queues = {
            calcStatistics: new Queue("calcStatistics", { connection: this.redis })
        };
    }

    async onStopService() {
        await this.queues.calcStatistics?.close();
    }

    async HTTPHandler(
        handler: {
            (params: StatsCalcJob): Promise<{
                success: boolean,
                error?: string
            }>
        },
        req: {
            body: {
                input: StatsCalcJob;
            };
        },
        res: any
    ) {
        const result = await handler(req.body.input);
        res.send(result);
        res.end();
    }

    async queueJob(type: StatsCalcJobType, job: StatsCalcJob) {
        await this.queues.calcStatistics.add(
            type,
            job,
            {
                //jobId: uuid(),
                removeOnComplete: true,
                removeOnFail: true
            }
        );
    }

    handleCalcUserSignalEvent = async (params: {
        calcAll?: boolean, userId: string, robotId: string
    }) => {
        const { calcAll, userId, robotId } = params;

        try {
            const {
                exchange,
                asset,
            }: { exchange: string; asset: string } = await this.db.pg.maybeOne(this.db.sql`
                SELECT exchange, asset
                FROM robots
                WHERE id = ${robotId};
            `);
            const userSignalCount = +(await this.db.pg.oneFirst(this.db.sql`
                SELECT COUNT(*)
                FROM user_signals
                WHERE user_id = ${userId}
                  AND robot_id = ${robotId};
            `));

            if (userSignalCount == 1) {
                await this.queueJob(StatsCalcJobType.userSignalsAggr, {
                    calcAll,
                    userId
                });
            }

            await this.queueJob(StatsCalcJobType.userSignal, {
                calcAll,
                userId,
                robotId
            });
            await this.queueJob(StatsCalcJobType.userSignalsAggr, {
                calcAll,
                userId,
                exchange
            });
            await this.queueJob(StatsCalcJobType.userSignalsAggr, {
                calcAll,
                userId,
                asset
            });
            await this.queueJob(StatsCalcJobType.userSignalsAggr, {
                calcAll,
                userId,
                exchange,
                asset
            });
            return { success: true };
        } catch (e) {
            this.log.error(e);
            return { success: false, error: e.message };
        }
    }

    handleCalcUserSignalsEvent = async (params: {
        calcAll?: boolean, userId: string
    }) => {
        const { calcAll, userId } = params;

        try {
            const userSignals: { robotId: string }[] = await this.db.pg.any(this.db.sql`
                SELECT robot_id
                FROM user_signals
                WHERE user_id = ${userId};
            `);
            if (userSignals.length === 0)
                return;

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
            if (exchangesAssets.length === 0)
                return;

            await this.queueJob(StatsCalcJobType.userSignalsAggr, {
                calcAll,
                userId
            });

            const exchanges = [...new Set(exchangesAssets.map((e) => e.exchange))];
            for (const exchange of exchanges) {
                await this.queueJob(StatsCalcJobType.userSignalsAggr, {
                    calcAll,
                    userId,
                    exchange
                });
            }

            const assets = [...new Set(exchangesAssets.map((e) => e.asset))];
            for (const asset of assets) {
                await this.queueJob(StatsCalcJobType.userSignalsAggr, {
                    calcAll,
                    userId,
                    asset
                });
            }

            for (const { exchange, asset } of exchangesAssets) {
                await this.queueJob(StatsCalcJobType.userSignalsAggr, {
                    calcAll,
                    userId,
                    exchange,
                    asset
                });
            }

            return { success: true };
        } catch (e) {
            this.log.error(e);
            return { success: false, error: e.message };
        }
    }

    handleStatsCalcRobotEvent = async (params: {
        calcAll?: boolean, robotId: string
    }) => {
        const { calcAll, robotId } = params;

        try {
            this.log.info(`New ${StatsCalcRunnerEvents.ROBOT} event - ${robotId}`);

            const {
                exchange,
                asset,
            }: { exchange: string; asset: string } = await this.db.pg.maybeOne(this.db.sql`
                SELECT exchange, asset
                FROM robots
                WHERE id = ${robotId};
            `);
            await this.queueJob(StatsCalcJobType.robot, { calcAll, robotId });
            await this.queueJob(StatsCalcJobType.userSignals, { calcAll, robotId });
            await this.queueJob(StatsCalcJobType.robotsAggr, { calcAll, exchange });
            await this.queueJob(StatsCalcJobType.robotsAggr, { calcAll, asset });
            await this.queueJob(StatsCalcJobType.robotsAggr, { calcAll, exchange, asset });

            const usersByRobotId: {
                userId: string
            }[] = await this.db.pg.any(this.db.sql`
                SELECT user_id
                FROM user_signals
                WHERE robot_id = ${robotId}
                GROUP BY user_id;
            `);

            for (const { userId } of usersByRobotId) {
                await this.queueJob(StatsCalcJobType.userSignalsAggr, { calcAll, userId });
            }

            const usersByExchange: {
                userId: string
            }[] = await this.db.pg.any(this.db.sql`
                SELECT us.user_id
                FROM user_signals us, robots r
                WHERE r.id = ${robotId}
                  AND r.exchange = ${exchange}
                  AND us.robot_id = r.id
                GROUP BY us.user_id;
            `);

            for (const { userId } of usersByExchange) {
                await this.queueJob(StatsCalcJobType.userSignalsAggr, { calcAll, userId, exchange });
            }

            const usersByAsset: {
                userId: string
            }[] = await this.db.pg.any(this.db.sql`
                SELECT us.user_id
                FROM user_signals us, robots r
                WHERE r.id = ${robotId}
                  AND r.asset = ${asset}
                  AND us.robot_id = r.id
                GROUP BY us.user_id;
            `);

            for (const { userId } of usersByAsset) {
                await this.queueJob(StatsCalcJobType.userSignalsAggr, { calcAll, userId, asset });
            }

            const usersByExchangeAsset: {
                userId: string
            }[] = await this.db.pg.any(this.db.sql`
                SELECT us.user_id
                FROM user_signals us, robots r
                WHERE r.id = ${robotId}
                  AND r.exchange = ${exchange}
                  AND r.asset = ${asset}
                  AND us.robot_id = r.id
                GROUP BY us.user_id;
            `);

            for (const { userId } of usersByExchangeAsset) {
                await this.queueJob(StatsCalcJobType.userSignalsAggr, { calcAll, userId, exchange, asset });
            }

            return { success: true };
        } catch (e) {
            this.log.error(e);
            return { success: false, error: e.message };
        }
    }

    handleStatsCalcRobotsEvent = async (params: {
        calcAll: boolean
    }) => {
        const { calcAll } = params;

        try {
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
            return { success: true };
        } catch (e) {
            this.log.error(e);
            return { success: false, error: e.message };
        }
    }

    handleStatsCalcUserRobotEvent = async (params: {
        calcAll?: boolean, userRobotId: string
    }) => {
        const { calcAll, userRobotId } = params;

        try {
            this.log.info(
                `New ${StatsCalcRunnerEvents.USER_ROBOT} event - ${userRobotId}`
            );
            const { userId, exchange, asset } = await this.db.pg.maybeOne(this.db.sql`
                SELECT ur.user_id, r.exchange, r.asset
                FROM user_robots ur,
                     robots r
                WHERE ur.id = ${userRobotId}
                  AND r.id = ur.robot_id;
            `);

            await this.queueJob(StatsCalcJobType.userRobot, { calcAll, userRobotId });
            await this.queueJob(StatsCalcJobType.userRobotAggr, { calcAll, userId });
            await this.queueJob(StatsCalcJobType.userRobotAggr, { calcAll, userId, exchange });
            await this.queueJob(StatsCalcJobType.userRobotAggr, { calcAll, userId, asset });
            //await this.queueJob(StatsCalcJobType.userRobotAggr, { calcAll, userId, asset });
            await this.queueJob(StatsCalcJobType.userRobotAggr, { calcAll, userId, exchange, asset });
            await this.queueJob(StatsCalcJobType.usersRobotsAggr, { calcAll, exchange });
            await this.queueJob(StatsCalcJobType.usersRobotsAggr, { calcAll, asset });
            await this.queueJob(StatsCalcJobType.usersRobotsAggr, { calcAll, exchange, asset });

            return { success: true };
        } catch (e) {
            this.log.error(e);
            return { success: false, error: e.message };
        }
    }

    handleStatsCalcUserRobotsEvent = async (params: {
        calcAll?: boolean, userId: string, exchange?: string, asset?: string
    }) => {
        const { calcAll, userId, exchange, asset } = params;

        try {
            this.log.info(
                `New ${StatsCalcRunnerEvents.USER_ROBOTS} event - ${userId}, ${exchange}, ${asset}`
            );

            await this.queueJob(StatsCalcJobType.userRobotAggr, { calcAll, userId });
            await this.queueJob(StatsCalcJobType.userRobotAggr, { calcAll, userId, exchange });
            await this.queueJob(StatsCalcJobType.userRobotAggr, { calcAll, userId, asset });
            await this.queueJob(StatsCalcJobType.userRobotAggr, { calcAll, userId, exchange, asset });
            await this.queueJob(StatsCalcJobType.usersRobotsAggr, { calcAll, exchange });
            await this.queueJob(StatsCalcJobType.usersRobotsAggr, { calcAll, asset });
            await this.queueJob(StatsCalcJobType.usersRobotsAggr, { calcAll, exchange, asset });

            return { success: true };
        } catch (e) {
            this.log.error(e);
            return { success: false, error: e.message };
        }
    }

    handleRecalcAllRobotsEvent = async (params: {
        exchange?: string, asset?: string, currency?: string, strategy?: string
    }) => {
        const { exchange, asset, currency, strategy } = params;

        try {
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
                await this.handleStatsCalcRobotEvent({ robotId, calcAll: true });
            }

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

            return { success: true };
        } catch (e) {
            this.log.error(e);
            return { success: false, error: e.message };
        }
    }

    handleRecalcAllUserSignalsEvent = async (params: {
        exchange?: string, asset?: string, currency?: string, strategy?: string,
        robotId?: string, userId?: string
    }) => {
        const { exchange, asset, currency, strategy, robotId, userId } = params;

        try {
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

            return { success: true };
        } catch (e) {
            this.log.error(e);
            return { success: false, error: e.message };
        }
    }

    handleRecalcAllUserRobotsEvent = async (params: {
        exchange?: string, asset?: string, currency?: string, strategy?: string,
        robotId?: string, userId?: string
    }) => {
        const { exchange, asset, currency, strategy, robotId, userId } = params;

        try {
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
                await this.handleStatsCalcUserRobotEvent({ userRobotId, calcAll: true });
            }

            return { success: true };
        } catch (e) {
            this.log.error(e);
            return { success: false, error: e.message };
        }
    }
}