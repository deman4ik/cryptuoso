import { DatabaseTransactionConnection, sql } from "@cryptuoso/postgres";
import { Exwatcher, ExwatcherStatus, RobotBaseService, RobotBaseServiceConfig } from "@cryptuoso/robot";
import { UserPortfolioState } from "@cryptuoso/portfolio-state";
import {
    ExchangeCandle,
    Order,
    OrderJobType,
    OrderStatus,
    SignalEvent,
    Timeframe,
    ValidTimeframe
} from "@cryptuoso/market";
import {
    saveUserPositions,
    saveUserRobotState,
    UserRobot,
    UserRobotJob,
    UserRobotJobType,
    UserRobotStateExt,
    UserRobotStatus,
    UserTradeEvent,
    getCurrentUserRobotSettings
} from "@cryptuoso/user-robot-state";
import { Robot } from "@cryptuoso/robot-state";
import { RobotState, RobotStatus } from "@cryptuoso/robot-types";
import { keysToCamelCase, sleep, sortDesc, uniqueElementsBy } from "@cryptuoso/helpers";
import {
    UserPortfolioStatus,
    UserRobotRunnerEvents,
    UserRobotRunnerSchema,
    UserRobotRunnerStopUserPortfolioDedicatedRobots,
    UserRobotRunnerSyncUserPortfolioDedicatedRobots,
    UserRobotWorkerError,
    UserRobotWorkerEvents,
    UserRobotWorkerStatus,
    UserTradeEvents
} from "@cryptuoso/user-robot-events";
import dayjs from "@cryptuoso/dayjs";
import ccxt from "ccxt";
import cron from "node-cron";
import { v4 as uuid } from "uuid";
import { ConnectorJob, Priority } from "@cryptuoso/connector-state";
import { NewEvent } from "@cryptuoso/events";
import { TradeStatsRunnerEvents, TradeStatsRunnerUserRobot } from "@cryptuoso/trade-stats-events";
import {
    ConnectorWorkerEvents,
    OrdersErrorEvent,
    OrdersStatusEvent,
    UserExchangeAccountErrorEvent
} from "@cryptuoso/connector-events";
import { BaseError } from "@cryptuoso/errors";
import { UserExchangeAccBalances, UserExchangeAccount, UserExchangeAccStatus } from "@cryptuoso/user-state";
import { decrypt, PrivateConnector } from "@cryptuoso/ccxt-private";
import { SlonikError } from "slonik";
import { UserExAccKeysChangedEvent, UserExAccOutEvents, UserExAccOutSchema } from "@cryptuoso/user-events";
import { EventEmitter } from "events";
export interface UserRobotBaseServiceConfig extends RobotBaseServiceConfig {
    userPortfolioId: string;
}

export class UserRobotBaseService extends RobotBaseService {
    #userPortfolio: UserPortfolioState;
    #userExAcc: UserExchangeAccount;
    #keys: {
        api: string;
        secret: string;
    };
    #userConnector: PrivateConnector;
    #userRobotJobs: UserRobotJob[] = [];
    #connectorJobs: ConnectorJob[] = [];
    #orders: { [key: string]: Order } = {};
    robots: {
        [id: string]: { robot: Robot; userRobot: UserRobot; locked: boolean };
    } = {};
    #jobRetries = 3;
    #connectorJobsTimer: NodeJS.Timer;
    #userRobotJobsTimer: NodeJS.Timer;
    #jobsEmiter: EventEmitter;

    #cronCheckBalance: cron.ScheduledTask = cron.schedule("0 5 * * * *", this.checkBalance.bind(this), {
        scheduled: false
    });
    #cronCheckUnknownOrders: cron.ScheduledTask = cron.schedule("0 15 */12 * * *", this.checkBalance.bind(this), {
        scheduled: false
    });
    constructor(config?: UserRobotBaseServiceConfig) {
        super(config);

        this.#jobsEmiter = new EventEmitter({ captureRejections: true });
        this.addOnStartHandler(this.onUserRobotServiceStart.bind(this));
        this.addOnStopHandler(this.onUserServiceStop);
    }

    async onUserRobotServiceStart(): Promise<void> {
        this.events.subscribe({
            [UserRobotRunnerEvents.SYNC_USER_PORTFOLIO_DEDICATED_ROBOTS]: {
                schema: UserRobotRunnerSchema[UserRobotRunnerEvents.SYNC_USER_PORTFOLIO_DEDICATED_ROBOTS],
                handler: this.syncUserPortfolioRobots.bind(this)
            },
            [UserRobotRunnerEvents.STOP_USER_PORTFOLIO_DEDICATED_ROBOTS]: {
                schema: UserRobotRunnerSchema[UserRobotRunnerEvents.STOP_USER_PORTFOLIO_DEDICATED_ROBOTS],
                handler: this.stopUserPortfolioRobots.bind(this)
            },
            [UserExAccOutEvents.KEYS_CHANGED]: {
                schema: UserExAccOutSchema[UserExAccOutEvents.KEYS_CHANGED],
                handler: this.updateUserConnector.bind(this)
            }
        });
    }

    async onServiceStarted() {
        await this.getUserPortfolio();
        await this.getUserConnector();

        if (this.#userPortfolio.status === "started") {
            await this.startUserServiceProcessing();
        }
    }

    async startUserServiceProcessing() {
        this.#connectorJobsTimer = setTimeout(this.runConnectorJobs.bind(this), 0);
        this.#userRobotJobsTimer = setTimeout(this.runUserRobotJobs.bind(this), 0);
        this.#jobsEmiter.addListener("connectorJob", this.runConnectorJobs.bind(this));
        this.#jobsEmiter.addListener("userRobotJob", this.runUserRobotJobs.bind(this));
        this.#cronCheckBalance.start();
        this.#cronCheckUnknownOrders.start();
        await this.startRobotService();
    }

    async onUserServiceStop() {
        this.#cronCheckBalance.stop();
        this.#cronCheckUnknownOrders.stop();
    }

    //#region Overrides

    saveCandles(candles: ExchangeCandle[]) {
        for (const { ...props } of candles) {
            this.saveCandlesHistory({ ...props });
        }
    }

    async saveRobotState(transaction: DatabaseTransactionConnection, state: RobotState) {
        const userRobotId = this.getUserRobotIdByRobotId(state.id);
        await transaction.query(sql`
            UPDATE user_robots
               SET robot_state = ${JSON.stringify(state) || null}
             WHERE id = ${userRobotId};
        `);
    }
    //#endregion

    //#region Getters
    getRobotIdByUserRobotId(userRobotId: string) {
        return Object.values(this.robots).find(({ userRobot }) => userRobot.id === userRobotId).robot.id;
    }

    getUserRobotIdByRobotId(robotId: string) {
        return this.robots[robotId].userRobot.id;
    }

    async getCurrentPrice(asset: string, currency: string) {
        const exwatcherId = this.createExwatcherId(asset, currency);
        while (!this.candlesCurrent[exwatcherId] || Object.keys(this.candlesCurrent[exwatcherId]).length === 0) {
            await sleep(200);
        }
        return Object.values(this.candlesCurrent[exwatcherId])[0].close;
    }

    //#endregion

    //#region Select Queries
    async getUserPortfolio() {
        const userPortfolio = await this.db.pg.one<UserPortfolioState>(sql`
        SELECT  p.id, p.allocation, p.user_id, p.user_ex_acc_id, p.exchange, p.status, 
                p.started_at,
              p.active_from as user_portfolio_settings_active_from,
              p.user_portfolio_settings as settings,
              p.robots 
           FROM v_user_portfolios p
           WHERE p.id = ${this.userPortfolioId}; 
       `);

        if (userPortfolio.allocation !== "dedicated")
            throw new Error(`User Portfolios #${this.userPortfolioId} allocation must be 'dedicated'`);

        if (userPortfolio.exchange !== this.exchange)
            throw new Error(
                `User Portfolios #${this.userPortfolioId} exchange (${userPortfolio.exchange}) is not service exchange (${this.exchange})`
            );

        this.#userPortfolio = userPortfolio;
    }

    async getUserConnector() {
        await this.getUserExAcc();
        this.#userConnector = new PrivateConnector({
            exchange: this.exchange,
            keys: {
                apiKey: this.#keys.api,
                secret: this.#keys.secret
            },
            ordersCache: this.#userExAcc.ordersCache
        });
        await this.#userConnector.initConnector();
        await this.getConnectorJobs();
    }

    async getUserExAcc() {
        try {
            const userExAcc = await this.db.pg.one<UserExchangeAccount>(sql`
         SELECT * FROM user_exchange_accs
         WHERE id = ${this.#userPortfolio.userExAccId}
         `);
            if (userExAcc.allocation !== "dedicated")
                throw new Error(`User Exchange Account's #${this.userPortfolioId} allocation must be 'dedicated'`);
            if (userExAcc.exchange !== this.exchange)
                throw new Error(
                    `User Exchange Account's #${this.#userPortfolio.userExAccId} exchange (${
                        userExAcc.exchange
                    }) is not service exchange (${this.exchange})`
                );

            this.#userExAcc = userExAcc;

            const {
                userId,
                keys: { key, secret }
            } = this.#userExAcc;

            this.#keys = {
                api: decrypt(userId, key),
                secret: decrypt(userId, secret)
            };
        } catch (err) {
            this.log.error(`Failed to decrypt #${this.#userPortfolio.userExAccId} keys - ${err.message}`);
            if (err.message.includes("bad decrypt")) {
                await this.events.emit<UserExchangeAccountErrorEvent>({
                    type: ConnectorWorkerEvents.USER_EX_ACC_ERROR,
                    data: {
                        userExAccId: this.#userPortfolio.userExAccId,
                        timestamp: dayjs.utc().toISOString(),
                        error: err.message
                    }
                });

                await this.db.pg.query(sql`
            UPDATE user_exchange_accs SET status = ${UserExchangeAccStatus.disabled},
            error = ${err.message || null}
            WHERE id = ${this.#userPortfolio.userExAccId};
            `);
            }
            throw err;
        }
    }

    async getExwatcherSubscriptions(): Promise<Exwatcher[]> {
        const markets = await this.db.pg.any<{ asset: string; currency: string; timeframe: ValidTimeframe }>(sql`
        SELECT DISTINCT r.asset, r.currency, r.timeframe 
        FROM user_robots ur, robots r
        WHERE ur.robot_id = r.id
        AND ur.status in ('started','stopping')
        AND ur.allocation = 'dedicated'
        AND ur.user_portfolio_id = ${this.userPortfolioId};`);

        const subscriptions: { [key: string]: Exwatcher } = {};
        for (const { asset, currency, timeframe } of markets) {
            const id = this.createExwatcherId(asset, currency);

            if (!subscriptions[id]) {
                subscriptions[id] = {
                    id,
                    exchange: this.exchange,
                    asset,
                    currency,
                    status: ExwatcherStatus.pending,
                    timeframes: [timeframe],
                    importerId: null,
                    importStartedAt: null
                };
            } else {
                subscriptions[id].timeframes.push(timeframe);
            }
        }
        return Object.values(subscriptions);
    }

    async getOrderByPrevId(orderId: string) {
        return this.db.pg.maybeOne<Order>(sql`
        SELECT * from user_orders
        WHERE prev_order_id = ${orderId}
        `);
    }

    //#region Orders

    async saveUserOrderT(t: DatabaseTransactionConnection, order: Order) {
        await t.query(sql`
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
        this.#orders[order.id] = order;
    }

    async updateOrderT(t: DatabaseTransactionConnection, order: Order) {
        try {
            await t.query(sql`
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
            this.#orders[order.id] = order;
        } catch (error) {
            this.log.error("saveOrder error", error, order);
            throw error;
        }
    }

    //#endregion

    //#region Connector Jobs
    async updateUserConnector({ userExAccId }: UserExAccKeysChangedEvent) {
        if (userExAccId !== this.#userExAcc.id) return;
        await this.getUserConnector();
    }

    async getConnectorJobs() {
        const jobs = await this.db.pg.any<ConnectorJob>(sql`
         SELECT * FROM connector_jobs
         WHERE user_ex_acc_id = ${this.#userExAcc.id}
           AND allocation = 'dedicated'
           ORDER BY priority, next_job_at
         `);
        for (const job of jobs) {
            if (!this.#connectorJobs.map(({ id }) => id).includes(job.id)) this.#connectorJobs.push(job);
        }
    }

    async addConnectorJobT(t: DatabaseTransactionConnection, nextJob: ConnectorJob) {
        await t.query(sql`
        INSERT INTO connector_jobs (id, user_ex_acc_id, order_id, next_job_at, priority, type, allocation, data )
        VALUES (${nextJob.id}, ${nextJob.userExAccId}, 
        ${nextJob.orderId}, ${nextJob.nextJobAt || null}, 
        ${nextJob.priority || 3}, ${nextJob.type}, 
        ${"dedicated"},
        ${JSON.stringify(nextJob.data) || null});
        `);

        if (!this.#connectorJobs.find((c) => c.id === nextJob.id)) this.#connectorJobs.push(nextJob);
    }

    async deleteConnectorJobsT(t: DatabaseTransactionConnection, orderId: string) {
        await t.query(sql`DELETE FROM connector_jobs WHERE order_id = ${orderId};`);
        this.#connectorJobs = [...this.#connectorJobs.filter(({ orderId: jobOrderId }) => jobOrderId !== orderId)];
    }

    //#endregion

    //#region User Robot Jobs
    async getUserRobotJobs(userRobotId: string) {
        const jobs = await this.db.pg.any<UserRobotJob>(sql`
         SELECT * FROM user_robot_jobs
         WHERE user_robot_id = ${userRobotId}
           AND allocation = 'dedicated'
           ORDER BY created_at asc
         `);
        for (const job of jobs) {
            if (!this.#userRobotJobs.map(({ id }) => id).includes(job.id)) this.#userRobotJobs.push(job);
        }
    }

    async addUserRobotJob(nextJob: UserRobotJob) {
        await this.db.pg.query(sql`
        INSERT INTO user_robot_jobs
        (
            id,
            user_robot_id,
            type,
            data,
            allocation
        ) VALUES (
            ${nextJob.id || uuid()},
            ${nextJob.userRobotId},
            ${nextJob.type},
            ${JSON.stringify(nextJob.data) || null},
            ${"dedicated"}
        )
        ON CONFLICT ON CONSTRAINT user_robot_jobs_user_robot_id_type_data_key 
         DO UPDATE SET updated_at = now(),
         type = excluded.type,
         data = excluded.data,
         retries = null,
         error = null;
        `);

        if (!this.#userRobotJobs.find((c) => c.id === nextJob.id)) this.#userRobotJobs.push(nextJob);
        this.#jobsEmiter.emit("userRobotJob");
    }

    async updateUserRobotJob(job: UserRobotJob) {
        await this.db.pg.query(sql`
        UPDATE user_robot_jobs
        SET retries = ${job.retries}, 
            error = ${job.error}
        WHERE id = ${job.id};`);
        if (this.#userRobotJobs.find((c) => c.id === job.id))
            this.#userRobotJobs = [...this.#userRobotJobs.filter(({ id: jobId }) => jobId !== job.id)];
        this.#userRobotJobs.push(job);
    }

    async deleteUserRobotJobT(t: DatabaseTransactionConnection, id: string) {
        await t.query(sql`DELETE FROM user_robot_jobs WHERE id = ${id};`);
        this.#userRobotJobs = [...this.#userRobotJobs.filter(({ id: jobId }) => jobId !== id)];
    }

    async deleteUserRobotJobsT(t: DatabaseTransactionConnection, userRobotId: string) {
        await t.query(sql`DELETE FROM user_robot_jobs WHERE user_robot_id = ${userRobotId};`);
        this.#userRobotJobs = [
            ...this.#userRobotJobs.filter(({ userRobotId: jobUserRobotId }) => jobUserRobotId !== userRobotId)
        ];
    }
    //#endregion

    //#region Connector
    async runConnectorJobs() {
        const beacon = this.lightship.createBeacon();
        try {
            const currentDate = dayjs.utc().valueOf();
            const unlockedOrders = Object.values(this.#orders)
                .filter(({ locked }) => locked !== true)
                .map(({ id }) => id);
            const freeJobs = this.#connectorJobs.filter(
                ({ orderId, nextJobAt }) =>
                    unlockedOrders.includes(orderId) && dayjs.utc(nextJobAt).valueOf() <= currentDate
            );
            if (freeJobs.length) {
                this.log.debug(`Processing ${freeJobs.length} connector jobs`);
                const orderIds = uniqueElementsBy(freeJobs, (a, b) => a.orderId === b.orderId).map(
                    ({ orderId }) => orderId
                );
                await Promise.all(orderIds.map(async (orderId) => await this.processOrderJobs(orderId)));
            }
        } catch (err) {
            this.log.error(`Failed to run connector jobs - ${err.message}`);
        } finally {
            await beacon.die();
            if (!this.lightship.isServerShuttingDown()) {
                this.#connectorJobsTimer = setTimeout(this.runConnectorJobs.bind(this), 1000);
            }
        }
    }

    async processOrderJobs(orderId: string) {
        if (!this.#orders[orderId]) return;
        while (this.#orders[orderId].locked) {
            await sleep(200);
        }
        try {
            this.#orders[orderId].locked = true;

            const [job] = this.#connectorJobs
                .filter(({ orderId: jobOrderId }) => jobOrderId === orderId)
                .sort((a, b) => sortDesc(dayjs.utc(a.nextJobAt).valueOf(), dayjs.utc(b.nextJobAt).valueOf()));

            if (job) {
                try {
                    let order = this.#orders[orderId];
                    order.error = null;
                    let nextJob: {
                        type: OrderJobType;
                        priority: Priority;
                        nextJobAt: string;
                    };
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
                        await this.checkBalance();
                    }

                    await this.db.pg.transaction(async (t) => {
                        await this.updateOrderT(t, order);
                        await this.deleteConnectorJobsT(t, order.id);
                        if (nextJob) {
                            await this.addConnectorJobT(t, {
                                ...nextJob,
                                id: uuid(),
                                userExAccId: this.#userExAcc.id,
                                orderId,
                                allocation: "dedicated"
                            });
                        }
                    });

                    if (nextJob) this.#jobsEmiter.emit("connectorJob");

                    if (
                        (order.status === OrderStatus.closed || order.status === OrderStatus.canceled) &&
                        !order.error
                    ) {
                        await this.addUserRobotJob({
                            id: uuid(),
                            userRobotId: order.userRobotId,
                            type: UserRobotJobType.order,
                            data: {
                                orderId: order.id,
                                timestamp: dayjs.utc().toISOString(),
                                userExAccId: order.userExAccId,
                                userRobotId: order.userRobotId,
                                userPositionId: order.userPositionId,
                                positionId: order.positionId,
                                status: order.status
                            },
                            allocation: "dedicated"
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
                        this.#userExAcc.status = UserExchangeAccStatus.invalid;
                        this.#userExAcc.error = e.message;
                    }
                }
            }
        } finally {
            this.#orders[orderId].locked = false;
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
                    ({ order, nextJob } = await this.#userConnector.checkOrder(order));
                    return {
                        order,
                        nextJob
                    };
                }

                ({ order, nextJob } = await this.#userConnector.createOrder(order));
                return { order, nextJob };
            } else if (orderJobType === OrderJobType.recreate) {
                this.log.info(`UserExAcc #${userExAccId} recreating order ${order.positionId}/${order.id}`);
                const response = await this.#userConnector.checkOrder(order);
                if (response.order.status === OrderStatus.canceled) {
                    const orderExists = await this.getOrderByPrevId(order.id);

                    if (orderExists) {
                        this.log.warn(
                            `UserExAcc #${userExAccId} recreating order ${order.positionId}/${order.id} - Order exists`
                        );
                        await this.db.pg.transaction(async (t) => {
                            await this.updateOrderT(t, response.order);
                            await this.deleteConnectorJobsT(t, response.order.id);
                        });
                        ({ order, nextJob } = await this.#userConnector.checkOrder(orderExists));
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
                            await this.updateOrderT(t, response.order);
                            await this.saveUserOrderT(t, newOrder);
                        });
                        ({ order, nextJob } = await this.#userConnector.createOrder(newOrder));
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
                ({ order, nextJob } = await this.#userConnector.cancelOrder(order));
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
                    const orderExists = await this.getOrderByPrevId(order.id);
                    if (orderExists) {
                        await this.db.pg.transaction(async (t) => {
                            await this.deleteConnectorJobsT(t, order.id);
                        });
                        order = { ...orderExists };
                    } else return { order, nextJob: null };
                }

                ({ order, nextJob } = await this.#userConnector.checkOrder(order));

                if (
                    order.status === OrderStatus.open &&
                    order.exTimestamp &&
                    dayjs.utc().diff(dayjs.utc(order.exTimestamp), "second") > order.params.orderTimeout
                ) {
                    this.log.info(
                        `UserExAcc #${userExAccId} canceling order ${order.positionId}/${order.id} by timeout`
                    );
                    ({ order, nextJob } = await this.#userConnector.cancelOrder(order));
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

    async checkBalance() {
        this.log.debug(`Checking balance`);
        const balances: UserExchangeAccBalances = await this.#userConnector.getBalances();
        this.log.info(`Current balance - ${balances.totalUSD}$`);
        await this.db.pg.query(sql`
        UPDATE user_exchange_accs SET balances = ${JSON.stringify(balances) || null}
        WHERE id = ${this.#userExAcc.id};
        `);
        this.#userExAcc.balances = balances;
    }

    async checkUnknownOrders() {
        this.log.debug(`Checking Unknown Orders`);
        const pairs: { asset: string; currency: string }[] = uniqueElementsBy(
            Object.values(this.robots).map(({ robot }) => ({ asset: robot._asset, currency: robot._currency })),
            (a, b) => a.asset === b.asset && a.currency === b.currency
        );
        if (pairs && Array.isArray(pairs) && pairs.length > 0) {
            for (const { asset, currency } of pairs) {
                const orders = await this.#userConnector.getRecentOrders(asset, currency);
                if (orders && orders.length) {
                    const ids = orders.map((o) => o.exId);
                    const ordersExists = await this.db.pg.any<{ exId: string }>(sql`
                SELECT ex_id FROM user_orders
                WHERE user_ex_acc_id = ${this.#userExAcc.id}
                AND ex_id in (${sql.join(ids, sql`, `)});
                `);
                    const idsNotExists = ids.filter((exId) => !ordersExists.map((o) => o.exId).includes(exId));
                    if (idsNotExists.length) {
                        const unknownOrders = orders
                            .filter(({ exId }) => idsNotExists.includes(exId))
                            .map((o) => ({
                                ...o,
                                userExAccId: this.#userExAcc.id,
                                info: JSON.stringify(o.info)
                            }));

                        this.log.warn(`Found ${unknownOrders.length} Unknown Orders`);
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

    //#endregion

    //#region User Robots
    async syncUserPortfolioRobots({ userPortfolioId }: UserRobotRunnerSyncUserPortfolioDedicatedRobots) {
        if (userPortfolioId !== this.userPortfolioId) return;
        const oldUserPortfolioStatus = this.#userPortfolio.status;
        await this.getUserPortfolio();

        if (this.#userPortfolio.status === "started") {
            if (oldUserPortfolioStatus !== "started") {
                await this.startUserServiceProcessing();
            } else {
                await this.unsubscribeUserRobots();
                await this.resubscribe();
                await this.resubscribeUserRobots();
            }
        }
    }

    async stopUserPortfolioRobots({ userPortfolioId }: UserRobotRunnerStopUserPortfolioDedicatedRobots) {
        try {
            if (userPortfolioId !== this.userPortfolioId) return;
            for (const id of Object.keys(this.robots)) {
                await this.addUserRobotJob({
                    id: uuid(),
                    userRobotId: this.robots[id].userRobot.id,
                    type: UserRobotJobType.stop,
                    data: {
                        message: null
                    },
                    allocation: "dedicated"
                });
            }
        } catch (err) {
            this.log.error(`Failed to stop user portfolio #${this.userPortfolioId} - ${err.message}`);
            throw err;
        }
    }

    async subscribeRobots({ asset, currency }: Exwatcher) {
        const rawData = await this.db.pg.any<UserRobotStateExt>(sql`
        SELECT * FROM v_user_robot_state WHERE (status in ('started','stopping')
        OR (settings->'active')::boolean = true)
         AND user_portfolio_id = ${this.userPortfolioId}
         AND asset = ${asset}
         AND currency = ${currency}
         AND allocation = 'dedicated';                   
      `);

        const userRobots = keysToCamelCase(rawData) as UserRobotStateExt[];
        this.log.info(`Subscribing ${userRobots.length} user robots`);
        await Promise.all(
            userRobots.map(async (userRobot) => {
                if (!this.robots[userRobot.robotId]) {
                    await this.subscribeUserRobot(userRobot);
                }
            })
        );
    }

    async resubscribeUserRobots() {
        const rawData = await this.db.pg.any<UserRobotStateExt>(sql`
        SELECT * FROM v_user_robot_state WHERE 
        (status in ('started','stopping')
        OR (settings->'active')::boolean = true)
         AND user_portfolio_id = ${this.userPortfolioId}
         AND allocation = 'dedicated'
         AND robot_id not in (${sql.join(Object.keys(this.robots), sql`, `)});                   
      `);

        const userRobots = keysToCamelCase(rawData) as UserRobotStateExt[];
        this.log.info(`Subscribing ${userRobots.length} new user robots`);
        await Promise.all(
            userRobots.map(async (userRobot) => {
                if (!this.robots[userRobot.robotId]) {
                    await this.subscribeUserRobot(userRobot);
                }
            })
        );
    }

    async subscribeUserRobot(userRobot: UserRobotStateExt) {
        const { robotId } = userRobot;
        try {
            const userRobotSettings = getCurrentUserRobotSettings(userRobot);

            this.robots[robotId] = {
                robot: null,
                userRobot: new UserRobot({ ...userRobot, settings: userRobotSettings }),
                locked: true
            };

            if (!userRobot.robotState || !Object.keys(userRobot.robotState).length) {
                const robotState = await this.db.pg.one<RobotState>(sql`
        SELECT r.id, 
               r.exchange, 
               r.asset, 
               r.currency, 
               r.timeframe, 
               r.strategy, 
               json_build_object('strategySettings', rs.strategy_settings,
                                 'robotSettings', rs.robot_settings,
                                 'activeFrom', rs.active_from) as settings,
               r.last_candle, 
               r.state, 
               r.has_alerts, 
               r.status,
               r.started_at, 
               r.stopped_at
        FROM robots r, v_robot_settings rs 
        WHERE rs.robot_id = r.id AND r.exchange = ${this.exchange}
        AND r.id = ${robotId};`);

                this.robots[robotId].robot = new Robot({
                    id: robotState.id,
                    exchange: robotState.exchange,
                    asset: robotState.asset,
                    currency: robotState.currency,
                    timeframe: robotState.timeframe,
                    strategy: robotState.strategy,
                    settings: {
                        strategySettings: robotState.settings.strategySettings,
                        robotSettings: robotState.settings.robotSettings,
                        activeFrom: robotState.settings.activeFrom
                    }
                });
                this.robots[robotId].robot.initStrategy();
            } else {
                this.robots[robotId].robot = new Robot(userRobot.robotState);
            }
            const { asset, currency, timeframe } = this.robots[robotId].robot;
            const prevTime = Timeframe.getPrevSince(dayjs.utc().toISOString(), timeframe);
            const exwatcherId = this.createExwatcherId(asset, currency);

            const candles = this.candlesHistory[exwatcherId][timeframe].filter((c) => c.time <= prevTime);
            this.robots[robotId].robot.handleHistoryCandles(candles);
            await this.robots[robotId].robot.initIndicators();

            if (userRobot.positions && Array.isArray(userRobot.positions) && userRobot.positions.length) {
                for (const { entryOrders, exitOrders } of userRobot.positions) {
                    if (entryOrders && Array.isArray(entryOrders) && entryOrders.length) {
                        const openEntryOrders = entryOrders.filter(
                            ({ status }: Order) => status === OrderStatus.new || status === OrderStatus.open
                        );
                        for (const order of openEntryOrders) {
                            this.#orders[order.id] = order;
                        }
                    }
                    if (exitOrders && Array.isArray(exitOrders) && exitOrders.length) {
                        const openExitOrders = exitOrders.filter(
                            ({ status }: Order) => status === OrderStatus.new || status === OrderStatus.open
                        );
                        for (const order of openExitOrders) {
                            this.#orders[order.id] = order;
                        }
                    }
                }
            }

            await this.getUserRobotJobs(userRobot.id);

            this.initActiveRobotAlerts(robotId);
            if (this.robots[robotId].robot.status !== RobotStatus.started) {
                this.robots[robotId].robot.start();
            }
            this.robots[robotId].locked = false;
            this.log.info(`Robot #${robotId} is subscribed! Total: ${Object.keys(this.robots).length}`);
        } catch (err) {
            this.log.error(`Failed to subscribe #${userRobot.id} user robot ${err.message}`);

            this.log.error(err);

            await this.events.emit<UserRobotWorkerError>({
                type: UserRobotWorkerEvents.ERROR,
                data: {
                    userRobotId: userRobot.id,
                    userPortfolioId: this.userPortfolioId,
                    error: `Failed to subscribe #${robotId} robot ${err.message}`,
                    timestamp: dayjs.utc().toISOString()
                }
            });
        }
    }

    async unsubscribeUserRobots() {
        const currentActiveUserRobots = Object.values(this.robots)
            .filter(({ userRobot }) => userRobot.settings.active)
            .map(({ userRobot }) => userRobot.id);

        this.log.info(`Unsubscribing user robots (${currentActiveUserRobots.length} active robots)`);
        if (currentActiveUserRobots.length) {
            const inactiveUserRobots = await this.db.pg.any<{ id: string }>(sql`
            SELECT id 
            FROM user_robots 
            WHERE user_portfolio_id = ${this.userPortfolioId}
            AND (settings->'active')::boolean = false
            AND allocation = 'dedicated'
            AND id in (${sql.join(currentActiveUserRobots, sql`, `)})
            ;`);
            this.log.info(`Unsubscribing user robots (${inactiveUserRobots.length} inactive robots)`);
            await Promise.all(
                inactiveUserRobots.map(
                    async ({ id }) =>
                        await this.addUserRobotJob({
                            id: uuid(),
                            userRobotId: id,
                            type: UserRobotJobType.disable,
                            data: null,
                            allocation: "dedicated"
                        })
                )
            );
        }
    }

    async handleSignal(signal: SignalEvent) {
        await this.addUserRobotJob({
            id: uuid(),
            userRobotId: this.getUserRobotIdByRobotId(signal.robotId),
            type: UserRobotJobType.signal,
            data: signal,
            allocation: "dedicated"
        });
    }

    async runUserRobotJobs() {
        const beacon = this.lightship.createBeacon();
        try {
            const unlockedUserRobots = Object.values(this.robots)
                .filter(
                    ({ locked, userRobot }) =>
                        locked === false &&
                        userRobot.status !== UserRobotStatus.paused &&
                        userRobot.status !== UserRobotStatus.stopped
                )
                .map(({ userRobot }) => userRobot.id);
            const freeJobs = this.#userRobotJobs.filter(({ userRobotId }) => unlockedUserRobots.includes(userRobotId));
            if (freeJobs.length) {
                this.log.debug(`Processing ${freeJobs.length} user robot jobs`);
                const userRobotIds = uniqueElementsBy(freeJobs, (a, b) => a.userRobotId === b.userRobotId).map(
                    ({ userRobotId }) => userRobotId
                );

                await Promise.all(userRobotIds.map((userRobotId) => this.processUserRobotJobs(userRobotId)));
            }
        } catch (err) {
            this.log.error(err);
            this.log.error(`Failed to run user robot jobs - ${err.message}`);
        } finally {
            await beacon.die();
            if (!this.lightship.isServerShuttingDown()) {
                this.#userRobotJobsTimer = setTimeout(this.runUserRobotJobs.bind(this), 1000);
            }
        }
    }

    async processUserRobotJobs(userRobotId: string) {
        const robotId = this.getRobotIdByUserRobotId(userRobotId);
        try {
            while (this.robots[robotId].locked) {
                await sleep(200);
            }
            this.lockRobot(robotId);

            const freeJobs = this.#userRobotJobs.filter(
                ({ userRobotId: jobUserRobotId }) => jobUserRobotId === userRobotId
            );
            if (freeJobs) {
                for (const job of freeJobs) {
                    await this.processUserRobot(job);
                }
            }
        } finally {
            this.unlockRobot(robotId);
        }
    }

    async processUserRobot(job: UserRobotJob) {
        this.log.debug(`Processing #${job.userRobotId} user robot job ${job.type}`);
        const { userRobotId, type, data } = job;
        const robotId = this.getRobotIdByUserRobotId(userRobotId);
        const userRobot = this.robots[robotId].userRobot;
        const userRobotSettings = getCurrentUserRobotSettings({
            settings: userRobot._settings,
            currentPrice: await this.getCurrentPrice(userRobot._asset, userRobot._currency),
            totalBalanceUsd: this.#userExAcc.balances.totalUSD,
            userPortfolioId: this.userPortfolioId,
            userPortfolio: {
                settings: this.#userPortfolio.settings
            },
            limits: userRobot._limits,
            precision: userRobot._precision
        });
        userRobot.settings = userRobotSettings;
        if (userRobot.status === UserRobotStatus.paused) return;
        try {
            const eventsToSend: NewEvent<any>[] = [];
            if (type === UserRobotJobType.signal) {
                userRobot.handleSignal(data as SignalEvent);
            } else if (type === UserRobotJobType.order) {
                const orderStatusEvent = data as OrdersStatusEvent;
                const order = this.#orders[orderStatusEvent.orderId];
                if (!userRobot._positions[order.userPositionId]) return;
                userRobot._positions[order.userPositionId].handleOrder(order);
                userRobot.handleOrder(orderStatusEvent);
            } else if (type === UserRobotJobType.stop) {
                //  if (userRobot.status === UserRobotStatus.stopped) return;
                userRobot.stop(data as { message?: string });
            } else if (type === UserRobotJobType.pause) {
                //  if (userRobot.status === UserRobotStatus.paused || userRobot.status === UserRobotStatus.stopped) return;
                userRobot.pause(data as { message?: string });
                const pausedEvent: NewEvent<UserRobotWorkerStatus> = {
                    type: UserRobotWorkerEvents.PAUSED,
                    data: {
                        userRobotId: userRobot.id,
                        timestamp: dayjs.utc().toISOString(),
                        status: UserRobotStatus.paused,
                        message: userRobot.message,
                        userPortfolioId: this.userPortfolioId
                    }
                };
                eventsToSend.push(pausedEvent);
            } else if (type === UserRobotJobType.disable) {
                userRobot.disable();
            } else throw new BaseError(`Unknown user robot job type "${type}"`, job);

            if (
                (userRobot.status === UserRobotStatus.stopping || userRobot.state.settings?.active === false) &&
                !userRobot.hasActivePositions
            ) {
                userRobot.setStop();
                const stoppedEvent: NewEvent<UserRobotWorkerStatus> = {
                    type: UserRobotWorkerEvents.STOPPED,
                    data: {
                        userRobotId: userRobot.id,
                        timestamp: userRobot.stoppedAt,
                        status: UserRobotStatus.stopped,
                        message: userRobot.message,
                        userPortfolioId: this.userPortfolioId
                    }
                };
                eventsToSend.push(stoppedEvent);
                this.log.info(`User Robot #${userRobot.id} stopped!`);
            }

            if (userRobot.positions.length) {
                if (userRobot.ordersToCreate.length) {
                    for (const order of userRobot.ordersToCreate) {
                        this.#orders[order.id] = order;
                    }
                }

                if (userRobot.hasCanceledPositions) {
                    this.log.warn(`User Robot #${userRobot.id} has canceled positions!`);
                    for (const pos of userRobot.canceledPositions) {
                        this.robots[robotId].robot.handleTradeCancelation(pos.code);
                    }
                }

                if (userRobot.hasClosedPositions) {
                    if (userRobot.state.userPortfolioId) {
                        const tradeStatsEvent: NewEvent<TradeStatsRunnerUserRobot> = {
                            type: TradeStatsRunnerEvents.USER_ROBOT,
                            data: {
                                userRobotId: userRobot.id,
                                userPortfolioId: this.userPortfolioId
                            }
                        };
                        eventsToSend.push(tradeStatsEvent);
                    }
                }

                if (userRobot.recentTrades.length) {
                    for (const trade of userRobot.recentTrades) {
                        if (trade.exitExecuted === 0) this.robots[robotId].robot.handleEntryTradeConfirmation(trade);
                        const tradeEvent: NewEvent<UserTradeEvent> = {
                            type: UserTradeEvents.TRADE,
                            data: trade
                        };
                        eventsToSend.push(tradeEvent);
                    }
                }
            }

            await this.db.pg.transaction(async (t) => {
                if (userRobot.positions.length) {
                    await saveUserPositions(t, userRobot.positions);

                    if (userRobot.ordersToCreate.length) {
                        for (const newOrder of userRobot.ordersToCreate) {
                            await this.saveUserOrderT(t, newOrder);
                        }
                    }
                }

                await saveUserRobotState(t, {
                    ...userRobot.state,
                    robotState:
                        userRobot.status !== UserRobotStatus.stopped ? this.robots[robotId].robot.robotState : null
                });

                if (userRobot.status === UserRobotStatus.stopped) await this.deleteUserRobotJobsT(t, userRobot.id);
                else await this.deleteUserRobotJobT(t, job.id);

                if (userRobot.connectorJobs.length && userRobot.status !== UserRobotStatus.stopped) {
                    for (const connectorJob of userRobot.connectorJobs) {
                        await this.addConnectorJobT(t, connectorJob);
                    }
                }
            });

            if (userRobot.connectorJobs.length && userRobot.status !== UserRobotStatus.stopped)
                this.#jobsEmiter.emit("connectorJob");

            if (eventsToSend.length) {
                for (const event of eventsToSend) {
                    await this.events.emit(event);
                }
            }

            userRobot.clear();

            if (userRobot.status === UserRobotStatus.stopped) {
                delete this.robots[robotId];
            }

            return userRobot.status;
        } catch (err) {
            this.log.error(`Failed to process User Robot's #${userRobot.id} ${type} job - ${err.message}`);
            this.log.error(err);
            if (err instanceof SlonikError) {
                try {
                    await this.updateUserRobotJob({ ...job, retries: job.retries ? job.retries + 1 : 1 });
                } catch (e) {
                    this.log.error(`Failed to update user robot's #${userRobotId} failed job status`, e);
                }
            }

            if (!(err instanceof SlonikError) || job.retries >= this.#jobRetries) {
                await this.events.emit<UserRobotWorkerError>({
                    type: UserRobotWorkerEvents.ERROR,
                    data: {
                        userRobotId: userRobot.id,
                        userPortfolioId: this.userPortfolioId,
                        timestamp: dayjs.utc().toISOString(),
                        error: err.message,
                        job
                    }
                });

                await this.db.pg.query(sql`
                UPDATE user_robots
                SET status = ${UserRobotStatus.paused}, 
                    message = ${err.message}
                WHERE id = ${userRobot.id};`);
                await this.events.emit<UserRobotWorkerStatus>({
                    type: UserRobotWorkerEvents.PAUSED,
                    data: {
                        userRobotId: userRobot.id,
                        timestamp: dayjs.utc().toISOString(),
                        status: UserRobotStatus.paused,
                        message: err.message
                    }
                });
                this.robots[robotId].robot._status = RobotStatus.stopped;
                await this.setPortfolioError(err.message);
            }
        }
    }

    async setPortfolioError(message: string) {
        try {
            if (this.#userPortfolio.status !== "error") {
                this.#userPortfolio.status = "error";
                this.#userPortfolio.message = message;

                await this.db.pg.query(
                    sql`UPDATE user_portfolios set status = 'error', message = ${message} WHERE id = ${this.userPortfolioId}`
                );
                await this.events.emit<UserPortfolioStatus>({
                    type: UserRobotWorkerEvents.ERROR_PORTFOLIO,
                    data: {
                        userPortfolioId: this.userPortfolioId,
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
}
