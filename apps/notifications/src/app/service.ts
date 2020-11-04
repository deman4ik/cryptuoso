import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { SignalEvents, Signal, SignalSchema } from "@cryptuoso/robot-events";
import {
    mailPublisherConfig,
    MailPublisherEventData,
    MailPublisherEvents,
    //TemplateMailData,
    TemplateMailType,
    TemplateMailObject
} from "@cryptuoso/mail-publisher-events";
import { UserSettings } from "@cryptuoso/user-state";
import dayjs from "@cryptuoso/dayjs";
import { v4 as uuid } from "uuid";
import { SignalType, TradeAction } from "@cryptuoso/market";
import { sql } from "@cryptuoso/postgres";

type Notification = TemplateMailObject & {
    id: string;
    userId: string;
    timestamp: string;
    //type: TemplateMailType;
    //data: TemplateMailData;
    sendTelegram: boolean;
    sendEmail: boolean;
    //readed: boolean;
    robotId: string;
    //positionId?: string;
};

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
        this.log.info(`Handling #${signal.id} - ${signal.type} event`);
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

        if (signal.type === SignalType.alert) {
            const data = { ...signal, robotCode };
            notifications = subscriptions
                .filter((sub) => dayjs.utc(signal.candleTimestamp).valueOf() >= dayjs.utc(sub.subscribedAt).valueOf())
                .map((sub) => ({
                    id: uuid(),
                    userId: sub.userId,
                    timestamp: signal.timestamp,
                    type: TemplateMailType.SIGNAL_ALERT,
                    data,
                    robotId: signal.robotId,
                    sendTelegram: sub.telegramId && sub.settings.notifications.signals.telegram,
                    sendEmail: sub.email && sub.settings.notifications.signals.email
                }));
        } else if (signal.type === SignalType.trade) {
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
                            ${sql.array(
                                subscriptions.map((sub) => sub.userId),
                                "uuid"
                            )}
                            );
                `);

                // OR throw
                if (!usersSignalPositions?.length) return;

                const subsMap = new Map<string, typeof subscriptions[number]>();

                subscriptions.forEach((sub) => {
                    subsMap.set(sub.userId, sub);
                });

                notifications = usersSignalPositions.map((usp) => {
                    const sub = subsMap.get(usp.userId);

                    return {
                        id: uuid(),
                        userId: usp.userId,
                        timestamp: signal.timestamp,
                        type: TemplateMailType.SIGNAL_TRADE,
                        data: {
                            ...signal,
                            robotCode,
                            volume: usp.volume,
                            profit: usp.profit,
                            entryAction: usp.entryAction,
                            entryPrice: usp.entryPrice,
                            entryDate: usp.entryDate,
                            barsHeld: usp.barsHeld
                        },
                        robotId: signal.robotId,
                        sendTelegram: sub.telegramId && sub.settings.notifications.signals.telegram,
                        sendEmail: sub.email && sub.settings.notifications.signals.email
                    };
                });
            } else {
                const data = { ...signal, robotCode };
                notifications = subscriptions.map((sub) => ({
                    id: uuid(),
                    userId: sub.userId,
                    timestamp: signal.timestamp,
                    type: TemplateMailType.SIGNAL_TRADE,
                    data: data,
                    robotId: signal.robotId,
                    sendTelegram: sub.telegramId && sub.settings.notifications.signals.telegram,
                    sendEmail: sub.email && sub.settings.notifications.signals.email
                }));
            }
        }

        await this.storeNotifications(notifications);
    }

    async storeNotifications(notifications: Notification[]) {
        if (!notifications?.length) return;

        // TODO: save by single query
        for (const n of notifications) {
            await this.db.pg.query(this.db.sql`
                INSERT INTO notifications (
                    "id", user_id, "timestamp", "type", data, robot_id, send_telegram, send_email
                ) VALUES (
                    ${n.id},
                    ${n.userId},
                    ${n.timestamp},
                    ${n.type},
                    ${this.db.sql.json(n.data)},
                    ${n.robotId},
                    ${n.sendTelegram},
                    ${n.sendEmail}
                );
            `);

            if (n.sendEmail && mailPublisherConfig.isNeedToSendImmediately(n.type)) {
                await this.events.emit<MailPublisherEventData[MailPublisherEvents.SEND_NOTIFICATION]>({
                    type: MailPublisherEvents.SEND_NOTIFICATION,
                    data: { notificationId: n.id }
                });
            }
        }
    }
}
