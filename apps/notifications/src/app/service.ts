import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { SignalEvents, Signal, SignalSchema } from "@cryptuoso/robot-events";
import { UserSettings } from "@cryptuoso/user-state";
import dayjs from "@cryptuoso/dayjs";
import { v4 as uuid } from "uuid";
import { SignalType, TradeAction } from "@cryptuoso/market";
import { sql } from "@cryptuoso/postgres";
import { GenericObject } from "@cryptuoso/helpers";

interface Notification {
    id: string;
    userId: string;
    timestamp: string;
    type: SignalEvents;
    data: GenericObject<any>;
    sendTelegram: boolean;
    sendEmail: boolean;
    readed?: boolean;
    robotId: string;
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

        let notifications: Notification[];

        if (signal.action === TradeAction.closeLong || signal.action === TradeAction.closeShort) {
            const usersSignalPositions = await this.db.pg.any<{
                userId: string;
                volume: number;
                profit: number;
                entryAction: TradeAction;
                entryPrice: number;
                entryDate: string;
                barsHeld: number;
            }>(sql`
                SELECT user_id, volume, profit, entry_action, entry_price, entry_date, bars_held
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

            notifications = usersSignalPositions.map((usp) => {
                const { telegramId, email, settings } = subscriptions.find(({ userId }) => userId === usp.userId);

                const data: GenericObject<any> = { ...signal, robotCode };
                if (signal.type === SignalType.trade) {
                    data.volume = usp.volume;
                    data.profit = usp.profit;
                    data.entryAction = usp.entryAction;
                    data.entryPrice = usp.entryPrice;
                    data.entryDate = usp.entryDate;
                    data.barsHeld = usp.barsHeld;
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
        } else {
            const data = { ...signal, robotCode };
            notifications = subscriptions
                .filter(
                    ({ subscribedAt }) =>
                        dayjs.utc(signal.candleTimestamp).valueOf() >= dayjs.utc(subscribedAt).valueOf()
                )
                .map((sub) => ({
                    id: uuid(),
                    userId: sub.userId,
                    timestamp: signal.timestamp,
                    type: signal.type === SignalType.alert ? SignalEvents.ALERT : SignalEvents.TRADE,
                    data: data,
                    robotId: signal.robotId,
                    sendTelegram: (sub.telegramId && sub.settings.notifications.signals.telegram) || false,
                    sendEmail: (sub.email && sub.settings.notifications.signals.email) || false
                }));
            this.log.info(`Signal #${signal.id} - ${signal.type} - ${signal.action} event - ${notifications?.length}`);
        }

        await this.saveNotifications(notifications);
    }

    async saveNotifications(notifications: Notification[]) {
        if (!notifications?.length) return;

        try {
            await this.db.pg.query(sql`
        INSERT INTO notifications (
            user_id, timestamp, type, data, robot_id, send_telegram, send_email
                )
        SELECT * FROM 
        ${sql.unnest(
            this.db.util.prepareUnnest(notifications, [
                "userId",
                "timestamp",
                "type",
                "data",
                "robotId",
                "sendTelegram",
                "sendEmail"
            ]),
            ["uuid", "timestamp", "varchar", "jsonb", "uuid", "bool", "bool"]
        )}        
        `);
        } catch (err) {
            this.log.error("Failed to save notifications", err);
            throw err;
        }
    }
}
