import { GenericObject } from "@cryptuoso/helpers";
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
import { UserRobotWorkerEvents, UserRobotWorkerStatus, USER_ROBOT_WORKER_TOPIC } from "@cryptuoso/user-robot-events";
import {
    ConnectorWorkerEvents,
    ConnectorWorkerSchema,
    OrdersErrorEvent,
    OrdersStatusEvent,
    UserExchangeAccountErrorEvent
} from "@cryptuoso/connector-events";
import { ActionsHandlerError } from "@cryptuoso/errors";
import dayjs from "@cryptuoso/dayjs";
import { Job } from "bullmq";
import { Signal, SignalEvents, SignalSchema } from "@cryptuoso/robot-events";
import { Event } from "@cryptuoso/events";
import { OrderStatus, TradeAction } from "@cryptuoso/market";

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
                    inputSchema: {
                        id: "uuid"
                    },
                    handler: this._httpHandler.bind(this, this.start.bind(this))
                },
                userRobotStop: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: "uuid"
                    },
                    handler: this._httpHandler.bind(this, this.stop.bind(this))
                },
                userRobotPause: {
                    roles: [UserRoles.admin, UserRoles.manager],
                    inputSchema: {
                        id: { type: "uuid", optional: true },
                        userExAccId: { type: "uuid", optional: true },
                        exchange: { type: "string", optional: true },
                        message: { type: "string", optional: true }
                    },
                    handler: this._httpHandler.bind(this, this.pause.bind(this))
                },
                userRobotResume: {
                    roles: [UserRoles.admin, UserRoles.manager],
                    inputSchema: {
                        id: { type: "uuid", optional: true },
                        userExAccId: { type: "uuid", optional: true },
                        exchange: { type: "string", optional: true }
                    },
                    handler: this._httpHandler.bind(this, this.resume.bind(this))
                }
            });
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
                }
            });
            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error(err, "While constructing UserRobotRunnerService");
        }
    }

    async onServiceStart() {
        this.createQueue(Queues.userRobot);

        this.createQueue(Queues.userRobotRunner);
        this.createWorker(Queues.userRobotRunner, this.process);
        await this.addJob(Queues.userRobotRunner, UserRobotRunnerJobType.idleUserRobotJobs, null, {
            jobId: UserRobotRunnerJobType.idleUserRobotJobs,
            repeat: {
                every: 15000
            },
            removeOnComplete: true,
            removeOnFail: 100
        });
        await this.addJob(Queues.userRobotRunner, UserRobotRunnerJobType.idleUserOrders, null, {
            jobId: UserRobotRunnerJobType.idleUserOrders,
            repeat: {
                every: 60000
            },
            removeOnComplete: true,
            removeOnFail: 100
        });
    }

    async checkAndQueueUserRobotJob(userRobotId: string) {
        const lastJob = await this.queues[Queues.userRobot].instance.getJob(userRobotId);
        if (lastJob) {
            const lastJobState = await lastJob.getState();
            if (["unknown", "completed", "failed"].includes(lastJobState)) {
                try {
                    await lastJob.remove();
                } catch (e) {
                    this.log.warn(e);
                    return;
                }
            } else return;
        }

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
            data
        ) VALUES (
            ${userRobotId},
            ${type},
            ${JSON.stringify(data) || null}
        )
        ON CONFLICT ON CONSTRAINT user_robot_jobs_user_robot_id_type_data_key 
         DO UPDATE SET updated_at = now(),
         type = excluded.type,
         data = excluded.data,
         retries = null,
         error = null;
        `);
        if (status === UserRobotStatus.started) await this.checkAndQueueUserRobotJob(userRobotId);
    }

    async _httpHandler(
        handler: (user: User, params: GenericObject<any>) => Promise<GenericObject<any>>,
        req: RequestExtended,
        res: any
    ) {
        const result = await handler(req.meta.user, req.body.input);

        res.send({ result: result || "OK" });
        res.end();
    }

    async start(user: User, { id }: { id: string }) {
        const { id: userId } = user;

        const userRobot = await this.db.pg.maybeOne<{
            id: UserRobotDB["id"];
            userId: UserRobotDB["userId"];
            userExAccId: UserRobotDB["userExAccId"];
            status: UserRobotDB["status"];
        }>(sql`
            SELECT ur.id, ur.user_id, ur.user_ex_acc_id, ur.status
            FROM user_robots ur
            WHERE  ur.id = ${id};
        `);

        if (!userRobot) throw new ActionsHandlerError("User Robot not found", { userRobotId: id }, "NOT_FOUND", 404);

        if (userRobot.userId !== userId)
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
        }>(sql`
                SELECT id, name, status
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

        if (userRobot.status === UserRobotStatus.paused) {
            throw new ActionsHandlerError(
                `Something went wrong with your robot. It will be started automatically when everything is fixed.`,
                null,
                "FORBIDDEN",
                403
            );
        }

        const startedAt = dayjs.utc().toISOString();
        await this.db.pg.query(sql`
        UPDATE user_robots 
        SET status = ${UserRobotStatus.started},
        message = null,
        started_at = ${startedAt},
        stopped_at = null
        WHERE id = ${id};
        `);

        await this.events.emit<UserRobotWorkerStatus>({
            type: UserRobotWorkerEvents.STARTED,
            data: {
                userRobotId: id,
                timestamp: startedAt,
                status: UserRobotStatus.started,
                message: null
            }
        });

        return UserRobotStatus.started;
    }

    async stop(user: User, { id }: { id: string }) {
        const { id: userId } = user;

        const userRobot = await this.db.pg.maybeOne<{
            id: UserRobotDB["id"];
            userId: UserRobotDB["userId"];
            status: UserRobotDB["status"];
        }>(sql`
            SELECT ur.id, ur.user_id, ur.status
            FROM user_robots ur
            WHERE  ur.id = ${id};
        `);

        if (!userRobot) throw new ActionsHandlerError("User Robot not found", { userRobotId: id }, "NOT_FOUND", 404);

        if (userRobot.userId !== userId)
            throw new ActionsHandlerError(
                "Current user isn't owner of this User Robot",
                { userRobotId: id },
                "FORBIDDEN",
                403
            );

        if (userRobot.status === UserRobotStatus.paused) {
            throw new ActionsHandlerError(
                `Something went wrong with your robot. It will be started automatically when everything is fixed.`,
                null,
                "FORBIDDEN",
                403
            );
        }

        if (userRobot.status === UserRobotStatus.stopped || userRobot.status === UserRobotStatus.stopping) {
            return userRobot.status;
        }

        await this.addUserRobotJob(
            {
                userRobotId: id,
                type: UserRobotJobType.stop
            },
            userRobot.status
        );

        await this.db.pg.query(sql`
        UPDATE user_robots 
        SET status = ${UserRobotStatus.stopped},
        stopped_at =  ${dayjs.utc().toISOString()},
        internal_state = ${JSON.stringify({})}
        WHERE id = ${id};
        `);

        return UserRobotStatus.stopped;
    }

    async pause({
        id,
        userExAccId,
        exchange,
        message
    }: {
        id?: string;
        userExAccId?: string;
        exchange?: string;
        message?: string;
    }) {
        let userRobotsToPause: { id: string; status: UserRobotStatus }[] = [];
        if (id) {
            const userRobot = await this.db.pg.maybeOne<{ id: string; status: UserRobotStatus }>(sql`
            SELECT id, status 
              FROM user_robots 
              WHERE id = ${id}
                and status = ${UserRobotStatus.started};
            `);
            if (userRobot) userRobotsToPause.push(userRobot);
        } else if (userExAccId) {
            const userRobots = await this.db.pg.any<{ id: string; status: UserRobotStatus }>(sql`
            SELECT id, status
             FROM user_robots
            WHERE user_ex_acc_id = ${userExAccId}
              AND status = ${UserRobotStatus.started};
            `);
            userRobotsToPause = [...userRobots];
        } else if (exchange) {
            const userRobots = await this.db.pg.any<{ id: string; status: UserRobotStatus }>(sql`
            SELECT ur.id, ur.status
             FROM user_robots ur, robots r
            WHERE ur.robot_id = r.id
              AND r.exchange = ${exchange}
              AND ur.status = ${UserRobotStatus.started};
            `);
            userRobotsToPause = [...userRobots];
        } else throw new Error("No User Robots id, userExAccId or exchange was specified");

        await Promise.all(
            userRobotsToPause.map(async ({ id, status }) =>
                this.addUserRobotJob(
                    {
                        userRobotId: id,
                        type: UserRobotJobType.pause,
                        data: {
                            message
                        }
                    },
                    status
                )
            )
        );

        return userRobotsToPause.length;
    }

    async resume({ id, userExAccId, exchange }: { id?: string; userExAccId?: string; exchange?: string }) {
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
            await this.db.pg.query(sql`
            UPDATE user_robots 
            SET status = ${UserRobotStatus.started},
            message = null
            WHERE id = ${id};
            `);
        }

        return userRobotsToResume.length;
    }

    #saveUserRobotHistory = async (userRobotId: string, type: string, data: { [key: string]: any }) =>
        this.db.pg.query(sql`
            INSERT INTO user_robot_history
            (user_robot_id, type, data) 
            VALUES (${userRobotId}, ${type}, ${JSON.stringify(data) || null})
        `);

    async handleUserRobotWorkerEvents(event: Event) {
        const { userRobotId } = event.data as { userRobotId: string };

        const type = event.type.replace("com.cryptuoso.", "");
        const historyType = type.replace(`${USER_ROBOT_WORKER_TOPIC}.`, "");
        this.log.info(`User Robot's #${userRobotId} ${historyType} event`, JSON.stringify(event.data));
        await this.#saveUserRobotHistory(userRobotId, historyType, event.data);
    }

    async handleSignalTradeEvents(signal: Signal) {
        const { id, robotId, timestamp } = signal;
        const userRobots = await this.db.pg.any<{ id: string; status: UserRobotStatus }>(
            sql`
            SELECT id, status 
             FROM user_robots
            WHERE robot_id = ${robotId}
             AND status IN (${UserRobotStatus.started}, ${UserRobotStatus.paused})
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
                        data: signal
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
         WHERE id = ${event.userRobotId};
        `);
        await this.addUserRobotJob(
            {
                userRobotId: userRobot.id,
                type: UserRobotJobType.order,
                data: event
            },
            userRobot.status
        );
    }

    async handleOrderError(event: OrdersErrorEvent) {
        this.log.info(
            `New ${ConnectorWorkerEvents.ORDER_ERROR} event for User Robot #${event.userRobotId}. Order #${event.orderId} is invalid - ${event.error}`
        );
        await this.pause({
            id: event.userRobotId,
            message: `Order #${event.orderId} error - ${event.error}. Please contact support.`
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

            await Promise.all(
                userRobotWithJobs.map(async ({ userRobotId }) => this.checkAndQueueUserRobotJob(userRobotId))
            );
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
              AND up.position_id IS NOT NULL
              AND ur.status in (${UserRobotStatus.started},${UserRobotStatus.stopping})
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
                        }
                    },
                    idleOrder.userRobotStatus
                );
            }
        } catch (err) {
            this.log.error("Failed to check idle user orders", err);
        }
    }
}
