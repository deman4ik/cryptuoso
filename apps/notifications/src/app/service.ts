import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { SignalEvents, Signal, SignalSchema } from "@cryptuoso/robot-events";
import {
    mailPublisherConfig,
    MailPublisherEventData,
    MailPublisherEvents,
    TemplateMailData,
    TemplateMailType,
    TemplateMailObject
} from "@cryptuoso/mail-publisher-events";
import { UserSettings } from "@cryptuoso/user-state";
import dayjs from "@cryptuoso/dayjs";
import { v4 as uuid } from "uuid";
import { SignalType, TradeAction } from "@cryptuoso/market";

type Notification = TemplateMailObject & {
    id: string;
    userId: string;
    timestamp: string;
    //type: TemplateMailType;
    //data: TemplateMailData;
    sendTelegram: boolean;
    sendEmail: boolean;
    //readed: boolean;
    robotId?: string;
    positionId?: string;
};

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

    async handleSignal(signal: Signal) {
        const { robotId } = signal;

        const robot: { code: string } = await this.db.pg.maybeOne(this.db.sql`
            SELECT code
            FROM robots
            WHERE robot_id = ${robotId};
        `);

        if (!robot) throw new Error(`Robot not found (${robotId})`);

        const { code: robotCode } = robot;

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

        if (signal.type === SignalType.alert) {
            const data = { ...signal, robotCode };
            notifications = subscriptions
                .filter((sub) => dayjs.utc(signal.candleTimestamp).valueOf() >= dayjs.utc(sub.subscribedAt).valueOf())
                .map((sub) => ({
                    id: uuid(),
                    userId: sub.userId,
                    timestamp: signal.timestamp,
                    type: TemplateMailType.SIGNAL,
                    data,
                    robotId: signal.robotId,
                    positionId: signal.positionId,
                    sendTelegram: sub.telegramId && sub.settings.notifications.signals.telegram,
                    sendEmail: sub.email && sub.settings.notifications.signals.email
                }));
        } else if (signal.type === SignalType.trade) {
            if (signal.action === TradeAction.closeLong || signal.action === TradeAction.closeShort) {
                const position: {
                    entryAction: TradeAction;
                    entryPrice: number;
                    entryDate: string;
                    barsHeld: number;
                } = await this.db.pg.maybeOne(this.db.sql`
                    SELECT entry_action, entry_price, entry_date, bars_held
                    FROM robot_positions
                    WHERE id = ${signal.positionId};
                `);

                if(!position) throw new Error(`Robot position not found (${signal.positionId})`)

                const usersSignalPositions: {
                    userId: string;
                    volume: number;
                    profit: number;
                }[] = this.db.pg.any(this.db.sql`
                    SELECT user_id, volume, profit
                    FROM v_user_signal_positions
                    WHERE id = ${signal.positionId}
                        AND robot_id = ${signal.robotId}
                        AND user_id IN (${this.db.sql.array(
                            subscriptions.map((sub) => sub.userId),
                            "uuid"
                        )});
                `) as any;

                // OR throw
                if (!usersSignalPositions?.length) return;

                const uspMap = new Map<string, { volume: number; profit: number; }>();

                usersSignalPositions.forEach((p) => {
                    uspMap.set(p.userId, { volume: p.volume, profit: p.profit });
                });

                notifications = subscriptions
                    .filter((sub) => dayjs.utc(position.entryDate).valueOf() >= dayjs.utc(sub.subscribedAt).valueOf())
                    .map((sub) => ({
                        id: uuid(),
                        userId: sub.userId,
                        timestamp: signal.timestamp,
                        type: TemplateMailType.SIGNAL,
                        data: { ...signal, robotCode, ...uspMap.get(sub.userId), ...position },
                        robotId: signal.robotId,
                        positionId: signal.positionId,
                        sendTelegram: sub.telegramId && sub.settings.notifications.signals.telegram,
                        sendEmail: sub.email && sub.settings.notifications.signals.email
                    }));
            } else {
                const data = { ...signal, robotCode };
                notifications = subscriptions.map((sub) => ({
                    id: uuid(),
                    userId: sub.userId,
                    timestamp: signal.timestamp,
                    type: TemplateMailType.SIGNAL,
                    data: data,
                    robotId: signal.robotId,
                    positionId: signal.positionId,
                    sendTelegram: sub.telegramId && sub.settings.notifications.signals.telegram,
                    sendEmail: sub.email && sub.settings.notifications.signals.email
                }));
            }
        }

        if (!notifications?.length) return;
        
        // TODO: save by single query
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

            // NOTE: types may be different in future
            if (n.sendEmail && mailPublisherConfig.isNeedToSendImmideately(n.type)) {
                await this.events.emit<MailPublisherEventData[MailPublisherEvents.SEND_NOTIFICATION]>({
                    type: MailPublisherEvents.SEND_NOTIFICATION,
                    data: { notificationId: n.id }
                });
            }
        }
    }
}
