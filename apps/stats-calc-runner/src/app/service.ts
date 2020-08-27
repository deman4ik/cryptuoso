import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { Queue } from "bullmq";
import { v4 as uuid } from "uuid";
import {
    StatsCalcJob,
    StatsCalcJobType,
    StatsCalcRunnerEvents,
    StatsCalcRunnerSchema
} from "@cryptuoso/stats-calc-events";
import { RobotStatus } from "@cryptuoso/robot-state";
import { UserSignals } from "@cryptuoso/user-state";

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
                    roles: ["manager", "admin"],
                    handler: (req, res) => this.HTTPHandler(
                        this.handleCalcUserSignalEvent.bind(this), req, res
                    )
                },
                calcUserSignals: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_SIGNALS],
                    auth: true,
                    roles: ["manager", "admin"],
                    handler: (req, res) => this.HTTPHandler(
                        this.handleCalcUserSignalsEvent.bind(this), req, res
                    )
                },
                calcRobot: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.ROBOT],
                    auth: true,
                    roles: ["manager", "admin"],
                    handler: (req, res) => this.HTTPHandler(
                        this.handleStatsCalcRobotEvent.bind(this), req, res
                    )
                },
                calcRobots: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.ROBOTS],
                    auth: true,
                    roles: ["manager", "admin"],
                    handler: (req, res) => this.HTTPHandler(
                        this.handleStatsCalcRobotsEvent.bind(this), req, res
                    )
                },
                calcUserRobot: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_ROBOT],
                    auth: true,
                    roles: ["manager", "admin"],
                    handler: (req, res) => this.HTTPHandler(
                        this.handleStatsCalcUserRobotEvent.bind(this), req, res
                    )
                },
                calcUserRobots: {
                    inputSchema: StatsCalcRunnerSchema[StatsCalcRunnerEvents.USER_ROBOTS],
                    auth: true,
                    roles: ["manager", "admin"],
                    handler: (req, res) => this.HTTPHandler(
                        this.handleStatsCalcUserRobotsEvent.bind(this), req, res
                    )
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
            { id: uuid(), ...job },
            { removeOnComplete: true }
        );
    }

    async handleCalcUserSignalEvent(
        { calcAll, userId, robotId }: StatsCalcJob
    ) {
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

    async handleCalcUserSignalsEvent(
        { calcAll, userId }: StatsCalcJob
    ) {
        try {
            const userSignals: UserSignals[] = await this.db.pg.any(this.db.sql`
                SELECT *
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

    async handleStatsCalcRobotEvent(
        { calcAll, robotId }: StatsCalcJob
    ) {
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

    async handleStatsCalcRobotsEvent({ calcAll }: StatsCalcJob) {
        try {
            const startedRobots: {
                id: string;
            }[] = await this.db.pg.any(this.db.sql`
                SELECT id, exchange, asset
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

    async handleStatsCalcUserRobotEvent(
        { calcAll, userRobotId }: StatsCalcJob
    ) {
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
            await this.queueJob(StatsCalcJobType.userRobotAggr, { calcAll, userId, asset });
            await this.queueJob(StatsCalcJobType.userRobotAggr, { calcAll, userId, exchange, asset });

            return { success: true };
        } catch (e) {
            this.log.error(e);
            return { success: false, error: e.message };
        }
    }

    async handleStatsCalcUserRobotsEvent(
        { calcAll, userId, exchange, asset }: StatsCalcJob
    ) {
        try {
            this.log.info(
                `New ${StatsCalcRunnerEvents.USER_ROBOTS} event - ${userId}, ${exchange}, ${asset}`
            );

            await this.queueJob(StatsCalcJobType.userRobotAggr, { calcAll, userId });
            await this.queueJob(StatsCalcJobType.userRobotAggr, { calcAll, userId, exchange });
            await this.queueJob(StatsCalcJobType.userRobotAggr, { calcAll, userId, asset });
            await this.queueJob(StatsCalcJobType.userRobotAggr, { calcAll, userId, exchange, asset });

            return { success: true };
        } catch (e) {
            this.log.error(e);
            return { success: false, error: e.message };
        }
    }
}