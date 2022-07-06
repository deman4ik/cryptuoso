import { formatExchange, GenericObject } from "@cryptuoso/helpers";
import { sql } from "@cryptuoso/postgres";
import { HTTPService, HTTPServiceConfig, RequestExtended } from "@cryptuoso/service";
import { User, UserExchangeAccount, UserExchangeAccStatus, UserRoles } from "@cryptuoso/user-state";
import {
    Queues,
    UserPositionOrderStatus,
    UserPositionStatus,
    UserRobotDB,
    UserRobotJob,
    UserRobotJobType,
    UserRobotRunnerJobType,
    UserRobotStatus
} from "@cryptuoso/user-robot-state";
import {
    UserPortfolioStatus,
    UserRobotRunnerEvents,
    UserRobotRunnerPause,
    UserRobotRunnerResume,
    UserRobotRunnerSchema,
    UserRobotRunnerStart,
    UserRobotRunnerStartPortfolio,
    UserRobotRunnerStop,
    UserRobotRunnerStopPortfolio,
    UserRobotRunnerStopUserPortfolioDedicatedRobots,
    UserRobotRunnerSyncUserPortfolioDedicatedRobots,
    UserRobotWorkerEvents,
    UserRobotWorkerStatus,
    USER_ROBOT_WORKER_TOPIC
} from "@cryptuoso/user-robot-events";
import {
    ConnectorWorkerEvents,
    ConnectorWorkerSchema,
    OrdersErrorEvent,
    OrdersStatusEvent,
    UserExchangeAccountErrorEvent
} from "@cryptuoso/connector-events";
import { ActionsHandlerError, BaseError } from "@cryptuoso/errors";
import dayjs from "@cryptuoso/dayjs";
import { Job } from "bullmq";
import { SignalEvents, SignalSchema } from "@cryptuoso/robot-events";
import { Event } from "@cryptuoso/events";
import { OrderStatus, SignalEvent, TradeAction } from "@cryptuoso/market";
import { UserSub } from "@cryptuoso/billing";
import { GA } from "@cryptuoso/analytics";
import {
    PortfolioDB,
    PortfolioRobotDB,
    PortfolioSettings,
    UserPortfolioDB,
    UserPortfolioState
} from "@cryptuoso/portfolio-state";
import {
    PortfolioManagerBuildUserPortfolio,
    PortfolioManagerInEvents,
    PortfolioManagerOutEvents,
    PortfolioManagerOutSchema,
    PortfolioManagerPortfolioBuilded,
    PortfolioManagerUserPortfolioBuilded,
    PortfolioManagerUserPortfolioBuildError
} from "@cryptuoso/portfolio-events";

export type UserRobotRunnerServiceConfig = HTTPServiceConfig;

export default class UserRobotRunnerService extends HTTPService {
    #userRobotJobRetries = 3;
    constructor(config?: UserRobotRunnerServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                userRobotStart: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: UserRobotRunnerSchema[UserRobotRunnerEvents.START],
                    handler: this.HTTPWithAuthHandler.bind(this, this.start.bind(this))
                },
                userRobotStop: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: UserRobotRunnerSchema[UserRobotRunnerEvents.STOP],
                    handler: this.HTTPWithAuthHandler.bind(this, this.stop.bind(this))
                },
                userRobotPause: {
                    roles: [UserRoles.admin, UserRoles.manager],
                    inputSchema: UserRobotRunnerSchema[UserRobotRunnerEvents.PAUSE],
                    handler: this.HTTPWithAuthHandler.bind(this, this.pause.bind(this))
                },
                userRobotResume: {
                    roles: [UserRoles.admin, UserRoles.manager],
                    inputSchema: UserRobotRunnerSchema[UserRobotRunnerEvents.RESUME],
                    handler: this.HTTPWithAuthHandler.bind(this, this.resume.bind(this))
                },
                userPortfolioStart: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: UserRobotRunnerSchema[UserRobotRunnerEvents.START_PORTFOLIO],
                    handler: this.HTTPWithAuthHandler.bind(this, this.startPortfolio.bind(this))
                },
                userPortfolioStop: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: UserRobotRunnerSchema[UserRobotRunnerEvents.STOP_PORTFOLIO],
                    handler: this.HTTPWithAuthHandler.bind(this, this.stopPortfolio.bind(this))
                },
                portfolioSyncRobots: {
                    roles: [UserRoles.admin, UserRoles.manager],
                    inputSchema: UserRobotRunnerSchema[UserRobotRunnerEvents.SYNC_PORTFOLIO_ROBOTS],
                    handler: this.HTTPWithAuthHandler.bind(this, this.syncPortfolioRobots.bind(this))
                },
                userPortfolioSyncRobots: {
                    roles: [UserRoles.admin, UserRoles.manager],
                    inputSchema: UserRobotRunnerSchema[UserRobotRunnerEvents.SYNC_USER_PORTFOLIO_ROBOTS],
                    handler: this.HTTPWithAuthHandler.bind(this, this.syncUserPortfolioRobots.bind(this))
                }
            });

            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error("Error while constructing UserRobotRunnerService", err);
        }
    }

    async onServiceStart() {
        this.events.subscribe({
            [`${USER_ROBOT_WORKER_TOPIC}.*`]: {
                passFullEvent: true,
                handler: this.handleUserRobotWorkerEvents.bind(this)
            },
            [SignalEvents.TRADE]: {
                handler: this.handleSignalTradeEvents.bind(this),
                schema: SignalSchema[SignalEvents.TRADE]
            },
            [ConnectorWorkerEvents.ORDER_STATUS]: {
                handler: this.handleOrderStatus.bind(this),
                schema: ConnectorWorkerSchema[ConnectorWorkerEvents.ORDER_STATUS]
            },
            [ConnectorWorkerEvents.ORDER_ERROR]: {
                handler: this.handleOrderError.bind(this),
                schema: ConnectorWorkerSchema[ConnectorWorkerEvents.ORDER_ERROR]
            },
            [ConnectorWorkerEvents.USER_EX_ACC_ERROR]: {
                handler: this.handleUserExAccError.bind(this),
                schema: ConnectorWorkerSchema[ConnectorWorkerEvents.USER_EX_ACC_ERROR]
            },
            [UserRobotRunnerEvents.STOP]: {
                handler: this.stop.bind(this),
                schema: UserRobotRunnerSchema[UserRobotRunnerEvents.STOP]
            },
            [UserRobotRunnerEvents.STOP_PORTFOLIO]: {
                handler: this.stopPortfolio.bind(this),
                schema: UserRobotRunnerSchema[UserRobotRunnerEvents.STOP_PORTFOLIO]
            },
            [PortfolioManagerOutEvents.PORTFOLIO_BUILDED]: {
                handler: this.handlePortfolioBuilded.bind(this),
                schema: PortfolioManagerOutSchema[PortfolioManagerOutEvents.PORTFOLIO_BUILDED]
            },
            [PortfolioManagerOutEvents.USER_PORTFOLIO_BUILDED]: {
                handler: this.handleUserPortfolioBuilded.bind(this),
                schema: PortfolioManagerOutSchema[PortfolioManagerOutEvents.USER_PORTFOLIO_BUILDED]
            },
            [PortfolioManagerOutEvents.USER_PORTFOLIO_BUILD_ERROR]: {
                handler: this.handleUserPortfolioBuildError.bind(this),
                schema: PortfolioManagerOutSchema[PortfolioManagerOutEvents.USER_PORTFOLIO_BUILD_ERROR]
            }
        });
        this.createQueue(Queues.userRobot);

        this.createQueue(Queues.userRobotRunner);
        this.createWorker(Queues.userRobotRunner, this.process);
        await this.addJob(Queues.userRobotRunner, UserRobotRunnerJobType.idleUserRobotJobs, null, {
            jobId: UserRobotRunnerJobType.idleUserRobotJobs,
            repeat: {
                every: 15000
            },
            removeOnComplete: 1,
            removeOnFail: 10
        });
        await this.addJob(Queues.userRobotRunner, UserRobotRunnerJobType.idleUserOrders, null, {
            jobId: UserRobotRunnerJobType.idleUserOrders,
            repeat: {
                every: 60000
            },
            removeOnComplete: 1,
            removeOnFail: 10
        });
        await this.addJob(Queues.userRobotRunner, UserRobotRunnerJobType.checkUserPortfolioRobots, null, {
            jobId: UserRobotRunnerJobType.checkUserPortfolioRobots,
            repeat: {
                cron: "0 10 */12 * * *"
            },
            removeOnComplete: 1,
            removeOnFail: 10
        });
    }

    async queueUserRobotJob(userRobotId: string) {
        await this.addJob(
            Queues.userRobot,
            "job",
            { userRobotId },
            {
                jobId: userRobotId,
                removeOnComplete: true,
                removeOnFail: 100
            }
        );
    }

    async addUserRobotJob({ userRobotId, type, data }: UserRobotJob, status: UserRobotStatus) {
        await this.db.pg.query(sql`
        INSERT INTO user_robot_jobs
        (
            user_robot_id,
            type,
            data,
            allocation
        ) VALUES (
            ${userRobotId},
            ${type},
            ${JSON.stringify(data) || null},
            'shared'
        )
        ON CONFLICT ON CONSTRAINT user_robot_jobs_user_robot_id_type_data_key 
         DO UPDATE SET updated_at = now(),
         type = excluded.type,
         data = excluded.data,
         retries = null,
         error = null;
        `);
        if (status === UserRobotStatus.started) await this.queueUserRobotJob(userRobotId);
    }

    async start({ id, message }: UserRobotRunnerStart, user: User) {
        const userRobot = await this.db.pg.maybeOne<{
            id: UserRobotDB["id"];
            userId: UserRobotDB["userId"];
            userExAccId: UserRobotDB["userExAccId"];
            userPortfolioId: UserRobotDB["userPortfolioId"];
            status: UserRobotDB["status"];
            allocation: UserRobotDB["allocation"];
        }>(sql`
            SELECT ur.id, ur.user_id, ur.user_ex_acc_id, ur.user_portfolio_id, ur.status, ur.allocation
            FROM user_robots ur
            WHERE ur.id = ${id};
        `);

        if (!userRobot) throw new ActionsHandlerError("User Robot not found", { userRobotId: id }, "NOT_FOUND", 404);

        if (user && userRobot.userId !== user.id)
            throw new ActionsHandlerError(
                "Current user isn't owner of this User Robot",
                { userRobotId: id },
                "FORBIDDEN",
                403
            );

        if (userRobot.status === UserRobotStatus.started) {
            return userRobot.status;
        }

        const userExchangeAccount = await this.db.pg.maybeOne<{
            id: UserExchangeAccount["id"];
            name: UserExchangeAccount["name"];
            status: UserExchangeAccount["status"];
            allocation: UserExchangeAccount["allocation"];
        }>(sql`
                SELECT id, name, status, allocation
                FROM user_exchange_accs
                WHERE id = ${userRobot.userExAccId};
            `);

        if (!userExchangeAccount)
            throw new ActionsHandlerError(
                "User Exchange Account not found",
                { userExAccId: userRobot.userExAccId },
                "NOT_FOUND",
                404
            );
        if (userExchangeAccount.status !== UserExchangeAccStatus.enabled)
            throw new ActionsHandlerError(
                `Something went wrong with your User Exchange Account ${userExchangeAccount.name}. Please check and update your exchange API keys.`,
                null,
                "FORBIDDEN",
                403
            );

        if (userRobot.allocation !== userExchangeAccount.allocation)
            throw new ActionsHandlerError(
                `Wrong User Robot's (${userRobot.allocation}) and Exchange Account's (${userExchangeAccount.allocation}) allocations`,
                null,
                "FORBIDDEN",
                403
            ); //TODO: better error code

        const userSub = await this.db.pg.maybeOne<{ id: UserSub["id"] }>(sql`
        SELECT id 
        FROM user_subs
        WHERE user_id = ${userRobot.userId}
        AND status in (${"active"},${"trial"});
        `);

        if (!userSub)
            throw new ActionsHandlerError(`Your Cryptuoso Subscription is not Active.`, null, "FORBIDDEN", 403);

        const startedAt = dayjs.utc().toISOString();
        await this.db.pg.query(sql`
        UPDATE user_robots 
        SET status = ${UserRobotStatus.started},
        message = ${message || null},
        started_at = ${startedAt},
        stopped_at = null
        WHERE id = ${id};
        `);

        await this.events.emit<UserRobotWorkerStatus>({
            type: UserRobotWorkerEvents.STARTED,
            data: {
                userRobotId: id,
                userPortfolioId: userRobot.userPortfolioId,
                timestamp: startedAt,
                status: UserRobotStatus.started,
                message: message || null
            }
        });
        GA.event(user.id, "robot", "start");
        return UserRobotStatus.started;
    }

    async stop({ id, message }: UserRobotRunnerStop, user: User) {
        const userRobot = await this.db.pg.maybeOne<{
            id: UserRobotDB["id"];
            userId: UserRobotDB["userId"];
            status: UserRobotDB["status"];
        }>(sql`
            SELECT ur.id, ur.user_id, ur.status
            FROM user_robots ur
            WHERE ur.id = ${id};
        `);

        if (!userRobot) throw new ActionsHandlerError("User Robot not found", { userRobotId: id }, "NOT_FOUND", 404);

        if (user && userRobot.userId !== user.id)
            throw new ActionsHandlerError(
                "Current user isn't owner of this User Robot",
                { userRobotId: id },
                "FORBIDDEN",
                403
            );

        if (userRobot.status === UserRobotStatus.stopped || userRobot.status === UserRobotStatus.stopping) {
            return userRobot.status;
        }

        await this.db.pg.query(sql`
        UPDATE user_robots 
        SET status = ${UserRobotStatus.stopping},
        message = ${message || null}
        WHERE id = ${id};
        `);

        await this.addUserRobotJob(
            {
                userRobotId: id,
                type: UserRobotJobType.stop,
                data: {
                    message: message || null
                },
                allocation: "shared"
            },
            userRobot.status
        );
        GA.event(user.id, "robot", "stop");
        return UserRobotStatus.stopping;
    }

    async pause({ id, userExAccId, exchange, message }: UserRobotRunnerPause) {
        let userRobotsToPause: {
            id: string;
            status: UserRobotStatus;
            userPortfolioId: string;
            allocation: UserRobotDB["allocation"];
        }[] = [];
        if (id) {
            const userRobot = await this.db.pg.maybeOne<{
                id: string;
                status: UserRobotStatus;
                userPortfolioId: string;
                allocation: UserRobotDB["allocation"];
            }>(sql`
            SELECT id, status, user_portfolio_id, allocation
              FROM user_robots 
              WHERE id = ${id}
                and status = ${UserRobotStatus.started};
            `);
            if (userRobot) userRobotsToPause.push(userRobot);
        } else if (userExAccId) {
            const userRobots = await this.db.pg.any<{
                id: string;
                status: UserRobotStatus;
                userPortfolioId: string;
                allocation: UserRobotDB["allocation"];
            }>(sql`
            SELECT id, status, user_portfolio_id, allocation
             FROM user_robots
            WHERE user_ex_acc_id = ${userExAccId}
              AND status = ${UserRobotStatus.started};
            `);
            userRobotsToPause = [...userRobots];
        } else if (exchange) {
            const userRobots = await this.db.pg.any<{
                id: string;
                status: UserRobotStatus;
                userPortfolioId: string;
                allocation: UserRobotDB["allocation"];
            }>(sql`
            SELECT ur.id, ur.status, ur.user_portfolio_id, ur.allocation
             FROM user_robots ur, robots r
            WHERE ur.robot_id = r.id
              AND r.exchange = ${exchange}
              AND ur.status = ${UserRobotStatus.started};
            `);
            userRobotsToPause = [...userRobots];
        } else throw new Error("No User Robots id, userExAccId or exchange was specified");

        for (const { id, status, userPortfolioId, allocation } of userRobotsToPause) {
            if (allocation === "shared") {
                await this.addUserRobotJob(
                    {
                        userRobotId: id,
                        type: UserRobotJobType.pause,
                        data: {
                            message
                        },
                        allocation: "shared"
                    },
                    status
                );
                if (userPortfolioId) {
                    await this.setPortfolioError({ userPortfolioId, message });
                }
            }
            //TODO: handle allocation === "dedicated"
        }

        return userRobotsToPause.length;
    }

    async setPortfolioError({ userPortfolioId, message }: { userPortfolioId: string; message: string }) {
        try {
            const userPortfolio = await this.db.pg.one<{
                id: UserPortfolioDB["id"];
                status: UserPortfolioDB["status"];
            }>(sql`SELECT id, status FROM user_portfolios WHERE id = ${userPortfolioId};`);
            if (userPortfolio.status !== "error") {
                await this.db.pg.query(
                    sql`UPDATE user_portfolios set status = 'error', message = ${message} WHERE id = ${userPortfolioId}`
                );
                await this.events.emit<UserPortfolioStatus>({
                    type: UserRobotWorkerEvents.ERROR_PORTFOLIO,
                    data: {
                        userPortfolioId,
                        timestamp: dayjs.utc().toISOString(),
                        status: "error",
                        message
                    }
                });
            }
        } catch (error) {
            this.log.error(error);
        }
    }

    async resume({ id, userExAccId, exchange, message }: UserRobotRunnerResume) {
        let userRobotsToResume: { id: string }[] = [];
        if (id) {
            const userRobot = await this.db.pg.maybeOne<{ id: string }>(sql`
            SELECT id 
              FROM user_robots 
              WHERE id = ${id}
                and status = ${UserRobotStatus.paused};
            `);
            if (userRobot) userRobotsToResume.push(userRobot);
        } else if (userExAccId) {
            const userRobots = await this.db.pg.any<{ id: string }>(sql`
            SELECT id
             FROM user_robots
            WHERE user_ex_acc_id = ${userExAccId}
              AND status = ${UserRobotStatus.paused};
            `);
            userRobotsToResume = [...userRobots];
        } else if (exchange) {
            const userRobots = await this.db.pg.any<{ id: string }>(sql`
            SELECT ur.id
             FROM user_robots ur, robots r
            WHERE ur.robot_id = r.id
              AND r.exchange = ${exchange}
              AND ur.status = ${UserRobotStatus.paused};
            `);
            userRobotsToResume = [...userRobots];
        } else throw new Error("No User Robots id, userExAccId or exchange was specified");

        for (const { id } of userRobotsToResume) {
            const latestSignal = await this.db.pg.maybeOne<SignalEvent>(sql`
            SELECT s.id, s.robot_id, r.exchange, r.asset, r.currency, r.timeframe, 
                   s.timestamp,  s.candle_timestamp,
                   s.position_id, s.position_prefix, s.position_code, s.position_parent_id,
                   s.type, s.action, s.order_type, s.price
            FROM robot_signals s, robots r, user_robots ur WHERE ur.id = ${id} 
            AND ur.robot_id = s.robot_id 
            AND ur.robot_id = r.id 
            AND s.type = 'trade' 
            and s.action in (${TradeAction.closeLong}, ${TradeAction.closeShort})
            ORDERBY timestamp DESC 
            LIMIT 1;
            `);

            if (latestSignal) {
                await this.addUserRobotJob(
                    {
                        userRobotId: id,
                        type: UserRobotJobType.signal,
                        data: latestSignal,
                        allocation: "shared"
                    },
                    UserRobotStatus.started
                );
            }

            await this.db.pg.query(sql`
            UPDATE user_robots 
            SET status = ${UserRobotStatus.started},
            message = ${message || null}
            WHERE id = ${id};
            `);
        }

        return userRobotsToResume.length;
    }

    async syncPortfolioRobots({ exchange }: { exchange: string }) {
        const exchangeCondition = exchange ? sql`AND exchange = ${exchange}` : sql``;
        const portfolios = await this.db.pg.any<{ id: PortfolioDB["id"] }>(sql`
        SELECT id from portfolios 
        where base = true 
        and status = 'started' 
        ${exchangeCondition};
        `);

        for (const { id } of portfolios) {
            await this.handlePortfolioBuilded({ portfolioId: id });
        }
    }

    async syncUserPortfolioRobots({ userPortfolioId }: { userPortfolioId: string }) {
        this.log.info(`Syncing User Portfolio #${userPortfolioId} robots`);
        const userPortfolio = await this.db.pg.one<UserPortfolioState>(sql`
        SELECT p.id, p.allocation, p.user_id, p.user_ex_acc_id, p.exchange, p.status, 
              p.active_from as user_portfolio_settings_active_from,
              p.user_portfolio_settings as settings,
              p.robots 
           FROM v_user_portfolios p
           WHERE p.id = ${userPortfolioId}; 
       `);
        if (userPortfolio.status !== "starting" && userPortfolio.status !== "started") return;
        if (userPortfolio.settings && userPortfolio.robots && Array.isArray(userPortfolio.robots)) {
            try {
                await this.db.pg.transaction(async (t) => {
                    await t.query(sql`UPDATE user_robots 
            SET settings = jsonb_set(settings::jsonb,'{active}','false')
            WHERE user_portfolio_id = ${userPortfolio.id};
            `);

                    await t.query(sql`
            INSERT INTO user_robots 
            (user_portfolio_id, robot_id, user_ex_acc_id, user_id, status, allocation, settings)
            SELECT *
                FROM ${sql.unnest(
                    this.db.util.prepareUnnest(
                        userPortfolio.robots.map((r) => ({
                            ...r,
                            userPortfolioId: userPortfolio.id,
                            userId: userPortfolio.userId,
                            allocation: userPortfolio.allocation,
                            userExAccId: userPortfolio.userExAccId || undefined,
                            status: "started",
                            settings: JSON.stringify({
                                active: r.active,
                                share: r.share
                            })
                        })),
                        ["userPortfolioId", "robotId", "userExAccId", "userId", "status", "allocation", "settings"]
                    ),
                    ["uuid", "uuid", "uuid", "uuid", "varchar", "varchar", "jsonb"]
                )}
                ON CONFLICT ON CONSTRAINT user_robots_user_portfolio_id_robot_id_key
                DO UPDATE SET settings = excluded.settings, status = excluded.status, allocation = excluded.allocation;
            `);

                    await t.query(sql`
            UPDATE user_portfolio_settings
            SET synced_at = ${dayjs.utc().toISOString()}
            WHERE user_portfolio_id = ${userPortfolioId}
            AND active = true;
            `);
                });

                if (userPortfolio.allocation === "dedicated") {
                    await this.events.emit<UserRobotRunnerSyncUserPortfolioDedicatedRobots>({
                        type: UserRobotRunnerEvents.SYNC_USER_PORTFOLIO_DEDICATED_ROBOTS,
                        data: {
                            userPortfolioId
                        }
                    });
                }
            } catch (error) {
                this.log.error(error);
                await this.events.emit<PortfolioManagerUserPortfolioBuildError>({
                    type: PortfolioManagerOutEvents.USER_PORTFOLIO_BUILD_ERROR,
                    data: {
                        userPortfolioId: userPortfolio.id,
                        error: error.message
                    }
                });
            }
            this.log.info(`Added ${userPortfolio.robots.length} robots to User Portfolio #${userPortfolioId}`);
        } else {
            this.log.warn(`User Portfolio #${userPortfolio.id} has no active robots`);
        }
    }

    async startPortfolio({ id, message }: UserRobotRunnerStartPortfolio, user: User) {
        GA.event(user.id, "portfolio", "start");
        const userPortfolio = await this.db.pg.one<UserPortfolioState>(sql`
        SELECT  p.id, p.allocation, p.user_id, p.user_ex_acc_id, p.exchange, p.status, 
                p.started_at,
              p.active_from as user_portfolio_settings_active_from,
              p.user_portfolio_settings as settings,
              p.robots 
           FROM v_user_portfolios p
           WHERE p.id = ${id}; 
       `);

        if (!userPortfolio)
            throw new ActionsHandlerError("User Portfolio not found", { userPortfolioId: id }, "NOT_FOUND", 404);

        if (user && userPortfolio.userId !== user.id)
            throw new ActionsHandlerError(
                "Current user isn't owner of this User Portfolio",
                { userPortfolioId: id },
                "FORBIDDEN",
                403
            );

        if (userPortfolio.status === UserRobotStatus.started) {
            return userPortfolio.status;
        }

        const userExchangeAccount = await this.db.pg.maybeOne<{
            id: UserExchangeAccount["id"];
            exchange: UserExchangeAccount["exchange"];
            status: UserExchangeAccount["status"];
        }>(sql`
                SELECT id, exchange, status
                FROM user_exchange_accs
                WHERE id = ${userPortfolio.userExAccId};
            `);

        if (!userExchangeAccount)
            throw new ActionsHandlerError(
                "User Exchange Account not found",
                { userExAccId: userPortfolio.userExAccId },
                "NOT_FOUND",
                404
            );
        if (userExchangeAccount.status !== UserExchangeAccStatus.enabled)
            throw new ActionsHandlerError(
                `Something went wrong with your ${formatExchange(
                    userExchangeAccount.exchange
                )} Exchange Account. Please check and update your exchange API keys.`,
                null,
                "FORBIDDEN",
                403
            );

        const userSub = await this.db.pg.maybeOne<{ id: UserSub["id"] }>(sql`
        SELECT id 
        FROM user_subs
        WHERE user_id = ${userPortfolio.userId}
        AND status in (${"active"},${"trial"});
        `);

        if (!userSub)
            throw new ActionsHandlerError(`Your Cryptuoso Subscription is not Active.`, null, "FORBIDDEN", 403);

        if (userPortfolio.status === "error") {
            const userRobots: readonly { id: string }[] = await this.db.pg.any<{ id: string }>(sql`
                SELECT id 
                FROM user_robots 
                WHERE user_portfolio_id = ${userPortfolio.id} and status != 'started' and (settings->'active')::boolean = true`);

            if (userRobots && Array.isArray(userRobots) && userRobots.length) {
                await Promise.all(
                    (userRobots as readonly { id: string }[]).map(async ({ id }: { id: string }) =>
                        this.start({ id }, null)
                    )
                );
            }
        }

        const startedAt = dayjs.utc().toISOString();
        const status = userPortfolio.settings ? "started" : "starting";
        await this.db.pg.query(sql`
        UPDATE user_portfolios
        SET status =  ${status},
        message = ${message || null},
        started_at = ${userPortfolio.startedAt || startedAt},
        stopped_at = null
        WHERE id = ${id};
        `);

        if (userPortfolio.settings.custom) {
            await this.events.emit<PortfolioManagerBuildUserPortfolio>({
                type: PortfolioManagerInEvents.BUILD_USER_PORTFOLIO,
                data: {
                    userPortfolioId: userPortfolio.id
                }
            });
        } else if (userPortfolio.settings && userPortfolio.robots?.length) {
            await this.syncUserPortfolioRobots({ userPortfolioId: userPortfolio.id });
        }

        return status;
    }

    async stopPortfolio({ id, message }: UserRobotRunnerStopPortfolio, user: User) {
        GA.event(user.id, "portfolio", "stop");
        const userPortfolio = await this.db.pg.one<UserPortfolioState>(sql`
        SELECT p.id, p.allocation, p.user_id, p.user_ex_acc_id, p.exchange, p.status, 
              ups.active_from as user_portfolio_settings_active_from,
              ups.user_portfolio_settings as settings
           FROM user_portfolios p
           LEFT JOIN v_user_portfolio_settings ups
                 ON  ups.user_portfolio_id = p.id
           WHERE p.id = ${id}; 
       `);

        if (!userPortfolio)
            throw new ActionsHandlerError("User Robot not found", { userRobotId: id }, "NOT_FOUND", 404);

        if (user && userPortfolio.userId !== user.id)
            throw new ActionsHandlerError(
                "Current user isn't owner of this User Portfolio",
                { userPortfolioId: id },
                "FORBIDDEN",
                403
            );

        if (userPortfolio.status === "stopped") {
            return userPortfolio.status;
        }

        if (userPortfolio.status === "error") {
            await this.db.pg.query(sql`
                UPDATE user_robots SET status = 'stopping' 
                WHERE user_portfolio_id = ${userPortfolio.id} and status = 'paused' and (settings->'active')::boolean = true`);
        }

        const userRobots = await this.db.pg.any<{
            id: UserRobotDB["id"];
            status: UserRobotDB["status"];
        }>(sql`SELECT id, status FROM user_robots WHERE 
        user_portfolio_id = ${id} 
        AND status != ${"stopped"};`);

        const status = userRobots.length ? "stopping" : "stopped";
        const stoppedAt = status === "stopped" ? dayjs.utc().toISOString() : null;
        if (userPortfolio.allocation === "shared") {
            for (const userRobot of userRobots) {
                await this.addUserRobotJob(
                    {
                        userRobotId: userRobot.id,
                        type: UserRobotJobType.stop,
                        data: {
                            message: message || null
                        },
                        allocation: "shared"
                    },
                    userRobot.status
                );
            }
        } else {
            await this.events.emit<UserRobotRunnerStopUserPortfolioDedicatedRobots>({
                type: UserRobotRunnerEvents.STOP_USER_PORTFOLIO_DEDICATED_ROBOTS,
                data: {
                    userPortfolioId: id
                }
            });
        }

        await this.db.pg.query(sql`
        UPDATE user_portfolios
        SET status = ${status},
        message = ${message || null},
        stopped_at = ${stoppedAt}
        WHERE id = ${id};
        `);

        return status;
    }

    async handlePortfolioBuilded({ portfolioId }: PortfolioManagerPortfolioBuilded) {
        try {
            const portfolio = await this.db.pg.one<{
                exchange: PortfolioDB["exchange"];
                settings: PortfolioDB["settings"];
                status: PortfolioDB["status"];
                base: PortfolioDB["base"];
            }>(sql`
            SELECT exchange, settings, status, base 
            FROM portfolios 
            WHERE id = ${portfolioId};`);

            if (!portfolio.base || portfolio.status !== "started") return;

            const { options } = portfolio.settings;
            const userPortfolios = await this.db.pg.any<{ id: UserPortfolioDB["id"]; settings: PortfolioSettings }>(sql`
            SELECT p.id, p.user_portfolio_settings as settings
            FROM v_user_portfolios p
            WHERE (p.user_portfolio_settings->>'custom')::boolean = false
            AND p.exchange = ${portfolio.exchange}
            AND p.option_risk = ${options.risk}
            AND p.option_profit = ${options.profit}
            AND p.option_win_rate = ${options.winRate}
            AND p.option_efficiency = ${options.efficiency}
            AND p.option_money_management = ${options.moneyManagement};`);

            if (!userPortfolios || !Array.isArray(userPortfolios) || !userPortfolios.length) return;

            const robots = await this.db.pg.any<PortfolioRobotDB>(sql`
                SELECT robot_id, active, share, priority
                FROM portfolio_robots
                WHERE portfolio_id = ${portfolioId}
                AND active = true;`);

            if (!robots || !Array.isArray(robots) || !robots.length) {
                this.log.error(`No portfolio robots found for ${portfolioId} portfolio`);
                return;
            }

            const stringifiedRobots = JSON.stringify(robots);
            for (const { id, settings } of userPortfolios) {
                try {
                    await this.db.pg.transaction(async (t) => {
                        await t.query(sql`UPDATE user_portfolio_settings 
                SET active = ${false}
                WHERE user_portfolio_id = ${id};
                `);
                        await t.query(sql`
                insert into user_portfolio_settings (user_portfolio_id, active_from, user_portfolio_settings, robots, active)
                values (${id}, ${dayjs.utc().toISOString()}, ${JSON.stringify(
                            settings
                        )}, ${stringifiedRobots}, ${true}); 
                `);
                    });
                    await this.syncUserPortfolioRobots({ userPortfolioId: id });
                } catch (error) {
                    this.log.error(`Failed to update user portfolio's #${id} settings and sync`, error);
                }
            }
            this.log.info(
                `Synced ${userPortfolios.length} user portfolio ${robots.length} robots with ${portfolioId} portfolio`
            );
        } catch (error) {
            this.log.error(`Failed to handle portfolio's #${portfolioId} builded event`, error);
        }
    }

    async handleUserPortfolioBuilded({ userPortfolioId }: PortfolioManagerUserPortfolioBuilded) {
        try {
            this.log.info(`Handling User Portfolio #${userPortfolioId} builded event`);
            const userPortfolio = await this.db.pg.one<{
                id: UserPortfolioDB["id"];
                status: UserPortfolioDB["status"];
            }>(sql`
        SELECT p.id,  p.status
           FROM user_portfolios p
           WHERE p.id = ${userPortfolioId}; 
       `);

            const startedAt = dayjs.utc().toISOString();
            const status = userPortfolio.status === "starting" ? "started" : null;

            if (status && userPortfolio.status !== "started") {
                await this.db.pg.query(sql`
        UPDATE user_portfolios
        SET status = ${status},
        started_at = ${startedAt}
        WHERE id = ${userPortfolioId};
        `);
            }

            await this.syncUserPortfolioRobots({ userPortfolioId });

            if (status) {
                await this.events.emit<UserPortfolioStatus>({
                    type: UserRobotWorkerEvents.STARTED_PORTFOLIO,
                    data: {
                        userPortfolioId,
                        timestamp: startedAt,
                        status,
                        message: null
                    }
                });
                this.log.info(`User Portfolio #${userPortfolioId} is started`);
            }
        } catch (error) {
            this.log.error(`Failed to handle user portfolio's #${userPortfolioId} builded event`, error);
        }
    }

    async handleUserPortfolioBuildError({ userPortfolioId, error }: PortfolioManagerUserPortfolioBuildError) {
        try {
            this.log.info(`Handling User Portfolio #${userPortfolioId} build failed event`);
            const userPortfolio = await this.db.pg.one<{
                id: UserPortfolioDB["id"];
                status: UserPortfolioDB["status"];
            }>(sql`
        SELECT p.id,  p.status
           FROM user_portfolios p
           WHERE p.id = ${userPortfolioId}; 
       `);

            if (userPortfolio.status === "starting") {
                await this.db.pg.query(sql`
                    UPDATE user_portfolios 
                    SET status = 'buildError', message = ${error} 
                    WHERE id = ${userPortfolioId}
           `);
                this.log.info(`User Portfolio #${userPortfolioId} failed to build`);
            }
        } catch (error) {
            this.log.error(`Failed to handle user portfolio's #${userPortfolioId} build error event`, error);
        }
    }

    #saveUserRobotHistory = async (userRobotId: string, type: string, data: { [key: string]: any }) =>
        this.db.pg.query(sql`
            INSERT INTO user_robot_history
            (user_robot_id, type, data) 
            VALUES (${userRobotId}, ${type}, ${JSON.stringify(data) || null})
        `);

    async handleUserRobotWorkerEvents(event: Event) {
        const type = event.type.replace("com.cryptuoso.", "");

        if (type.includes("portfolio")) return; //TODO
        const { userRobotId } = event.data as { userRobotId: string };

        const historyType = type.replace(`${USER_ROBOT_WORKER_TOPIC}.`, "");
        this.log.info(`User Robot's #${userRobotId} ${historyType} event`, JSON.stringify(event.data));
        await this.#saveUserRobotHistory(userRobotId, historyType, event.data);

        if (historyType === "started" || historyType === "stopped")
            await this.handleUserRobotStatusEvents(<UserRobotWorkerStatus>event.data);
    }

    async handleSignalTradeEvents(signal: SignalEvent) {
        const { id, robotId, timestamp, emulated } = signal;
        if (emulated) return;
        const userRobots = await this.db.pg.any<{ id: string; status: UserRobotStatus }>(
            sql`
            SELECT id, status 
             FROM user_robots
            WHERE robot_id = ${robotId}
             AND allocation = 'shared'
             AND status = ${UserRobotStatus.started}
             AND ((internal_state->'latestSignal'->>'timestamp')::timestamp is null 
              OR (internal_state->'latestSignal'->>'timestamp')::timestamp < ${timestamp});
            `
        );
        this.log.info(`New signal #${id} from robot #${robotId} required by ${userRobots.length}`);
        await Promise.all(
            userRobots.map(async ({ id, status }) =>
                this.addUserRobotJob(
                    {
                        userRobotId: id,
                        type: UserRobotJobType.signal,
                        data: signal,
                        allocation: "shared"
                    },
                    status
                )
            )
        );
    }

    async handleOrderStatus(event: OrdersStatusEvent) {
        this.log.info(`New ${ConnectorWorkerEvents.ORDER_STATUS} event for User Robot #${event.userRobotId}`);
        const userRobot = await this.db.pg.one<{ id: string; status: UserRobotStatus }>(sql`
         SELECT id, status
          FROM user_robots
         WHERE id = ${event.userRobotId}
         AND allocation = 'shared';
        `);
        await this.addUserRobotJob(
            {
                userRobotId: userRobot.id,
                type: UserRobotJobType.order,
                data: event,
                allocation: "shared"
            },
            userRobot.status
        );
    }

    async handleOrderError(event: OrdersErrorEvent) {
        this.log.info(
            `New ${ConnectorWorkerEvents.ORDER_ERROR} event for User Robot #${event.userRobotId}. Order #${event.orderId} is invalid - ${event.error}`
        );
        if (
            !event.error.toLowerCase().includes("gateway") &&
            !event.error.toLowerCase().includes("getaddrinfo") &&
            !event.error.toLowerCase().includes("network") &&
            !event.error.toLowerCase().includes("econnreset")
        )
            await this.pause({
                id: event.userRobotId,
                message: `Order #${event.orderId} error - ${event.error}.`
            });
    }

    async handleUserExAccError(event: UserExchangeAccountErrorEvent) {
        this.log.error(
            `New ${ConnectorWorkerEvents.USER_EX_ACC_ERROR} event. User exchange account #${event.userExAccId} is invalid - ${event.userExAccId} Pausing user robots...`
        );
        const userExAcc = await this.db.pg.one<{ id: string; name: string }>(sql`
           SELECT id, name
            FROM user_exchange_accs
           WHERE id = ${event.userExAccId};
          `);

        await this.pause({
            userExAccId: event.userExAccId,
            message: `Exchange Account #${userExAcc.name} error - ${event.error}. Please check and update your exchange API Keys or contact support.`
        });
    }

    async process(job: Job) {
        switch (job.name) {
            case UserRobotRunnerJobType.idleUserRobotJobs:
                await this.checkIdleUserRobotJobs();
                break;
            case UserRobotRunnerJobType.idleUserOrders:
                await this.checkIdleUserOrders();
                break;
            case UserRobotRunnerJobType.checkUserPortfolioRobots:
                await this.checkUserPortfolioRobots();
                break;
            default:
                this.log.error(`Unknow job ${job.name}`);
        }
    }

    async checkIdleUserRobotJobs() {
        try {
            const userRobotWithJobs = await this.db.pg.any<{ userRobotId: string }>(sql`
            SELECT distinct user_robot_id
             FROM user_robot_jobs urj, user_robots ur
            WHERE urj.user_robot_id = ur.id
             AND ur.status NOT IN (${UserRobotStatus.paused},${UserRobotStatus.stopped})
             AND (urj.retries is null OR urj.retries < ${this.#userRobotJobRetries})
             AND urj.updated_at < ${dayjs.utc().add(-30, "second").toISOString()}
            `);

            await Promise.all(userRobotWithJobs.map(async ({ userRobotId }) => this.queueUserRobotJob(userRobotId)));
        } catch (err) {
            this.log.error("Failed to check idle user robot jobs", err);
        }
    }

    async checkIdleUserOrders() {
        try {
            const idleOrders = await this.db.pg.any<OrdersStatusEvent & { userRobotStatus: UserRobotStatus }>(sql`
            SELECT uo.id as order_id, uo.user_ex_acc_id, uo.user_robot_id, uo.user_position_id, uo.position_id, uo.status,
                   ur.status as user_robot_status
              FROM user_orders uo, user_positions up, user_robots ur
             WHERE uo.user_robot_id = ur.id
               AND uo.user_position_id = up.id
               AND uo.status IN (${OrderStatus.closed}, ${OrderStatus.canceled})
               AND ((up.entry_status IN (${UserPositionOrderStatus.new}, ${UserPositionOrderStatus.open})
               AND uo.action IN (${TradeAction.long}, ${TradeAction.short}))
                OR (up.exit_status IN (${UserPositionOrderStatus.new}, ${UserPositionOrderStatus.open})
               AND uo.action IN (${TradeAction.closeLong}, ${TradeAction.closeShort})))
              AND up.status NOT IN (${UserPositionStatus.closed}, ${UserPositionStatus.closedAuto}, 
                                    ${UserPositionStatus.canceled})
              AND ur.status in (${UserRobotStatus.started},${UserRobotStatus.stopping})
              AND NOT EXISTS (select id from user_orders puv where puv.prev_order_id = uo.id)
              AND uo.updated_at < ${dayjs.utc().add(-30, "second").toISOString()};
            `);
            for (const idleOrder of idleOrders) {
                await this.addUserRobotJob(
                    {
                        userRobotId: idleOrder.userRobotId,
                        type: UserRobotJobType.order,
                        data: {
                            orderId: idleOrder.orderId,
                            timestamp: idleOrder.timestamp,
                            userExAccId: idleOrder.userExAccId,
                            userRobotId: idleOrder.userRobotId,
                            userPositionId: idleOrder.userPositionId,
                            positionId: idleOrder.positionId,
                            status: idleOrder.status
                        },
                        allocation: "shared"
                    },
                    idleOrder.userRobotStatus
                );
            }
        } catch (err) {
            this.log.error("Failed to check idle user orders", err);
        }
    }

    async checkUserPortfolioRobots() {
        this.log.info("Checking user portfolios robots in sync");
        const userPortfolios = await this.db.pg.any<{ id: string }>(sql`
          SELECT t.id FROM (
                SELECT p.id, 
                       jsonb_array_length(p.robots) as robots_count, 
			           (select count(1) from user_robots ur
						where (ur.settings->'active')::boolean = true
						 and ur.user_portfolio_id = p.id) as user_robots_count
                FROM v_user_portfolios p 
                WHERE p.status = 'started') t 
           WHERE t.robots_count!=t.user_robots_count;
        `);

        if (userPortfolios && Array.isArray(userPortfolios) && userPortfolios.length) {
            this.log.info(`${userPortfolios.length} User portfolios not in sync`);
            for (const { id } of userPortfolios) {
                await this.syncUserPortfolioRobots({ userPortfolioId: id });
            }
        }
    }

    async handleUserRobotStatusEvents(event: UserRobotWorkerStatus) {
        if (!event.userPortfolioId) return;
        if (event.status === UserRobotStatus.started || event.status === UserRobotStatus.stopped) {
            const userPortfolio = await this.db.pg.one<{
                status: UserPortfolioDB["status"];
                robots: UserPortfolioState["robots"];
                robotsCount: number;
            }>(sql`
        SELECT p.id, p.status, ups.robots, (select count(1) from user_robots ur where ur.user_portfolio_id = p.id and ur.status != ${event.status} ) as robots_count
           FROM user_portfolios p
           LEFT JOIN v_user_portfolio_settings ups
                 ON  ups.user_portfolio_id = p.id
           WHERE  p.id = ${event.userPortfolioId}; 
       `);

            if (
                userPortfolio &&
                (userPortfolio.status === "starting" || userPortfolio.status === "stopping") &&
                userPortfolio.robotsCount === 0
            ) {
                await this.db.pg.query(sql`
                UPDATE user_portfolios
                SET status = ${event.status},
                stopped_at = ${event.status === "stopped" ? event.timestamp : null}
                WHERE id = ${event.userPortfolioId};
                `);

                await this.events.emit<UserPortfolioStatus>({
                    type:
                        event.status === "started"
                            ? UserRobotWorkerEvents.STARTED_PORTFOLIO
                            : UserRobotWorkerEvents.STOPPED_PORTFOLIO,
                    data: {
                        userPortfolioId: event.userRobotId,
                        timestamp: event.timestamp,
                        status: event.status
                    }
                });
            }
        }
    }
}
