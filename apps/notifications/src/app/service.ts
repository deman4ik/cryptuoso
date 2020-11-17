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
import { UserSettings } from "@cryptuoso/user-state";
import { v4 as uuid } from "uuid";
import { SignalType, TradeAction } from "@cryptuoso/market";
import { sql } from "@cryptuoso/postgres";
import { GenericObject } from "@cryptuoso/helpers";
import {
    ConnectorWorkerEvents,
    ConnectorWorkerSchema,
    OrdersErrorEvent,
    UserExchangeAccountErrorEvent
} from "@cryptuoso/connector-events";
import { UserRobotStatus, UserTradeEvent } from "@cryptuoso/user-robot-state";
import dayjs from "@cryptuoso/dayjs";

interface Notification {
    id: string;
    userId: string;
    timestamp: string;
    type: string;
    data: GenericObject<any>;
    sendTelegram: boolean;
    sendEmail: boolean;
    readed?: boolean;
    robotId?: string;
    userRobotId?: string;
}

export type NotificationsServiceConfig = BaseServiceConfig;

export default class NotificationsService extends BaseService {
    constructor(config?: NotificationsServiceConfig) {
        super(config);

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
                }
            });
        } catch (err) {
            this.log.error(err, "While constructing NotificationsService");
        }
    }

    async handleSignal(signal: Signal) {
        this.log.info(`Handling #${signal.id} - ${signal.type} - ${signal.action} event`);
        const { robotId } = signal;

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
                WHERE id = ${signal.positionId}
                    AND robot_id = ${signal.robotId}
                    AND user_id IN (
                        ${sql.join(
                            subscriptions.map((sub) => sub.userId),
                            sql`, `
                        )}
                        );
            `);
        this.log.info(
            `Signal #${signal.id} - ${signal.type} - ${signal.action} event - ${usersSignalPositions?.length}`
        );
        if (!usersSignalPositions?.length) return;

        const notifications = usersSignalPositions.map((usp) => {
            const { telegramId, email, settings } = subscriptions.find(({ userId }) => userId === usp.userId);

            const data: GenericObject<any> = { ...signal, robotCode, volume: usp.volume };

            if (signal.type === SignalType.trade) {
                data.entryAction = usp.entryAction;
                data.entryPrice = usp.entryPrice;
                data.entryDate = usp.entryDate;

                if (signal.action === TradeAction.closeLong || signal.action === TradeAction.closeShort) {
                    data.exitAction = usp.exitAction;
                    data.exitPrice = usp.exitPrice;
                    data.exitDate = usp.exitDate;
                    data.profit = usp.profit;
                    data.barsHeld = usp.barsHeld;
                }
            }

            return {
                id: uuid(),
                userId: usp.userId,
                timestamp: signal.timestamp,
                type: signal.type === SignalType.alert ? SignalEvents.ALERT : SignalEvents.TRADE,
                data,
                robotId: signal.robotId,
                sendTelegram: (telegramId && settings.notifications.signals.telegram) || false,
                sendEmail: (email && settings.notifications.signals.email) || false
            };
        });

        await this.saveNotifications(notifications);
    }

    async saveNotifications(notifications: Notification[]) {
        if (!notifications?.length) return;

        try {
            await this.db.pg.query(sql`
        INSERT INTO notifications (
            user_id, timestamp, type, data, robot_id, user_robot_id, send_telegram, send_email
                )
        SELECT * FROM 
        ${sql.unnest(
            this.db.util.prepareUnnest(notifications, [
                "userId",
                "timestamp",
                "type",
                "data",
                "robotId",
                "userRobotId",
                "sendTelegram",
                "sendEmail"
            ]),
            ["uuid", "timestamp", "varchar", "jsonb", "uuid", "uuid", "bool", "bool"]
        )}        
        `);
        } catch (err) {
            this.log.error("Failed to save notifications", err);
            throw err;
        }
    }

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

    async handleUserRobotStatus(event: UserRobotWorkerStatus) {
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

        const notification: Notification = {
            id: uuid(),
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

        await this.saveNotifications([notification]);
    }

    async handleUserRobotError(event: UserRobotWorkerError) {
        const { userRobotId, error, timestamp } = event;

        const {
            robotCode,
            telegramId,
            email,
            userId,
            userSettings: {
                notifications: { trading }
            }
        } = await this.#getUserRobotInfo(userRobotId);

        const notification: Notification = {
            id: uuid(),
            userId,
            timestamp,
            type: "user-robot.error",
            data: {
                userRobotId,
                error,
                robotCode
            },
            userRobotId,
            sendEmail: trading.email && email ? true : false,
            sendTelegram: trading.telegram && telegramId ? true : false
        };

        await this.saveNotifications([notification]);
    }

    async handleUserTrade(event: UserTradeEvent) {
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

        const notification: Notification = {
            id: uuid(),
            userId,
            timestamp: entryDate || exitDate || dayjs.utc().toISOString(),
            type: "user-robot.trade",
            data: { ...event, robotCode },
            userRobotId,
            sendEmail: trading.email && email ? true : false,
            sendTelegram: trading.telegram && telegramId ? true : false
        };

        await this.saveNotifications([notification]);
    }

    async handleOrderError(event: OrdersErrorEvent) {
        const { userRobotId, timestamp } = event;

        const { robotCode, telegramId, email, userId } = await this.#getUserRobotInfo(userRobotId);

        const notification: Notification = {
            id: uuid(),
            userId,
            timestamp,
            type: "order.error",
            data: { ...event, robotCode },
            userRobotId,
            sendEmail: !!email,
            sendTelegram: !!telegramId
        };

        await this.saveNotifications([notification]);
    }

    async handleUserExAccError(event: UserExchangeAccountErrorEvent) {
        const { userExAccId, timestamp } = event;

        const { userId, telegramId, email } = await this.db.pg.one<{
            userId: string;
            telegramId?: number;
            email?: number;
        }>(sql`
        SELECT 
            u.id as user_id,
            u.telegram_id,
            u.email
        FROM users u, user_exchange_accs uea
        WHERE uea.user_id = u.id
        AND uea.id = ${userExAccId};`);

        const notification: Notification = {
            id: uuid(),
            userId,
            timestamp,
            type: "user_ex_acc.error",
            data: event,
            sendEmail: !!email,
            sendTelegram: !!telegramId
        };

        await this.saveNotifications([notification]);
    }
}
