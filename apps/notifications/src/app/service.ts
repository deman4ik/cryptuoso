import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { SignalEvents, Signal, SignalSchema } from "@cryptuoso/robot-events";
import { mailPublisherConfig, MailPublisherEventData, MailPublisherEvents, TemplateMailData, TemplateMailType } from "@cryptuoso/mail-publisher-events";
import { UserSettings } from '@cryptuoso/user-state';
import dayjs from "@cryptuoso/dayjs";
import { v4 as uuid } from 'uuid';
import { TradeAction } from '@cryptuoso/market';

interface Notification {
    id: string;
    userId: string;
    timestamp: string;
    type: TemplateMailType;
    data: TemplateMailData;
    sendTelegram: boolean;
    sendEmail: boolean;
    //readed: boolean;
    robotId?: string;
    positionId?: string;
}

export type NotificationsServiceConfig = BaseServiceConfig;

export default class NotificationsService extends BaseService {
    constructor(config?: NotificationsServiceConfig) {
        super(config);

        this.events.subscribe({
            [SignalEvents.ALERT]: {
                schema: SignalSchema[SignalEvents.ALERT],
                handler: this.handleSignal.bind(this, SignalEvents.ALERT)
            },
            [SignalEvents.TRADE]: {
                schema: SignalSchema[SignalEvents.TRADE],
                handler: this.handleSignal.bind(this, SignalEvents.TRADE)
            }
        });
    }

    async handleSignal(type: SignalEvents, signal: Signal) {
        const { robotId, action } = signal;

        const subscriptions: {
            telegramId?: number;
            email?: string;
            settings: UserSettings;
            userId: string;
            subscribedAt: string;
        }[] = await this.db.pg.any(this.db.sql`
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

        if (type === SignalEvents.ALERT) {
            notifications = subscriptions
                .filter(sub =>
                    dayjs.utc(signal.candleTimestamp).valueOf() >=
                    dayjs.utc(sub.subscribedAt).valueOf()
                )
                .map(sub => ({
                    id: uuid(),
                    userId: sub.userId,
                    timestamp: signal.timestamp,
                    type: TemplateMailType.CHANGE_EMAIL,
                    data: signal as any,
                    robotId: signal.robotId,
                    positionId: signal.positionId,
                    sendTelegram:
                      sub.telegramId && sub.settings.notifications.signals.telegram,
                    sendEmail: sub.email && sub.settings.notifications.signals.email
                }));
        }
        else if (type === SignalEvents.TRADE) {
            if (
                action === TradeAction.closeLong ||
                action === TradeAction.closeShort
            ) {
                const positionEntryDate: string = await this.db.pg.maybeOneFirst(this.db.sql`
                    SELECT entryDate
                    FROM robot_positions
                    WHERE id = ${signal.positionId};
                `) as any;
                
                const res: [{ [key: string]: number }] = this.db.pg.maybeOneFirst(this.db.sql`
                    select json_agg(json_build_object(user_id, profit))
                    from v_user_signal_positions
                    WHERE id = ${signal.positionId}
                        AND robot_id = ${signal.robotId}
                        AND user_id IN (${this.db.sql.array(subscriptions.map((sub)=>sub.userId), "uuid")});
                `) as any;

                if (!res || res[0]) return;

                const [profits] = res;
                
                notifications = subscriptions
                    .filter(
                        sub =>
                            dayjs.utc(positionEntryDate).valueOf() >=
                            dayjs.utc(sub.subscribedAt).valueOf()
                    )
                    .map(sub => ({
                        id: uuid(),
                        userId: sub.userId,
                        timestamp: signal.timestamp,
                        type: TemplateMailType.CHANGE_EMAIL,
                        data: { ...signal, profit: profits[sub.userId] } as any,
                        robotId: signal.robotId,
                        positionId: signal.positionId,
                        sendTelegram:
                          sub.telegramId &&
                          sub.settings.notifications.signals.telegram,
                        sendEmail:
                          sub.email && sub.settings.notifications.signals.email
                    }));
            } else {
                notifications = subscriptions.map(sub => ({
                  id: uuid(),
                  userId: sub.userId,
                  timestamp: signal.timestamp,
                  type: TemplateMailType.CHANGE_EMAIL,
                  data: signal as any,
                  robotId: signal.robotId,
                  positionId: signal.positionId,
                  sendTelegram:
                    sub.telegramId && sub.settings.notifications.signals.telegram,
                  sendEmail: sub.email && sub.settings.notifications.signals.email
                }));
            }
        }

        if (!notifications?.length) return;

        for (const n of notifications) {
            await this.db.pg.query(this.db.sql`
                INSERT INTO notifications (
                    "id", user_id, "timestamp", "type", data, robot_id, position_id, send_telegram, send_email
                ) VALUES (
                    ${n.id},
                    ${n.userId},
                    ${n.timestamp},
                    ${n.type},
                    ${this.db.sql.json(n.data)},
                    ${n.robotId},
                    ${n.positionId},
                    ${n.sendTelegram},
                    ${n.sendEmail}
                );
            `);

            if (true) {
                await this.events.emit<MailPublisherEventData[MailPublisherEvents.SEND_NOTIFICATION]>({
                    type: MailPublisherEvents.SEND_NOTIFICATION,
                    data: { notificationId: n.id }
                });
            }
        }
    }
}
