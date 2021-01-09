import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { ConnectorRunnerEvents, ConnectorRunnerSchema } from "@cryptuoso/connector-events";
import { ConnectorJob, ConnectorJobType, ConnectorRunnerJobType, Queues } from "@cryptuoso/connector-state";
import { sql } from "slonik";
import { UserExchangeAccStatus } from "@cryptuoso/user-state";
import { Job } from "bullmq";
import dayjs from "dayjs";
export type ConnectorRunnerServiceConfig = HTTPServiceConfig;

export default class ConnectorRunnerService extends HTTPService {
    constructor(config?: ConnectorRunnerServiceConfig) {
        super(config);
        try {
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

        await this.addJob(Queues.connectorRunner, ConnectorRunnerJobType.checkBalance, null, {
            jobId: ConnectorRunnerJobType.checkBalance,
            repeat: {
                every: 1000 * 60
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
            const lastJob = await this.queues[Queues.connector].instance.getJob(userExAccId);
            if (lastJob) {
                const lastJobState = await lastJob.getState();
                if (["stuck", "completed", "failed"].includes(lastJobState))
                    try {
                        await lastJob.remove();
                    } catch (e) {
                        this.log.warn(e);
                        return;
                    }
            }
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
            case ConnectorRunnerJobType.checkBalance:
                await this.checkBalance();
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

    async checkBalance() {
        const userExAccIds = await this.db.pg.any<{ userExAccId: string }>(sql`
        select id as user_ex_acc_id 
        from user_exchange_accs 
        where status = 'enabled' 
        and ( (((balances -> 'balances'::text) ->> 'updatedAt'::text))::timestamp without time zone is null 
          or (((balances -> 'balances'::text) ->> 'updatedAt'::text))::timestamp without time zone < ${dayjs
              .utc()
              .add(-50, "minute")
              .toISOString()})
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
}
