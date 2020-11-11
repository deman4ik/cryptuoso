import { GenericObject } from "@cryptuoso/helpers";
import { sql } from "@cryptuoso/postgres";
import { HTTPService, HTTPServiceConfig, RequestExtended } from "@cryptuoso/service";
import { User, UserExchangeAccount, UserExchangeAccStatus, UserRoles } from "@cryptuoso/user-state";
import {
    Queues,
    UserRobotDB,
    UserRobotJob,
    UserRobotRunnerJobType,
    UserRobotStatus
} from "@cryptuoso/user-robot-state";
import { USER_ROBOT_WORKER_TOPIC } from "@cryptuoso/user-robot-events";
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

export type UserRobotRunnerServiceConfig = HTTPServiceConfig;

export default class UserRobotRunnerService extends HTTPService {
    #robotJobRetries = 3;
    constructor(config?: UserRobotRunnerServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                start: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: "string"
                    },
                    handler: this._httpHandler.bind(this, this.start.bind(this))
                },
                stop: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: "string"
                    },
                    handler: this._httpHandler.bind(this, this.stop.bind(this))
                }
                /* TODO
                pause: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: "string"
                    },
                    handler: this._httpHandler.bind(this, this.pause.bind(this))
                } */
                /* TODO
                resume: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: "string"
                    },
                    handler: this._httpHandler.bind(this, this.resume.bind(this))
                } */
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
                    handler: this.handleOrderStatus,
                    schema: ConnectorWorkerSchema[ConnectorWorkerEvents.ORDER_STATUS]
                },
                [ConnectorWorkerEvents.ORDER_ERROR]: {
                    handler: this.handleOrderError,
                    schema: ConnectorWorkerSchema[ConnectorWorkerEvents.ORDER_ERROR]
                },
                [ConnectorWorkerEvents.USER_EX_ACC_ERROR]: {
                    handler: this.handleUserExAccError,
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
                `User Exchange Account ${userExchangeAccount.name} is not enabled.`,
                null,
                "FORBIDDEN",
                403
            );

        /* TODO: 
        if (userRobot.status === UserRobotStatus.paused) {
            return this.resumeRobot(user, { id });
        } */

        await this.db.pg.query(sql`
        UPDATE user_robots 
        SET status = ${UserRobotStatus.started},
        message = null,
        started_at = ${dayjs.utc().toISOString()},
        error = null,
        stopped_at = null,
        latest_signal = null
        WHERE id = ${id};
        `);

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

        if (userRobot.status === UserRobotStatus.stopped || userRobot.status === UserRobotStatus.stopping) {
            return userRobot.status;
        }

        //TODO: Checks and job

        await this.db.pg.query(sql`
        UPDATE user_robots 
        SET status = ${UserRobotStatus.stopped},
        stopped_at =  ${dayjs.utc().toISOString()}
        WHERE id = ${id};
        `);

        return UserRobotStatus.stopped;
    }

    async handleUserRobotWorkerEvents(event: Event) {
        //TODO
    }

    async handleSignalTradeEvents(signal: Signal) {
        //TODO
    }

    async handleOrderStatus(order: OrdersStatusEvent) {
        //TODO
    }

    async handleOrderError(order: OrdersErrorEvent) {
        //TODO
    }

    async handleUserExAccError(event: UserExchangeAccountErrorEvent) {
        //TODO
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
            //TODO
        } catch (err) {
            this.log.error("Failed to idle user robot jobs", err);
        }
    }

    async checkIdleUserOrders() {
        try {
            //TODO
        } catch (err) {
            this.log.error("Failed to idle user orders", err);
        }
    }
}
