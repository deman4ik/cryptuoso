import { DatabaseTransactionConnectionType, sql } from "@cryptuoso/postgres";
import { Exwatcher, ExwatcherStatus, RobotBaseService, RobotBaseServiceConfig, UserRobotTask } from "@cryptuoso/robot";
import { UserPortfolioState } from "@cryptuoso/portfolio-state";
import { ExchangeCandle, Order, SignalEvent } from "@cryptuoso/market";
import {
    saveUserOrders,
    saveUserPositions,
    saveUserRobotState,
    UserRobot,
    UserRobotJobType,
    UserRobotStateExt,
    UserRobotStatus,
    UserTradeEvent
} from "@cryptuoso/user-robot-state";
import { Robot, RobotState, RobotStatus } from "@cryptuoso/robot-state";
import { keysToCamelCase, sleep } from "@cryptuoso/helpers";
import { getCurrentUserRobotSettings } from "@cryptuoso/robot-settings";
import {
    UserRobotWorkerError,
    UserRobotWorkerEvents,
    UserRobotWorkerStatus,
    UserTradeEvents
} from "@cryptuoso/user-robot-events";
import dayjs from "dayjs";
import { ConnectorJob } from "@cryptuoso/connector-state";
import { NewEvent } from "@cryptuoso/events";
import { TradeStatsRunnerEvents, TradeStatsRunnerUserRobot } from "@cryptuoso/trade-stats-events";
import { ConnectorWorkerEvents, OrdersStatusEvent, UserExchangeAccountErrorEvent } from "@cryptuoso/connector-events";
import { BaseError } from "@cryptuoso/errors";
import { UserExchangeAccount, UserExchangeAccStatus } from "@cryptuoso/user-state";
import { decrypt, PrivateConnector } from "@cryptuoso/ccxt-private";

export interface UserRobotBaseServiceConfig extends RobotBaseServiceConfig {
    userPortfolioId: string;
}

export class UserRobotBaseService extends RobotBaseService {
    #userPortfolioId: string;
    #userPortfolio: UserPortfolioState;
    #userExAcc: UserExchangeAccount;
    #keys: {
        api: string;
        secret: string;
    };
    #userConnector: PrivateConnector;
    #connectorJobs: ConnectorJob[] = [];
    #orders: { [key: string]: Order };
    robots: {
        [id: string]: { robot: Robot; userRobot: UserRobot; locked: boolean };
    } = {};

    constructor(config: UserRobotBaseServiceConfig) {
        super(config);

        this.#userPortfolioId = config.userPortfolioId || process.env.USER_PORTFOLIO_ID;

        //TODO: handle portfolio builded event
    }

    async onServiceStarted() {
        await this.getUserPortfolio();
        await this.getUserConnector();
        await this.startRobotService();
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
                throw new Error(`User Exchange Account's #${this.#userPortfolioId} allocation must be 'dedicated'`);
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
        const markets = await this.db.pg.any<{ asset: string; currency: string }>(sql`
        SELECT DISTINCT r.asset, r.currency 
        FROM user_robots ur, robots r
        WHERE ur.robot_id = r.id
        AND ur.status = 'started'
        AND ur.user_portfolio_id = ${this.#userPortfolioId};`);

        return markets.map((m) => ({
            ...m,
            id: this.createExwatcherId(m.asset, m.currency),
            exchange: this.exchange,
            status: ExwatcherStatus.pending,
            importerId: null,
            importStartedAt: null,
            error: null
        }));
    }

    async saveSubscription(subscription: Exwatcher): Promise<void> {
        return;
    }

    async deleteSubscription(id: string): Promise<void> {
        return;
    }

    saveCandles(candles: ExchangeCandle[]) {
        for (const { ...props } of candles) {
            this.saveCandlesHistory({ ...props });
        }
    }

    async getUserPortfolio() {
        const userPortfolio = await this.db.pg.one<UserPortfolioState>(sql`
        SELECT  p.id, p.allocation, p.user_id, p.user_ex_acc_id, p.exchange, p.status, 
                p.started_at,
              p.active_from as user_portfolio_settings_active_from,
              p.user_portfolio_settings as settings,
              p.robots 
           FROM v_user_portfolios p
           WHERE p.id = ${this.#userPortfolioId}; 
       `);

        if (userPortfolio.allocation !== "dedicated")
            throw new Error(`User Portfolios #${this.#userPortfolioId} allocation must be 'dedicated'`);

        if (userPortfolio.exchange !== this.exchange)
            throw new Error(
                `User Portfolios #${this.#userPortfolioId} exchange (${
                    userPortfolio.exchange
                }) is not service exchange (${this.exchange})`
            );

        this.#userPortfolio = userPortfolio;
    }

    async subscribeRobots({ asset, currency }: Exwatcher) {
        const rawData = await this.db.pg.any<UserRobotStateExt>(sql`
        SELECT * FROM v_user_robot_state WHERE status = 'started'
         AND user_portfolio_id = ${this.#userPortfolioId}
         AND asset = ${asset}
         AND currency = ${currency};                   
      `);

        const userRobots = keysToCamelCase(rawData) as UserRobotStateExt[];

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
                this.robots[robotId].robot.setStrategyState();
                this.robots[robotId].robot.initStrategy();
                this.robots[robotId].robot.setIndicatorsState();
                this.robots[robotId].robot.initIndicators();
            } else {
                this.robots[robotId].robot = new Robot(userRobot.robotState);
            }

            this.getActiveRobotAlerts(robotId);
            if (this.robots[robotId].robot.status !== RobotStatus.started) {
                this.robots[robotId].robot.start();
            }
            this.robots[robotId].locked = false;
            this.log.info(`Robot #${robotId} is subscribed!`);
        } catch (err) {
            this.log.error(`Failed to subscribe #${robotId} robot ${err.message}`);
            throw err;
        }
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

    #saveConnectorJob = async (t: DatabaseTransactionConnectionType, nextJob: ConnectorJob) => {
        try {
            return await t.query(sql`
        INSERT INTO connector_jobs (id, user_ex_acc_id, order_id, next_job_at, priority, type, allocation, data )
        VALUES (${nextJob.id}, ${nextJob.userExAccId}, 
        ${nextJob.orderId}, ${nextJob.nextJobAt || null}, 
        ${nextJob.priority || 3}, ${nextJob.type}, 
        'dedicated',
        ${JSON.stringify(nextJob.data) || null});
        `);
        } catch (error) {
            this.log.error("saveConnectorJob error", error, nextJob);
            throw error;
        }
    };

    async runUserRobot(job: UserRobotTask) {
        const beacon = this.lightship.createBeacon();
        const { robotId, type, data } = job;
        const userRobot = this.robots[robotId].userRobot;
        try {
            while (this.robots[robotId].locked) {
                await sleep(200);
            }
            this.lockRobot(robotId);
            const eventsToSend: NewEvent<any>[] = [];
            if (type === UserRobotJobType.signal) {
                userRobot.handleSignal(data as SignalEvent);
            } else if (type === UserRobotJobType.order) {
                const order = data as OrdersStatusEvent;

                userRobot.handleOrder(order);
            } else if (type === UserRobotJobType.stop) {
                if (userRobot.status === UserRobotStatus.stopped) return;
                userRobot.stop(data as { message?: string });
            } else if (type === UserRobotJobType.pause) {
                if (userRobot.status === UserRobotStatus.paused || userRobot.status === UserRobotStatus.stopped) return;
                userRobot.pause(data as { message?: string });
                const pausedEvent: NewEvent<UserRobotWorkerStatus> = {
                    type: UserRobotWorkerEvents.PAUSED,
                    data: {
                        userRobotId: userRobot.id,
                        timestamp: dayjs.utc().toISOString(),
                        status: UserRobotStatus.paused,
                        message: userRobot.message,
                        userPortfolioId: this.#userPortfolioId
                    }
                };
                eventsToSend.push(pausedEvent);
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
                        userPortfolioId: this.#userPortfolioId
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
                    this.log.error(`User Robot #${userRobot.id} has canceled positions!`);
                }

                if (userRobot.hasClosedPositions) {
                    if (userRobot.state.userPortfolioId) {
                        const tradeStatsEvent: NewEvent<TradeStatsRunnerUserRobot> = {
                            type: TradeStatsRunnerEvents.USER_ROBOT,
                            data: {
                                userRobotId: userRobot.id,
                                userPortfolioId: this.#userPortfolioId
                            }
                        };
                        eventsToSend.push(tradeStatsEvent);
                    }
                }

                if (userRobot.recentTrades.length) {
                    for (const trade of userRobot.recentTrades) {
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
                        await saveUserOrders(t, userRobot.ordersToCreate);
                    }

                    if (userRobot.connectorJobs.length) {
                        for (const connectorJob of userRobot.connectorJobs) {
                            await this.#saveConnectorJob(t, connectorJob);
                        }
                    }
                }

                await saveUserRobotState(t, userRobot.state);
            });

            if (userRobot.connectorJobs.length) {
                for (const connectorJob of userRobot.connectorJobs) {
                    this.#connectorJobs.push(connectorJob);
                }
            }

            if (eventsToSend.length) {
                for (const event of eventsToSend) {
                    await this.events.emit(event);
                }
            }

            userRobot.clear();

            if (userRobot.status === UserRobotStatus.stopped) {
                delete this.robots[robotId];
            }
        } catch (err) {
            this.log.error(`Failed to process User Robot's #${userRobot.id} ${type} job - ${err.message}`);
            await this.events.emit<UserRobotWorkerError>({
                type: UserRobotWorkerEvents.ERROR,
                data: {
                    userRobotId: userRobot.id,
                    userPortfolioId: this.#userPortfolioId,
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
        } finally {
            this.unlockRobot(robotId);
            await beacon.die();
        }
    }
}
