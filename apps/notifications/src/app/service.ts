import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { SignalEvents, Signal, SignalSchema } from "@cryptuoso/robot-events";
import {
    UserPortfolioStatus,
    UserRobotWorkerError,
    UserRobotWorkerEvents,
    UserRobotWorkerSchema,
    UserRobotWorkerStatus,
    UserTradeEvents,
    UserTradeSchema
} from "@cryptuoso/user-robot-events";
import { UserSettings, Notification } from "@cryptuoso/user-state";
import { SignalType, TradeAction } from "@cryptuoso/market";
import { sql } from "@cryptuoso/postgres";
import { chunkArray, GenericObject } from "@cryptuoso/helpers";
import {
    ConnectorWorkerEvents,
    ConnectorWorkerSchema,
    OrdersErrorEvent,
    UserExchangeAccountErrorEvent
} from "@cryptuoso/connector-events";
import { UserRobotStatus, UserTradeEvent } from "@cryptuoso/user-robot-state";
import {
    UserSubErrorEvent,
    UserSubOutEvents,
    UserSubOutSchema,
    UserSubPaymentStatusEvent,
    UserSubStatusEvent
} from "@cryptuoso/user-sub-events";
import dayjs from "@cryptuoso/dayjs";
import mailUtil from "@cryptuoso/mail";
import { UserPortfolioDB } from "@cryptuoso/portfolio-state";
import {
    PortfolioManagerOutEvents,
    PortfolioManagerOutSchema,
    PortfolioManagerUserPortfolioBuilded,
    PortfolioManagerUserPortfolioBuildError
} from "@cryptuoso/portfolio-events";

export type NotificationsServiceConfig = BaseServiceConfig;
//TODO: enum for notification types
export default class NotificationsService extends BaseService {
    #mailUtil: typeof mailUtil;
    constructor(config?: NotificationsServiceConfig) {
        super(config);
        this.#mailUtil = mailUtil;
        try {
            this.events.subscribe({
                [UserRobotWorkerEvents.ERROR]: {
                    schema: UserRobotWorkerSchema[UserRobotWorkerEvents.ERROR],
                    handler: this.handleUserRobotError.bind(this)
                },
                [UserTradeEvents.TRADE]: {
                    schema: UserTradeSchema[UserTradeEvents.TRADE],
                    handler: this.handleUserTrade.bind(this)
                },
                [ConnectorWorkerEvents.ORDER_ERROR]: {
                    schema: ConnectorWorkerSchema[ConnectorWorkerEvents.ORDER_ERROR],
                    handler: this.handleOrderError.bind(this)
                },
                [ConnectorWorkerEvents.USER_EX_ACC_ERROR]: {
                    schema: ConnectorWorkerSchema[ConnectorWorkerEvents.USER_EX_ACC_ERROR],
                    handler: this.handleUserExAccError.bind(this)
                },
                [UserSubOutEvents.ERROR]: {
                    schema: UserSubOutSchema[UserSubOutEvents.ERROR],
                    handler: this.handleUserSubError.bind(this)
                },
                [UserSubOutEvents.PAYMENT_STATUS]: {
                    schema: UserSubOutSchema[UserSubOutEvents.PAYMENT_STATUS],
                    handler: this.handlePaymentStatus.bind(this)
                },
                [UserSubOutEvents.USER_SUB_STATUS]: {
                    schema: UserSubOutSchema[UserSubOutEvents.USER_SUB_STATUS],
                    handler: this.handleUserSubStatus.bind(this)
                },
                [PortfolioManagerOutEvents.USER_PORTFOLIO_BUILDED]: {
                    schema: PortfolioManagerOutSchema[PortfolioManagerOutEvents.USER_PORTFOLIO_BUILDED],
                    handler: this.handleUserPortfolioBuilded.bind(this)
                },
                [PortfolioManagerOutEvents.USER_PORTFOLIO_BUILD_ERROR]: {
                    schema: PortfolioManagerOutSchema[PortfolioManagerOutEvents.USER_PORTFOLIO_BUILD_ERROR],
                    handler: this.handleUserPortfolioBuildError.bind(this)
                },
                [UserRobotWorkerEvents.STARTED_PORTFOLIO]: {
                    schema: UserRobotWorkerSchema[UserRobotWorkerEvents.STARTED_PORTFOLIO],
                    handler: this.handleUserPortfolioStatus.bind(this)
                },
                [UserRobotWorkerEvents.STOPPED_PORTFOLIO]: {
                    schema: UserRobotWorkerSchema[UserRobotWorkerEvents.STOPPED_PORTFOLIO],
                    handler: this.handleUserPortfolioStatus.bind(this)
                },
                [UserRobotWorkerEvents.ERROR_PORTFOLIO]: {
                    schema: UserRobotWorkerSchema[UserRobotWorkerEvents.ERROR_PORTFOLIO],
                    handler: this.handleUserPortfolioStatus.bind(this)
                }
            });
        } catch (err) {
            this.log.error("Error while constructing NotificationsService", err);
        }
    }

    #saveNotifications = async (notifications: Notification<any>[]) => {
        if (!notifications?.length) return;

        try {
            for (const chunk of chunkArray(notifications, 1000)) {
                await this.db.pg.query(sql`
        INSERT INTO notifications (
            user_id, timestamp, type, data, send_telegram, send_email
                )
        SELECT * FROM 
        ${sql.unnest(
            this.db.util.prepareUnnest(chunk, ["userId", "timestamp", "type", "data", "sendTelegram", "sendEmail"]),
            ["uuid", "timestamp", "varchar", "jsonb", "bool", "bool"]
        )}        
        `);
            }
        } catch (err) {
            this.log.error("Failed to save notifications", err);
            throw err;
        }
    };

    #getUserRobotInfo = async (userRobotId: string) =>
        this.db.pg.one<{
            userPortfolioId: string;
            userPortfolioType: UserPortfolioDB["type"];
            userRobotId: string;
            robotId: string;
            robotCode: string;
            userRobotStatus: UserRobotStatus;
            userId: string;
            telegramId?: number;
            email?: number;
            userSettings: UserSettings;
        }>(sql`
    SELECT 
    up.id as user_portfolio_id,
    up.type as user_portfolio_type,
    ur.id as user_robot_id,
     r.id as robot_id,
     r.code as robot_code,
     ur.status as user_robot_status,
     u.id as user_id,
     u.telegram_id,
     u.email,
     u.settings as user_settings
     FROM user_robots ur, robots r, users u, user_portfolios up
    WHERE ur.robot_id = r.id
    AND ur.user_id = u.id
    AND up.id = ur.user_portfolio_id
    AND ur.id = ${userRobotId};
    `);

    async handleUserRobotError(event: UserRobotWorkerError) {
        try {
            this.log.info(`Handling user robot error event`, event);
            const { userRobotId, error, timestamp } = event;

            const { robotCode, telegramId, email, userId } = await this.#getUserRobotInfo(userRobotId);

            const notification: Notification<any> = {
                userId,
                timestamp,
                type: "user-robot.error",
                data: {
                    userRobotId,
                    error,
                    robotCode
                },
                userRobotId,
                sendEmail: !!email,
                sendTelegram: !!telegramId
            };

            await this.#saveNotifications([notification]);
        } catch (err) {
            this.log.error("Failed to handleUserRobotError", err, event);
            throw err;
        }
    }

    async handleUserTrade(event: UserTradeEvent) {
        try {
            this.log.info(`Handling user robot trade event #${event.id}`);
            const { userRobotId, entryDate, exitDate } = event;
            const {
                userPortfolioId,
                userPortfolioType,
                robotCode,
                telegramId,
                email,
                userId,
                userSettings: {
                    notifications: { trading }
                }
            } = await this.#getUserRobotInfo(userRobotId);

            const notification: Notification<any> = {
                userId,
                timestamp: exitDate || entryDate || dayjs.utc().toISOString(),
                type: "user.trade",
                data: { ...event, robotCode, userPortfolioId, userPortfolioType },
                userRobotId,
                sendEmail: trading.email && email ? true : false,
                sendTelegram: trading.telegram && telegramId ? true : false
            };

            await this.#saveNotifications([notification]);
        } catch (err) {
            this.log.error("Failed to handleUserTrade", err, event);
            throw err;
        }
    }

    async handleOrderError(event: OrdersErrorEvent) {
        try {
            this.log.info(`Handling order error event`, event);
            if (
                !event.error.toLowerCase().includes("margin") &&
                !event.error.toLowerCase().includes("insufficient") &&
                !event.error.toLowerCase().includes("gateway") &&
                !event.error.toLowerCase().includes("getaddrinfo") &&
                !event.error.toLowerCase().includes("network") &&
                !event.error.toLowerCase().includes("request") &&
                !event.error.toLowerCase().includes("econnreset")
            ) {
                const { userRobotId, timestamp } = event;

                const { robotCode, telegramId, email, userId } = await this.#getUserRobotInfo(userRobotId);

                const notification: Notification<any> = {
                    userId,
                    timestamp,
                    type: "order.error",
                    data: { ...event, robotCode },
                    userRobotId,
                    sendEmail: !!email,
                    sendTelegram: !!telegramId
                };

                await this.#saveNotifications([notification]);
            }
        } catch (err) {
            this.log.error("Failed to handleOrderError", err, event);
            throw err;
        }
    }

    async handleUserExAccError(event: UserExchangeAccountErrorEvent) {
        try {
            this.log.info(`Handling user ex acc error event`, event);
            const { userExAccId, timestamp } = event;

            const { userId, name, telegramId, email } = await this.db.pg.one<{
                userId: string;
                name: string;
                telegramId?: number;
                email?: string;
            }>(sql`
        SELECT 
            u.id as user_id,
            uea.name,
            u.telegram_id,
            u.email
        FROM users u, user_exchange_accs uea
        WHERE uea.user_id = u.id
        AND uea.id = ${userExAccId};`);

            const notification: Notification<any> = {
                userId,
                timestamp,
                type: "user_ex_acc.error",
                data: { ...event, name },
                sendEmail: !!email,
                sendTelegram: !!telegramId
            };

            await this.#saveNotifications([notification]);
        } catch (err) {
            this.log.error("Failed to handleUserExAccError", err, event);
            throw err;
        }
    }

    async handleUserSubError(event: UserSubErrorEvent) {
        try {
            this.log.info(`Handling user sub error event`, event);
            const { userId, timestamp } = event;

            const { telegramId, email } = await this.db.pg.one<{
                telegramId?: number;
                email?: string;
            }>(sql`
                    SELECT 
                        u.telegram_id,
                        u.email
                    FROM users u
                    WHERE u.id = ${userId};`);

            const notification: Notification<any> = {
                userId,
                timestamp,
                type: "user_sub.error",
                data: { ...event },
                sendEmail: !!email,
                sendTelegram: !!telegramId
            };

            await this.#saveNotifications([notification]);
        } catch (err) {
            this.log.error("Failed to handleUserSubError", err, event);
            throw err;
        }
    }

    async handlePaymentStatus(event: UserSubPaymentStatusEvent) {
        try {
            this.log.info(`Handling user payment status event`, event);
            const { userId, timestamp } = event;

            const { telegramId, email } = await this.db.pg.one<{
                telegramId?: number;
                email?: string;
            }>(sql`
                    SELECT 
                        u.telegram_id,
                        u.email
                    FROM users u
                    WHERE u.id = ${userId};`);

            const notification: Notification<any> = {
                userId,
                timestamp,
                type: "user_payment.status",
                data: { ...event },
                sendEmail: !!email,
                sendTelegram: !!telegramId
            };

            await this.#saveNotifications([notification]);
        } catch (err) {
            this.log.error("Failed to handlePaymentStatus", err, event);
            throw err;
        }
    }

    async handleUserSubStatus(event: UserSubStatusEvent) {
        try {
            this.log.info(`Handling user sub status event`, event);
            const { userId, timestamp, subscriptionName, activeTo, trialEnded, status } = event;

            const { telegramId, email } = await this.db.pg.one<{
                telegramId?: number;
                email?: string;
            }>(sql`
                    SELECT 
                        u.telegram_id,
                        u.email
                    FROM users u
                    WHERE u.id = ${userId};`);

            const notification: Notification<any> = {
                userId,
                timestamp,
                type: "user_sub.status",
                data: { ...event },
                sendEmail: false,
                sendTelegram: !!telegramId
            };

            await this.#saveNotifications([notification]);

            if (email) {
                try {
                    let message = "";
                    let date = "";
                    if (status === "expired" || status === "canceled") {
                        message =
                            "<p>All robots are <b>stopping</b> now! If there are any <b>open positions</b> they will be <b>canceled</b> (closed) with current market prices and potentially may cause profit <b>losses</b>!</p>";
                    } else if (status === "expiring") {
                        if (activeTo || trialEnded) {
                            date = ` ${dayjs.utc().to(activeTo || trialEnded)}`;
                        }

                        message = `<p>Please renew you subscription.</p><p>After subscription expires all robots will be <b>stopped</b>! If there are any <b>open positions</b> they will be <b>canceled</b> (closed) with current market prices and potentially may cause profit <b>losses</b>!</p>`;
                    }
                    await this.#mailUtil.send({
                        to: email,
                        subject: `Cryptuoso Subscription Status Update - ${status}`,
                        variables: {
                            body: `<p>Greetings!</p>
                    <p>Your subscription <a href="https://cryptuoso.com/profile">${subscriptionName}</a> is <b>${status}</b>${date}</p>
                    ${message}
                    <p>If you have any questions please <a href="https://cryptuoso.com/support">contact support</a></p>`
                        },
                        tags: ["subscription"]
                    });
                } catch (error) {
                    this.log.error("Failed to send email for user sub status even", error);
                }
            }
        } catch (err) {
            this.log.error("Failed to handleUserSubStatus", err, event);
            throw err;
        }
    }

    async handleUserPortfolioBuilded(event: PortfolioManagerUserPortfolioBuilded) {
        this.log.info(`Handling user portfolio builded event`, event);

        const { userPortfolioId } = event;

        const { userId, telegramId } = await this.db.pg.one<{
            userId: string;
            telegramId?: number;
        }>(sql`
        SELECT u.id as user_id, u.telegram_id
        FROM user_portfolios up, users u 
        WHERE up.id = ${userPortfolioId}
        AND u.id = up.user_id;
        `);

        const notification: Notification<any> = {
            userId,
            timestamp: dayjs.utc().toISOString(),
            type: "user_portfolio.builded",
            data: { ...event },
            sendEmail: false,
            sendTelegram: !!telegramId
        };

        await this.#saveNotifications([notification]);
    }

    async handleUserPortfolioBuildError(event: PortfolioManagerUserPortfolioBuildError) {
        this.log.info(`Handling user portfolio build error event`, event);

        const { userPortfolioId } = event;

        const { userId, telegramId } = await this.db.pg.one<{
            userId: string;
            telegramId?: number;
        }>(sql`
        SELECT u.id as user_id, u.telegram_id
        FROM user_portfolios up, users u 
        WHERE up.id = ${userPortfolioId}
        AND u.id = up.user_id;
        `);

        const notification: Notification<any> = {
            userId,
            timestamp: dayjs.utc().toISOString(),
            type: "user_portfolio.build_error",
            data: { ...event },
            sendEmail: false,
            sendTelegram: !!telegramId
        };

        await this.#saveNotifications([notification]);
    }

    async handleUserPortfolioStatus(event: UserPortfolioStatus) {
        this.log.info(`Handling user portfolio status event`, event);

        const { userPortfolioId, timestamp } = event;

        const { userId, telegramId } = await this.db.pg.one<{
            userId: string;
            telegramId?: number;
        }>(sql`
        SELECT u.id as user_id, u.telegram_id
        FROM user_portfolios up, users u 
        WHERE up.id = ${userPortfolioId}
        AND u.id = up.user_id;
        `);

        const notification: Notification<any> = {
            userId,
            timestamp,
            type: "user_portfolio.status",
            data: { ...event },
            sendEmail: false,
            sendTelegram: !!telegramId
        };

        await this.#saveNotifications([notification]);
    }
}
