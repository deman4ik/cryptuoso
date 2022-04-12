import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { Job } from "bullmq";
import { ConnectorJob, ConnectorJobType, ConnectorRunnerJobType, Priority, Queues } from "@cryptuoso/connector-state";
import {
    ConnectorRunnerEvents,
    ConnectorRunnerSchema,
    ConnectorWorkerEvents,
    OrdersErrorEvent,
    OrdersStatusEvent,
    UserExchangeAccountErrorEvent
} from "@cryptuoso/connector-events";
import { sql } from "@cryptuoso/postgres";
import dayjs from "@cryptuoso/dayjs";
import {
    User,
    UserRoles,
    EncryptedData,
    UserExchangeAccBalances,
    UserExchangeAccount,
    UserExchangeAccStatus
} from "@cryptuoso/user-state";
import { PrivateConnector } from "@cryptuoso/ccxt-private";
import { Pool, spawn, Worker as ThreadsWorker } from "threads";
import { Decrypt } from "./decryptWorker";
import { groupBy, sortDesc } from "@cryptuoso/helpers";
import { Order, OrderJobType, OrderStatus } from "@cryptuoso/market";
import { ActionsHandlerError, BaseError } from "@cryptuoso/errors";
import { DatabaseTransactionConnection } from "slonik";
import { v4 as uuid } from "uuid";
import ccxt from "ccxt";

export type ConnectorRunnerServiceConfig = HTTPServiceConfig;

export default class ConnectorRunnerService extends HTTPService {
    #pool: Pool<any>;

    connectors: { [key: string]: PrivateConnector } = {};
    constructor(config?: ConnectorRunnerServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                connectorCheckBalance: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager, UserRoles.admin],
                    inputSchema: {
                        userExAccId: "uuid"
                    },
                    handler: this.HTTPWithAuthHandler.bind(this, this.checkBalance.bind(this))
                },
                connectorCheckUnknownOrders: {
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager, UserRoles.admin],
                    inputSchema: {
                        userExAccId: "uuid"
                    },
                    handler: this.HTTPWithAuthHandler.bind(this, this.checkUserUnknownOrders.bind(this))
                }
            });

            this.addOnStartHandler(this.onServiceStart);
            this.addOnStopHandler(this.onServiceStop);
        } catch (err) {
            this.log.error("Error while constructing ConnectorRunnerService", err);
        }
    }

    async onServiceStart() {
        this.#pool = await Pool(async () => await spawn<Decrypt>(new ThreadsWorker("./decryptWorker")), {
            name: "decrypt",
            concurrency: this.workerConcurrency,
            size: this.workerThreads
        });

        this.events.subscribe({
            [ConnectorRunnerEvents.ADD_JOB]: {
                schema: ConnectorRunnerSchema[ConnectorRunnerEvents.ADD_JOB],
                handler: this.addConnectorJob.bind(this)
            }
        });
        this.createQueue(Queues.connector);

        this.createQueue(Queues.connectorRunner);
        this.createWorker(Queues.connectorRunner, this.processRunnerJobs);

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

        this.createWorker(Queues.connector, this.processWorkerJobs);
    }

    private async onServiceStop(): Promise<void> {
        await this.#pool.terminate();
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
        INSERT INTO connector_jobs (id, user_ex_acc_id, order_id, next_job_at, priority, type, data, allocation )
        VALUES (${nextJob.id}, ${nextJob.userExAccId}, 
        ${nextJob.orderId}, ${nextJob.nextJobAt}, 
        ${nextJob.priority}, ${nextJob.type}, 
        ${JSON.stringify(nextJob.data) || null},
        'shared');
        `);

        await this.queueJob(userExAccId, ConnectorJobType.order);
        this.log.info(`Added new Connector job ${userExAccId} ${type} order ${orderId}`);
    }

    async processRunnerJobs(job: Job) {
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
        AND j.allocation = 'shared'
        AND a.status = 'enabled'
        AND a.allocation = 'shared'
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
      AND a.allocation = 'shared'
      AND uo.status = 'open'
      AND NOT EXISTS (select j.id from connector_jobs j 
                      where j.user_ex_acc_id = uo.user_ex_acc_id 
                      and j.order_id = uo.id 
                      and j.allocation = 'shared');
        `);

        if (userOrders && Array.isArray(userOrders) && userOrders.length) {
            for (const { id: orderId, userExAccId } of userOrders) {
                await this.addConnectorJob({
                    id: uuid(),
                    type: OrderJobType.check,
                    userExAccId,
                    orderId,
                    nextJobAt: dayjs.utc().toISOString(),
                    priority: Priority.medium,
                    allocation: "shared"
                });
            }
        }
    }

    async checkBalance({ userExAccId }: { userExAccId: string }, user: User) {
        const userExAcc = await this.db.pg.one<{ id: string; userId: string }>(sql`
        SELECT id, user_id from user_exchange_accs where id = ${userExAccId} and allocation = 'shared';
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
        and allocation = 'shared'
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
        SELECT id, user_id from user_exchange_accs where id = ${userExAccId} and allocation = 'shared';
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
        and allocation = 'shared'
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

    async decrypt(userId: string, data: EncryptedData) {
        return await this.#pool.queue(async (decrypt: Decrypt) => decrypt(userId, data));
    }

    async initConnector({ id, userId, exchange, keys, ordersCache }: UserExchangeAccount): Promise<void> {
        if (!(id in this.connectors)) {
            const { key: encryptedKey, secret: encryptedSecret, pass: encryptedPass } = keys;

            let apiKey;
            let secret;
            let password;
            try {
                apiKey = await this.decrypt(userId, encryptedKey);
                secret = await this.decrypt(userId, encryptedSecret);
                password = encryptedPass && (await this.decrypt(userId, encryptedPass));
            } catch (e) {
                this.log.error(`Failed to decrypt #${id} keys`, e, keys);
                if (e.message?.includes("bad decrypt")) {
                    await this.events.emit<UserExchangeAccountErrorEvent>({
                        type: ConnectorWorkerEvents.USER_EX_ACC_ERROR,
                        data: {
                            userExAccId: id,
                            timestamp: dayjs.utc().toISOString(),
                            error: e.message
                        }
                    });

                    await this.db.pg.query(sql`
                    UPDATE user_exchange_accs SET status = ${UserExchangeAccStatus.disabled},
                    error = ${e.message || null}
                    WHERE id = ${id};
                    `);
                }
                throw e;
            }

            this.connectors[id] = new PrivateConnector({
                exchange,
                keys: {
                    apiKey,
                    secret,
                    password
                },
                ordersCache
            });
            await this.connectors[id].initConnector();
        }
    }

    #getNextJobs = async (userExAccId: string) => {
        return this.db.pg.any<ConnectorJob>(sql`
         SELECT * FROM connector_jobs
         WHERE user_ex_acc_id = ${userExAccId}
           AND next_job_at <= ${dayjs.utc().toISOString()}
           AND allocation = 'shared'
           ORDER BY priority, next_job_at
         `) as Promise<ConnectorJob[]>;
    };

    #getUserExAcc = async (userExAccId: string) => {
        return this.db.pg.one<UserExchangeAccount>(sql`
         SELECT * FROM user_exchange_accs
         WHERE id = ${userExAccId}
         `);
    };

    #getOrder = async (orderId: string) => {
        return this.db.pg.one<Order>(sql`
        SELECT * from user_orders
        WHERE id = ${orderId}
        `);
    };

    #getOrderByPrevId = async (orderId: string) => {
        return this.db.pg.maybeOne<Order>(sql`
        SELECT * from user_orders
        WHERE prev_order_id = ${orderId}
        `);
    };

    #createOrder = async (transaction: DatabaseTransactionConnection, order: Order) => {
        this.log.info(order);
        await transaction.query(sql`
            INSERT INTO user_orders
            (
                id, user_ex_acc_id, user_robot_id, 
                position_id, user_position_id,
                prev_order_id,
                exchange, asset, currency,
                action, direction, type,
                signal_price, price, 
                volume, status, 
                ex_id, ex_timestamp, ex_last_trade_at,
                remaining, executed, fee, 
                last_checked_at, params,
                error, next_job, meta
            ) VALUES (
                ${order.id}, ${order.userExAccId}, ${order.userRobotId},
                ${order.positionId || null}, ${order.userPositionId},
                ${order.prevOrderId || null},
                ${order.exchange}, ${order.asset}, ${order.currency},
                ${order.action}, ${order.direction}, ${order.type}, 
                ${order.signalPrice || null}, ${order.price || null},
                ${order.volume}, ${order.status},
                ${order.exId || null}, ${order.exTimestamp || null}, ${order.exLastTradeAt || null},
                ${order.remaining || null}, ${order.executed || null}, ${order.fee || null},
                ${order.lastCheckedAt || null}, ${JSON.stringify(order.params) || null},
                ${order.error || null}, ${JSON.stringify(order.nextJob) || null},
                ${JSON.stringify(order.meta) || JSON.stringify({})}
            );
            `);
    };

    #saveOrder = async (transaction: DatabaseTransactionConnection, order: Order) => {
        try {
            return transaction.query(sql`
         UPDATE user_orders SET prev_order_id = ${order.prevOrderId || null},
         price = ${order.price || null},
         params = ${JSON.stringify(order.params) || null},
         status = ${order.status},
         ex_id = ${order.exId || null},
         ex_timestamp = ${order.exTimestamp || null},
         ex_last_trade_at = ${order.exLastTradeAt || null},
         remaining = ${order.remaining || null},
         executed = ${order.executed || null},
         fee = ${order.fee || null},
         last_checked_at = ${order.lastCheckedAt || null},
         error = ${JSON.stringify(order.error) || null},
         next_job = ${JSON.stringify(order.nextJob) || null},
         info = ${JSON.stringify(order.info) || null},
         meta = ${JSON.stringify(order.meta) || JSON.stringify({})}
         WHERE id = ${order.id}
        `);
        } catch (error) {
            this.log.error("saveOrder error", error, order);
            throw error;
        }
    };

    #deleteJobs = async (transaction: DatabaseTransactionConnection, orderId: string) => {
        try {
            return transaction.query(sql`
        DELETE FROM connector_jobs WHERE order_id = ${orderId};
        `);
        } catch (error) {
            this.log.error("deleteJobs error", error, orderId);
            throw error;
        }
    };

    #saveNextJob = async (transaction: DatabaseTransactionConnection, nextJob: ConnectorJob) => {
        try {
            return transaction.query(sql`
        INSERT INTO connector_jobs (id, user_ex_acc_id, order_id, next_job_at, priority, type, data, allocation )
        VALUES (${nextJob.id}, ${nextJob.userExAccId}, 
        ${nextJob.orderId}, ${nextJob.nextJobAt || null}, 
        ${nextJob.priority || 3}, ${nextJob.type}, 
        ${JSON.stringify(nextJob.data) || null},
        'shared');
        `);
        } catch (error) {
            this.log.error("saveNextJob error", error, nextJob);
            throw error;
        }
    };

    async processWorkerJobs(job: Job) {
        const beacon = this.lightship.createBeacon();
        try {
            const userExAccId = job.id;
            this.log.info(`Connector #${userExAccId} started processing jobs`);

            if (job.name === ConnectorJobType.order) {
                let nextJobs = await this.#getNextJobs(userExAccId);
                if (!nextJobs || !Array.isArray(nextJobs) || nextJobs.length === 0) return;

                const exchangeAcc: UserExchangeAccount = await this.#getUserExAcc(userExAccId);

                if (exchangeAcc.status !== UserExchangeAccStatus.enabled)
                    throw new Error(`User Exchange Account #${userExAccId} is not enabled`);
                await this.initConnector(exchangeAcc);

                while (nextJobs.length > 0) {
                    const groupedJobs: {
                        [key: string]: ConnectorJob[];
                    } = groupBy(nextJobs, (job) => job.orderId);

                    await Promise.all(
                        Object.values(groupedJobs).map(async (orderJobs) => {
                            const [nextJob] = orderJobs.sort((a, b) =>
                                sortDesc(dayjs.utc(a.nextJobAt).valueOf(), dayjs.utc(b.nextJobAt).valueOf())
                            );
                            await this.processNextOrderJob(exchangeAcc, nextJob);
                        })
                    );

                    nextJobs = await this.#getNextJobs(userExAccId);
                }

                await this.db.pg.query(sql`
            UPDATE user_exchange_accs SET orders_cache = ${
                JSON.stringify(this.connectors[userExAccId].ordersCache) || null
            }
            WHERE id = ${userExAccId};
            `);
            }

            if (job.name === ConnectorJobType.balance) {
                const exchangeAcc: UserExchangeAccount = await this.#getUserExAcc(userExAccId);

                await this.initConnector(exchangeAcc);
                const balances: UserExchangeAccBalances = await this.connectors[userExAccId].getBalances();

                let status = exchangeAcc.status;
                if (exchangeAcc.status !== UserExchangeAccStatus.enabled) {
                    status = UserExchangeAccStatus.enabled;
                    this.log.info(`User Exchange Account #${userExAccId} is enabled`);
                }
                await this.db.pg.query(sql`
                UPDATE user_exchange_accs SET balances = ${JSON.stringify(balances) || null},
                status = ${status}
                WHERE id = ${userExAccId};
                `);
            }

            if (job.name === ConnectorJobType.unknownOrders) {
                const pairs = await this.db.pg.any<{ asset: string; currency: string }>(sql`
                select distinct asset, currency from user_robots ur, robots r
                    where ur.robot_id = r.id and ur.user_ex_acc_id = ${userExAccId};
                `);
                if (pairs && Array.isArray(pairs) && pairs.length > 0) {
                    const exchangeAcc: UserExchangeAccount = await this.#getUserExAcc(userExAccId);
                    await this.initConnector(exchangeAcc);
                    for (const { asset, currency } of pairs) {
                        const orders = await this.connectors[userExAccId].getRecentOrders(asset, currency);
                        if (orders && orders.length) {
                            const ids = orders.map((o) => o.exId);
                            const ordersExists = await this.db.pg.any<{ exId: string }>(sql`
                        SELECT ex_id FROM user_orders
                        WHERE user_ex_acc_id = ${userExAccId}
                        AND ex_id in (${sql.join(ids, sql`, `)});
                        `);
                            const idsNotExists = ids.filter((exId) => !ordersExists.map((o) => o.exId).includes(exId));
                            if (idsNotExists.length) {
                                const unknownOrders = orders
                                    .filter(({ exId }) => idsNotExists.includes(exId))
                                    .map((o) => ({
                                        ...o,
                                        userExAccId,
                                        info: JSON.stringify(o.info)
                                    }));
                                await this.db.pg.query(sql`
                                INSERT INTO user_orders_unknown (
                                    user_ex_acc_id,
                                    exchange,
                                    asset,
                                    currency,
                                    direction,
                                    type,
                                    price,
                                    status,
                                    ex_id,
                                    ex_timestamp,
                                    ex_last_trade_at,
                                    volume,
                                    remaining,
                                    executed,
                                    last_checked_at,
                                    info
                                ) SELECT * FROM ${sql.unnest(
                                    this.db.util.prepareUnnest(unknownOrders, [
                                        "userExAccId",
                                        "exchange",
                                        "asset",
                                        "currency",
                                        "direction",
                                        "type",
                                        "price",
                                        "status",
                                        "exId",
                                        "exTimestamp",
                                        "exLastTradeAt",
                                        "volume",
                                        "remaining",
                                        "executed",
                                        "lastCheckedAt",
                                        "info"
                                    ]),
                                    [
                                        "uuid",
                                        "varchar",
                                        "varchar",
                                        "varchar",
                                        "varchar",
                                        "varchar",
                                        "numeric",
                                        "varchar",
                                        "varchar",
                                        "timestamp",
                                        "timestamp",
                                        "numeric",
                                        "numeric",
                                        "numeric",
                                        "timestamp",
                                        "jsonb"
                                    ]
                                )} ON CONFLICT ON CONSTRAINT user_orders_unknown_pkey
                                DO UPDATE SET price = excluded.price,
                                status = excluded.status,
                                ex_timestamp = excluded.ex_timestamp,
                                ex_last_trade_at = excluded.ex_last_trade_at,
                                remaining = excluded.remaining,
                                executed = excluded.executed,
                                last_checked_at = excluded.last_checked_at,
                                info = excluded.info;
                                `);
                            }
                        }
                    }
                }
            }

            this.log.info(`Connector #${userExAccId} finished processing jobs`);

            await beacon.die();
        } catch (e) {
            this.log.error(`Error while processing job ${job.id}`, e);
            if (
                e instanceof ccxt.AuthenticationError ||
                // e instanceof ccxt.InsufficientFunds ||
                e instanceof ccxt.InvalidNonce ||
                //e.message.includes("Margin is insufficient") ||
                //e.message.includes("EOrder:Insufficient initial margin") ||
                //e.message.includes("balance-insufficient") ||
                e.message?.includes("EAPI:Invalid key") ||
                e.message?.includes("Invalid API-key") ||
                e.message?.includes("Failed to save order") ||
                e.message?.includes("Could not find a key")
            ) {
                await this.events.emit<UserExchangeAccountErrorEvent>({
                    type: ConnectorWorkerEvents.USER_EX_ACC_ERROR,
                    data: {
                        userExAccId: job.id,
                        timestamp: dayjs.utc().toISOString(),
                        error: e.message
                    }
                });

                await this.db.pg.query(sql`
                UPDATE user_exchange_accs SET status = ${UserExchangeAccStatus.invalid},
                error = ${e.message || null}
                WHERE id = ${job.id};
                `);
            }

            throw e;
        } finally {
            if (this.connectors[job.id]) delete this.connectors[job.id];
        }
    }

    async processNextOrderJob(exAcc: UserExchangeAccount, job: ConnectorJob): Promise<void> {
        const { exchange } = exAcc;
        const { userExAccId, orderId } = job;
        try {
            let order: Order = await this.#getOrder(orderId);
            order.error = null;
            let nextJob: {
                type: OrderJobType;
                priority: Priority;
                nextJobAt: string;
            };
            if (order.exchange !== exchange) throw new BaseError("Wrong exchange", { exAcc, job, order });

            let errorToThrow;
            try {
                const result = await this.processOrder(order, job);
                order = result.order;
                nextJob = result.nextJob;
            } catch (err) {
                if (
                    err instanceof ccxt.AuthenticationError ||
                    err.message.includes("EAPI:Invalid key") ||
                    err.message.includes("Invalid API-key")
                ) {
                    errorToThrow = err;
                }

                order = {
                    ...order,
                    lastCheckedAt: dayjs.utc().toISOString(),
                    error: PrivateConnector.getErrorMessage(err),
                    status:
                        order.nextJob && order.nextJob.type === OrderJobType.create
                            ? OrderStatus.canceled
                            : order.status,
                    nextJob: null
                };
                nextJob = null;
            }

            if (order.status === OrderStatus.closed) {
                try {
                    const balances: UserExchangeAccBalances = await this.connectors[userExAccId].getBalances();

                    await this.db.pg.query(sql`
                UPDATE user_exchange_accs SET balances = ${JSON.stringify(balances) || null}
                WHERE id = ${userExAccId};
                `);
                    order.meta = { ...order.meta, currentBalance: balances.totalUSD };
                } catch (error) {
                    this.log.error(`Failed to check user balance #${userExAccId}`, error);
                }
            }

            try {
                await this.db.pg.transaction(async (t) => {
                    await this.#saveOrder(t, order);
                    await this.#deleteJobs(t, order.id);
                    if (nextJob) {
                        await this.#saveNextJob(t, {
                            ...nextJob,
                            id: uuid(),
                            userExAccId,
                            orderId,
                            allocation: "shared"
                        });
                    }
                });
            } catch (error) {
                this.log.error(`Failed to save order #${order.id}`, error, order, nextJob);
                throw new BaseError(`Failed to save order #${order.id} - ${error.message}`, { order, nextJob });
            }

            if ((order.status === OrderStatus.closed || order.status === OrderStatus.canceled) && !order.error) {
                await this.events.emit<OrdersStatusEvent>({
                    type: ConnectorWorkerEvents.ORDER_STATUS,
                    data: {
                        orderId: order.id,
                        timestamp: dayjs.utc().toISOString(),
                        userExAccId: order.userExAccId,
                        userRobotId: order.userRobotId,
                        userPositionId: order.userPositionId,
                        positionId: order.positionId,
                        status: order.status
                    }
                });
            } else if (order.error) {
                await this.events.emit<OrdersErrorEvent>({
                    type: ConnectorWorkerEvents.ORDER_ERROR,
                    data: {
                        orderId: order.id,
                        timestamp: dayjs.utc().toISOString(),
                        userExAccId: order.userExAccId,
                        userRobotId: order.userRobotId,
                        userPositionId: order.userPositionId,
                        positionId: order.positionId,
                        status: order.status,
                        error: order.error
                    }
                });

                if (errorToThrow) throw errorToThrow;
            }

            this.log.info(`UserExAcc #${order.userExAccId} processed order ${order.id}`, order);
        } catch (err) {
            this.log.error(err, job);
            throw err;
        }
    }

    async processOrder(
        order: Order,
        job: ConnectorJob
    ): Promise<{
        order: Order;
        nextJob?: {
            type: OrderJobType;
            priority: Priority;
            nextJobAt: string;
        };
    }> {
        try {
            const { userExAccId } = order;
            const { type: orderJobType, data: orderJobData } = job;
            let nextJob: {
                type: OrderJobType;
                priority: Priority;
                nextJobAt: string;
            };
            if (orderJobType === OrderJobType.create) {
                this.log.info(`UserExAcc #${userExAccId} creating order ${order.positionId}/${order.id}`);
                if (order.exId || order.status !== OrderStatus.new) {
                    this.log.error(`Failed to create order #${order.id} - order already processed!`);
                    ({ order, nextJob } = await this.connectors[userExAccId].checkOrder(order));
                    return {
                        order,
                        nextJob
                    };
                }

                ({ order, nextJob } = await this.connectors[userExAccId].createOrder(order));
                return { order, nextJob };
            } else if (orderJobType === OrderJobType.recreate) {
                this.log.info(`UserExAcc #${userExAccId} recreating order ${order.positionId}/${order.id}`);
                const response = await this.connectors[userExAccId].checkOrder(order);
                if (response.order.status === OrderStatus.canceled) {
                    const orderExists = await this.#getOrderByPrevId(order.id);

                    if (orderExists) {
                        this.log.warn(
                            `UserExAcc #${userExAccId} recreating order ${order.positionId}/${order.id} - Order exists`
                        );
                        await this.db.pg.transaction(async (t) => {
                            await this.#saveOrder(t, response.order);
                            await this.#deleteJobs(t, response.order.id);
                        });
                        ({ order, nextJob } = await this.connectors[userExAccId].checkOrder(orderExists));
                        return { order, nextJob };
                    } else {
                        const newOrder: Order = {
                            id: uuid(),
                            userExAccId: response.order.userExAccId,
                            userRobotId: response.order.userRobotId,
                            positionId: response.order.positionId,
                            userPositionId: response.order.userPositionId,
                            prevOrderId: order.id,
                            exchange: response.order.exchange,
                            asset: response.order.asset,
                            currency: response.order.currency,
                            action: response.order.action,
                            direction: response.order.direction,
                            type: response.order.type,
                            signalPrice: response.order.signalPrice,
                            price: orderJobData.price,
                            volume: response.order.volume,
                            executed: 0,
                            exId: null,
                            params: response.order.params,
                            createdAt: dayjs.utc().toISOString(),
                            status: OrderStatus.new,
                            nextJob: {
                                type: OrderJobType.create
                            }
                        };
                        await this.db.pg.transaction(async (t) => {
                            await this.#saveOrder(t, response.order);
                            await this.#createOrder(t, newOrder);
                        });
                        ({ order, nextJob } = await this.connectors[userExAccId].createOrder(newOrder));
                        return { order, nextJob };
                    }
                } else {
                    order = response.order;
                    nextJob = response.nextJob;
                    return { order, nextJob };
                }
            } else if (orderJobType === OrderJobType.cancel) {
                this.log.info(`UserExAcc #${userExAccId} canceling order ${order.positionId}/${order.id}`);
                if (!order.exId) {
                    return {
                        order: {
                            ...order,
                            status: OrderStatus.canceled,
                            nextJob: null
                        },
                        nextJob: null
                    };
                }
                if (order.status === OrderStatus.canceled || order.status === OrderStatus.closed) {
                    return { order: { ...order, nextJob: null }, nextJob: null };
                }
                ({ order, nextJob } = await this.connectors[userExAccId].cancelOrder(order));
                return { order, nextJob };
            } else if (orderJobType === OrderJobType.check) {
                this.log.info(`UserExAcc #${userExAccId} checking order ${order.positionId}/${order.id}`);
                if (!order.exId) {
                    this.log.error(`Failed to check order #${order.id} - no exchange id!`);
                    return {
                        order: {
                            ...order,
                            error: new Error(`Failed to check order - no exchange id!`),
                            nextJob: null
                        },
                        nextJob: null
                    };
                }
                if (order.status === OrderStatus.closed || order.status === OrderStatus.canceled) {
                    const orderExists = await this.#getOrderByPrevId(order.id);
                    if (orderExists) {
                        await this.db.pg.transaction(async (t) => {
                            await this.#deleteJobs(t, order.id);
                        });
                        order = { ...orderExists };
                    } else return { order, nextJob: null };
                }

                ({ order, nextJob } = await this.connectors[userExAccId].checkOrder(order));

                if (
                    order.status === OrderStatus.open &&
                    order.exTimestamp &&
                    dayjs.utc().diff(dayjs.utc(order.exTimestamp), "second") > order.params.orderTimeout
                ) {
                    this.log.info(
                        `UserExAcc #${userExAccId} canceling order ${order.positionId}/${order.id} by timeout`
                    );
                    ({ order, nextJob } = await this.connectors[userExAccId].cancelOrder(order));
                }
                return { order, nextJob };
            } else {
                throw new BaseError("Wrong connector job type", { order });
            }
        } catch (e) {
            this.log.error(e, order);
            throw e;
        }
    }
}
