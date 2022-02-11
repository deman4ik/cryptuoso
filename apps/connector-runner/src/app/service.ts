import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { ConnectorRunnerEvents, ConnectorRunnerSchema } from "@cryptuoso/connector-events";
import { ConnectorJob, ConnectorJobType, ConnectorRunnerJobType, Priority, Queues } from "@cryptuoso/connector-state";
import { sql } from "slonik";
import { User, UserExchangeAccStatus, UserRoles } from "@cryptuoso/user-state";
import { Job } from "bullmq";
import dayjs from "dayjs";
import { v4 as uuid } from "uuid";
import { ActionsHandlerError } from "@cryptuoso/errors";
import { OrderJobType } from "@cryptuoso/market";
export type ConnectorRunnerServiceConfig = HTTPServiceConfig;

export default class ConnectorRunnerService extends HTTPService {
    constructor(config?: ConnectorRunnerServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                checkBalance: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager, UserRoles.admin],
                    inputSchema: {
                        userExAccId: "uuid"
                    },
                    handler: this.HTTPWithAuthHandler.bind(this, this.checkBalance.bind(this))
                },
                checkUnknownOrders: {
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager, UserRoles.admin],
                    inputSchema: {
                        userExAccId: "uuid"
                    },
                    handler: this.HTTPWithAuthHandler.bind(this, this.checkUserUnknownOrders.bind(this))
                }
            });
            this.events.subscribe({
                [ConnectorRunnerEvents.ADD_JOB]: {
                    schema: ConnectorRunnerSchema[ConnectorRunnerEvents.ADD_JOB],
                    handler: this.addConnectorJob.bind(this)
                }
            });
            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error("Error while constructing ConnectorRunnerService", err);
        }
    }

    async onServiceStart() {
        this.createQueue(Queues.connector);

        this.createQueue(Queues.connectorRunner);
        this.createWorker(Queues.connectorRunner, this.process);

        await this.addJob(Queues.connectorRunner, ConnectorRunnerJobType.idleOrderJobs, null, {
            jobId: ConnectorRunnerJobType.idleOrderJobs,
            repeat: {
                cron: "*/15 * * * * *"
            },
            removeOnComplete: 1,
            removeOnFail: 10
        });

        await this.addJob(Queues.connectorRunner, ConnectorRunnerJobType.idleOpenOrders, null, {
            jobId: ConnectorRunnerJobType.idleOpenOrders,
            repeat: {
                every: 1000 * 120
            },
            removeOnComplete: 1,
            removeOnFail: 10
        });

        await this.addJob(Queues.connectorRunner, ConnectorRunnerJobType.checkBalance, null, {
            jobId: ConnectorRunnerJobType.checkBalance,
            repeat: {
                every: 1000 * 60
            },
            removeOnComplete: 1,
            removeOnFail: 10
        });
        await this.addJob(Queues.connectorRunner, ConnectorRunnerJobType.checkUnknownOrders, null, {
            jobId: ConnectorRunnerJobType.checkUnknownOrders,
            repeat: {
                cron: "0 15 */12 * * *"
            },
            removeOnComplete: 1,
            removeOnFail: 10
        });
    }

    async queueJob(userExAccId: string, type: ConnectorJobType) {
        const { status } = await this.db.pg.one<{ status: UserExchangeAccStatus }>(sql`
            SELECT status FROM user_exchange_accs WHERE id = ${userExAccId};
            `);

        if (status === UserExchangeAccStatus.enabled) {
            await this.addJob(
                Queues.connector,
                type,
                { userExAccId },
                {
                    jobId: userExAccId,
                    removeOnComplete: true,
                    removeOnFail: 100
                }
            );
        }
        this.log.info(`Queued Connector Job #${userExAccId} - ${type}`);
    }

    async addConnectorJob(nextJob: ConnectorJob) {
        const { userExAccId, type, orderId } = nextJob;

        await this.db.pg.query(sql`
        INSERT INTO connector_jobs (id, user_ex_acc_id, order_id, next_job_at, priority, type, data )
        VALUES (${nextJob.id}, ${nextJob.userExAccId}, 
        ${nextJob.orderId}, ${nextJob.nextJobAt}, 
        ${nextJob.priority}, ${nextJob.type}, 
        ${JSON.stringify(nextJob.data) || null});
        `);

        await this.queueJob(userExAccId, ConnectorJobType.order);
        this.log.info(`Added new Connector job ${userExAccId} ${type} order ${orderId}`);
    }

    async process(job: Job) {
        switch (job.name) {
            case ConnectorRunnerJobType.idleOrderJobs:
                await this.checkIdleOrderJobs();
                break;
            case ConnectorRunnerJobType.idleOpenOrders:
                await this.checkIdleOpenOrders();
                break;
            case ConnectorRunnerJobType.checkBalance:
                await this.checkBalances();
                break;
            case ConnectorRunnerJobType.checkUnknownOrders:
                await this.checkUnknownOrders();
                break;
            default:
                this.log.error(`Unknow job ${job.name}`);
        }
    }

    async checkIdleOrderJobs() {
        const userExAccIds = await this.db.pg.any<{ userExAccId: string }>(sql`
        SELECT j.user_ex_acc_id
      FROM connector_jobs j,
           user_exchange_accs a
      WHERE j.user_ex_acc_id = a.id
        AND a.status = 'enabled'
        AND a.type = 'shared'
        AND j.next_job_at IS NOT NULL
        AND j.next_job_at <= now()
      GROUP BY j.user_ex_acc_id
        `);
        if (userExAccIds && Array.isArray(userExAccIds) && userExAccIds.length) {
            this.log.info(`${userExAccIds.length} userExAccs has order jobs`);
            for (const { userExAccId } of userExAccIds) {
                try {
                    await this.queueJob(userExAccId, ConnectorJobType.order);
                } catch (e) {
                    this.log.error(e);
                }
            }
        }
    }

    async checkIdleOpenOrders() {
        const userOrders = await this.db.pg.any<{ id: string; userExAccId: string }>(sql`
        SELECT uo.id, uo.user_ex_acc_id
      FROM user_orders uo,
           user_exchange_accs a
      WHERE uo.user_ex_acc_id = a.id
      AND a.status = 'enabled'
      AND a.type = 'shared'
      AND uo.status = 'open'
      AND NOT EXISTS (select j.id from connector_jobs j where j.user_ex_acc_id = uo.user_ex_acc_id and j.order_id = uo.id);
        `);

        if (userOrders && Array.isArray(userOrders) && userOrders.length) {
            for (const { id: orderId, userExAccId } of userOrders) {
                await this.addConnectorJob({
                    id: uuid(),
                    type: OrderJobType.check,
                    userExAccId,
                    orderId,
                    nextJobAt: dayjs.utc().toISOString(),
                    priority: Priority.medium
                });
            }
        }
    }

    async checkBalance({ userExAccId }: { userExAccId: string }, user: User) {
        const userExAcc = await this.db.pg.one<{ id: string; userId: string }>(sql`
        SELECT id, user_id from user_exchange_accs where id = ${userExAccId} and type = 'shared';
        `);
        if (user && user.id !== userExAcc.userId)
            throw new ActionsHandlerError(
                "Current user isn't owner of this User Exchange Account",
                { userExAccId },
                "FORBIDDEN",
                403
            );
        await this.addJob(
            Queues.connector,
            ConnectorJobType.balance,
            { userExAccId },
            {
                jobId: userExAccId,
                removeOnComplete: true,
                removeOnFail: 100
            }
        );
    }

    async checkBalances() {
        const userExAccIds = await this.db.pg.any<{ userExAccId: string }>(sql`
        select id as user_ex_acc_id 
        from user_exchange_accs 
        where status = 'enabled' 
        and type = 'shared'
        and ( (balances->> 'updatedAt')::timestamp without time zone is null 
          or (balances->> 'updatedAt')::timestamp without time zone < ${dayjs.utc().add(-50, "minute").toISOString()})
        `);
        if (userExAccIds && Array.isArray(userExAccIds) && userExAccIds.length) {
            this.log.info(`${userExAccIds.length} userExAccs need to check balance`);
            for (const { userExAccId } of userExAccIds) {
                try {
                    await this.queueJob(userExAccId, ConnectorJobType.balance);
                } catch (e) {
                    this.log.error(e);
                }
            }
        }
    }

    async checkUserUnknownOrders({ userExAccId }: { userExAccId: string }, user: User) {
        const userExAcc = await this.db.pg.one<{ id: string; userId: string }>(sql`
        SELECT id, user_id from user_exchange_accs where id = ${userExAccId} and type = 'shared';
        `);
        if (user && user.id !== userExAcc.userId)
            throw new ActionsHandlerError(
                "Current user isn't owner of this User Exchange Account",
                { userExAccId },
                "FORBIDDEN",
                403
            );
        await this.queueJob(userExAccId, ConnectorJobType.unknownOrders);
    }

    async checkUnknownOrders() {
        const userExAccIds = await this.db.pg.any<{ userExAccId: string }>(sql`
        select uea.id as user_ex_acc_id 
        from user_exchange_accs uea
        where status = 'enabled'
        and type = 'shared'
        and exists (select id from user_robots ur where ur.user_ex_acc_id = uea.id and ur.status in ('started','stopping','paused')); 
        `);
        if (userExAccIds && Array.isArray(userExAccIds) && userExAccIds.length) {
            this.log.info(`${userExAccIds.length} userExAccs need to check unknown orders`);
            for (const { userExAccId } of userExAccIds) {
                try {
                    await this.queueJob(userExAccId, ConnectorJobType.unknownOrders);
                } catch (e) {
                    this.log.error(e);
                }
            }
        }
    }
}
