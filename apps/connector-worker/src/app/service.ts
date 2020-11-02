import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { Job } from "bullmq";
import { ConnectorJob, ConnectorJobType, Priority } from "@cryptuoso/connector-state";
import {
    ConnectorWorkerEvents,
    OrdersErrorEvent,
    OrdersStatusEvent,
    UserExchangeAccountErrorEvent
} from "@cryptuoso/connector-events";
import { sql } from "@cryptuoso/postgres";
import dayjs from "@cryptuoso/dayjs";
import {
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
import { BaseError } from "@cryptuoso/errors";
import { DatabaseTransactionConnectionType } from "slonik";
import { v4 as uuid } from "uuid";
import ccxt from "ccxt";

export type ConnectorRunnerServiceConfig = BaseServiceConfig;

export default class ConnectorRunnerService extends BaseService {
    #pool: Pool<any>;
    #robotJobRetries = 3;

    connectors: { [key: string]: PrivateConnector } = {};
    constructor(config?: ConnectorRunnerServiceConfig) {
        super(config);
        try {
            this.addOnStartHandler(this.onServiceStart);
            this.addOnStopHandler(this.onServiceStop);
        } catch (err) {
            this.log.error(err, "While constructing ConnectorRunnerService");
        }
    }

    async onServiceStart() {
        this.#pool = Pool(() => spawn<Decrypt>(new ThreadsWorker("./decryptWorker")), {
            name: "decrypt"
        });
        this.createWorker("connector", this.process);
    }

    private async onServiceStop(): Promise<void> {
        await this.#pool.terminate();
    }

    async decrypt(userId: string, data: EncryptedData) {
        return await this.#pool.queue(async (decrypt: Decrypt) => decrypt(userId, data));
    }

    async initConnector({ id, userId, exchange, keys, ordersCache }: UserExchangeAccount): Promise<void> {
        if (!(id in this.connectors)) {
            const { key: encryptedKey, secret: encryptedSecret, pass: encryptedPass } = keys;

            const apiKey = await this.decrypt(userId, encryptedKey);
            const secret = await this.decrypt(userId, encryptedSecret);
            const password = encryptedPass && (await this.decrypt(userId, encryptedPass));

            this.connectors[id] = new PrivateConnector();
            await this.connectors[id].initConnector({
                exchange,
                keys: {
                    apiKey,
                    secret,
                    password
                },
                ordersCache
            });
        }
    }

    #getNextJobs = async (userExAccId: string) => {
        return this.db.pg.any<ConnectorJob>(sql`
         SELECT * FROM connector_jobs
         WHERE user_ex_acc_id = ${userExAccId}
           AND next_job_at <= ${dayjs.utc().toISOString()}
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
        SELECT * from user_oders
        WHERE id = ${orderId}
        `);
    };

    #saveOrder = async (transaction: DatabaseTransactionConnectionType, order: Order) => {
        return transaction.query(sql`
         UPDATE user_oders SET price = ${order.price || null},
         params = ${JSON.stringify(order.params) || null},
         status = ${order.status},
         ex_id = ${order.exId || null},
         ex_timestamp = ${order.exTimestamp || null},
         ex_last_trade_at = ${order.exLastTradeAt || null},
         remaining = ${order.remaining || null},
         executed = ${order.executed || null},
         fee = ${order.fee || null},
         last_checked_at = ${order.lastCheckedAt || null},
         error = ${order.error || null},
         next_job = ${JSON.stringify(order.nextJob) || null}
         WHERE id = ${order.id}
        `);
    };

    #deleteJobs = async (transaction: DatabaseTransactionConnectionType, orderId: string) => {
        return transaction.query(sql`
        DELETE FROM connector_jobs WHERE order_id = ${orderId};
        `);
    };

    #saveNextJob = async (transaction: DatabaseTransactionConnectionType, nextJob: ConnectorJob) => {
        return transaction.query(sql`
        INSERT INTO connector_jobs (id, user_ex_acc_id, order_id, next_job_at,priority, type, data )
        VALUES (${nextJob.id}, ${nextJob.userExAccId}, 
        ${nextJob.orderId}, ${nextJob.nextJobAt}, 
        ${nextJob.priority},${nextJob.type}, 
        ${JSON.stringify(nextJob.data) || null});
        `);
    };

    async process(job: Job) {
        const beacon = this.lightship.createBeacon();
        try {
            const userExAccId = job.id;
            this.log.info(`Connector #${userExAccId} started processing jobs`);
            let updateBalances = false;
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
                            ({ updateBalances } = await this.processNextJob(exchangeAcc, nextJob));
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

                if (exchangeAcc.status !== UserExchangeAccStatus.enabled)
                    throw new Error(`User Exchange Account #${userExAccId} is not enabled`);
                await this.initConnector(exchangeAcc);
            }

            if (job.name === ConnectorJobType.balance || updateBalances) {
                const balances: UserExchangeAccBalances = await this.connectors[userExAccId].getBalances();

                await this.db.pg.query(sql`
                UPDATE user_exchange_accs SET balances = ${JSON.stringify(balances) || null}
                WHERE id = ${userExAccId};
                `);
            }

            delete this.connectors[userExAccId];

            this.log.info(`Connector #${userExAccId} finished processing jobs`);

            await beacon.die();
        } catch (e) {
            this.log.error(`Error while processing job ${job.id}`, e);
            if (
                e instanceof ccxt.AuthenticationError ||
                e instanceof ccxt.InsufficientFunds ||
                e instanceof ccxt.InvalidNonce ||
                e.message.includes("Margin is insufficient") ||
                e.message.includes("EOrder:Insufficient initial margin")
            ) {
                await this.events.emit<UserExchangeAccountErrorEvent>({
                    type: ConnectorWorkerEvents.USER_EX_ACC_ERROR,
                    data: {
                        userExAccId: job.id,
                        error: e.message
                    }
                });

                await this.db.pg.query(sql`
                UPDATE user_exchange_accs SET status = ${UserExchangeAccStatus.disabled},
                error = ${e.message || null}
                WHERE id = ${job.id};
                `);
            }

            throw e;
        }
    }

    async processNextJob(exAcc: UserExchangeAccount, job: ConnectorJob): Promise<{ updateBalances: boolean }> {
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

            try {
                const result = await this.processOrder(order, job);
                order = result.order;
                nextJob = result.nextJob;
            } catch (err) {
                this.log.error(err);

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
            }

            await this.db.pg.transaction(async (t) => {
                await this.#saveOrder(t, order);
                await this.#deleteJobs(t, order.id);
                if (nextJob) {
                    await this.#saveNextJob(t, { ...nextJob, id: uuid(), userExAccId, orderId });
                }
            });

            if (order.error) {
                await this.events.emit<OrdersErrorEvent>({
                    type: ConnectorWorkerEvents.ORDER_ERROR,
                    data: {
                        orderId: order.id,
                        userExAccId: order.userExAccId,
                        userRobotId: order.userRobotId,
                        status: order.status,
                        error: order.error
                    }
                });
            } else if (order.status === OrderStatus.closed || order.status === OrderStatus.canceled) {
                await this.events.emit<OrdersStatusEvent>({
                    type: ConnectorWorkerEvents.ORDER_STATUS,
                    data: {
                        orderId: order.id,
                        userExAccId: order.userExAccId,
                        userRobotId: order.userRobotId,
                        status: order.status
                    }
                });
            }

            this.log.info(`UserExAcc #${order.userExAccId} processed order ${order.id}`, order);
            if (order.status === OrderStatus.closed) return { updateBalances: true };
            return { updateBalances: false };
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
            } else if (orderJobType === OrderJobType.recreate) {
                this.log.info(`UserExAcc #${userExAccId} recreating order ${order.positionId}/${order.id}`);
                const response = await this.connectors[userExAccId].checkOrder(order);
                if (response.order.status === OrderStatus.canceled) {
                    ({ order, nextJob } = await this.connectors[userExAccId].createOrder({
                        ...response.order,
                        price: orderJobData.price
                    }));
                } else {
                    order = response.order;
                    nextJob = response.nextJob;
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
                if (order.status === OrderStatus.closed || order.status === OrderStatus.canceled)
                    return { order, nextJob: null };
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
            } else {
                throw new BaseError("Wrong connector job type", { order });
            }
            return { order, nextJob };
        } catch (e) {
            this.log.error(e, order);
            throw e;
        }
    }
}
