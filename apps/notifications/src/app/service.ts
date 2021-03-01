import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { SignalEvents, Signal, SignalSchema } from "@cryptuoso/robot-events";
import {
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

export type NotificationsServiceConfig = BaseServiceConfig;
//TODO: enum for notification types
export default class NotificationsService extends BaseService {
    #mailUtil: typeof mailUtil;
    constructor(config?: NotificationsServiceConfig) {
        super(config);
        this.#mailUtil = mailUtil;
        try {
            this.events.subscribe({
                [SignalEvents.ALERT]: {
                    schema: SignalSchema[SignalEvents.ALERT],
                    handler: this.handleSignal.bind(this)
                },
                [SignalEvents.TRADE]: {
                    schema: SignalSchema[SignalEvents.TRADE],
                    handler: this.handleSignal.bind(this)
                },
                [UserRobotWorkerEvents.STARTED]: {
                    schema: UserRobotWorkerSchema[UserRobotWorkerEvents.STARTED],
                    handler: this.handleUserRobotStatus.bind(this)
                },
                [UserRobotWorkerEvents.STOPPED]: {
                    schema: UserRobotWorkerSchema[UserRobotWorkerEvents.STOPPED],
                    handler: this.handleUserRobotStatus.bind(this)
                },
                [UserRobotWorkerEvents.PAUSED]: {
                    schema: UserRobotWorkerSchema[UserRobotWorkerEvents.PAUSED],
                    handler: this.handleUserRobotStatus.bind(this)
                },
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
            userRobotId: string;
            robotId: string;
            robotCode: string;
            userRobotStatus: UserRobotStatus;
            userId: string;
            telegramId?: number;
            email?: number;
            userSettings: UserSettings;
        }>(sql`
    SELECT ur.id as user_robot_id,
     r.id as robot_id,
     r.code as robot_code,
     ur.status as user_robot_status,
     u.id as user_id,
     u.telegram_id,
     u.email,
     u.settings as user_settings
     FROM user_robots ur, robots r, users u
    WHERE ur.robot_id = r.id
    AND ur.user_id = u.id
    AND ur.id = ${userRobotId};
    `);

    async handleSignal(event: Signal) {
        try {
            this.log.info(`Handling #${event.id} - ${event.type} - ${event.action} event`);
            const { robotId } = event;

            const { code: robotCode } = await this.db.pg.one<{ code: string }>(this.db.sql`
            SELECT code
            FROM robots
            WHERE id = ${robotId};
        `);

            const subscriptions = await this.db.pg.any<{
                telegramId?: number;
                email?: string;
                settings: UserSettings;
                userId: string;
                subscribedAt: string;
            }>(this.db.sql`
            SELECT u.telegram_id,
                u.email,
                u.settings,
                s.user_id,
                s.subscribed_at
            FROM user_signals s, users u
            WHERE s.user_id = u.id
            AND s.robot_id = ${robotId}
        `);

            if (!subscriptions?.length) return;

            const usersSignalPositions = await this.db.pg.any<{
                userId: string;
                volume: number;
                profit: number;
                entryAction: TradeAction;
                entryPrice: number;
                entryDate: string;
                exitAction: TradeAction;
                exitPrice: number;
                exitDate: string;
                barsHeld: number;
            }>(sql`
                SELECT user_id, volume, profit, entry_action, entry_price, entry_date, 
                exit_action, exit_price, exit_date,
                bars_held
                FROM v_user_signal_positions
                WHERE id = ${event.positionId}
                    AND robot_id = ${event.robotId}
                    AND user_id IN (
                        ${sql.join(
                            subscriptions.map((sub) => sub.userId),
                            sql`, `
                        )}
                        );
            `);
            this.log.info(
                `Signal #${event.id} - ${event.type} - ${event.action} event - ${usersSignalPositions?.length}`
            );
            if (!usersSignalPositions?.length) return;

            const notifications = usersSignalPositions.map((usp) => {
                const { telegramId, email, settings } = subscriptions.find(({ userId }) => userId === usp.userId);

                const data: GenericObject<any> = { ...event, robotCode, volume: usp.volume };

                if (event.type === SignalType.trade) {
                    data.entryAction = usp.entryAction;
                    data.entryPrice = usp.entryPrice;
                    data.entryDate = usp.entryDate;

                    if (event.action === TradeAction.closeLong || event.action === TradeAction.closeShort) {
                        data.exitAction = usp.exitAction;
                        data.exitPrice = usp.exitPrice;
                        data.exitDate = usp.exitDate;
                        data.profit = usp.profit;
                        data.barsHeld = usp.barsHeld;
                    }
                }

                return {
                    userId: usp.userId,
                    timestamp: event.timestamp,
                    type: event.type === SignalType.alert ? SignalEvents.ALERT : SignalEvents.TRADE,
                    data,
                    robotId: event.robotId,
                    sendTelegram: (telegramId && settings.notifications.signals.telegram) || false,
                    sendEmail: (email && settings.notifications.signals.email) || false
                };
            });

            await this.#saveNotifications(notifications);
        } catch (err) {
            this.log.error("Failed to handleSignal", err, event);
            throw err;
        }
    }

    async handleUserRobotStatus(event: UserRobotWorkerStatus) {
        try {
            this.log.info(`Handling user robot status event`, event);
            const { userRobotId, status, message, timestamp } = event;

            const {
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
                timestamp,
                type: `user-robot.${status}`,
                data: {
                    userRobotId,
                    status,
                    message,
                    robotCode
                },
                userRobotId,
                sendEmail: trading.email && email ? true : false,
                sendTelegram: trading.telegram && telegramId ? true : false
            };

            await this.#saveNotifications([notification]);
        } catch (err) {
            this.log.error("Failed to handleUserRobotStatus", err, event);
            throw err;
        }
    }

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
                type: "user-robot.trade",
                data: { ...event, robotCode },
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
                let message = "";

                if (status === "expired" || status === "canceled") {
                    message =
                        "<p>All robots are <b>stopping</b> now! If there are any <b>open positions</b> they will be <b>canceled</b> (closed) with current market prices and potentially may cause profit <b>losses</b>!</p>";
                } else if (status === "expiring") {
                    let date;
                    if (activeTo || trialEnded) {
                        date = `Expires in ${dayjs.utc(activeTo || trialEnded).diff(dayjs.utc(), "day")} days`;
                    }

                    message = `<p>${
                        date || ""
                    }</p><p>Please renew you subscription.</p><p>After subscription expires all robots will be <b>stopped</b>! If there are any <b>open positions</b> they will be <b>canceled</b> (closed) with current market prices and potentially may cause profit <b>losses</b>!</p>`;
                }
                await this.#mailUtil.send({
                    to: email,
                    subject: `Cryptuoso Subscription Status Update - ${status}`,
                    variables: {
                        body: `<p>Greetings!</p>
                    <p>Your subscription <a href="https://cryptuoso.com/profile">${subscriptionName}</a> is <b>${status}</b></p>
                    ${message}
                    <p>If you have any questions please <a href="https://cryptuoso.com/support">contact support</a></p>`
                    },
                    tags: ["subscription"]
                });
            }
        } catch (err) {
            this.log.error("Failed to handleUserSubStatus", err, event);
            throw err;
        }
    }
}
