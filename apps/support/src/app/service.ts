import dayjs from "@cryptuoso/dayjs";
import { chunkArray, GenericObject } from "@cryptuoso/helpers";
import { sql } from "@cryptuoso/postgres";
import { HTTPService, HTTPServiceConfig, RequestExtended } from "@cryptuoso/service";
import { User, UserRoles, Notification, UserSettings } from "@cryptuoso/user-state";
import mailUtil from "@cryptuoso/mail";

interface SupportMessage {
    id?: string;
    from: string;
    to: string;
    data: {
        message: string;
    };
    timestamp: string;
}
export type SupportServiceConfig = HTTPServiceConfig;

export default class SupportService extends HTTPService {
    constructor(config?: SupportServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                supportMessage: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        message: "string"
                    },
                    handler: this._httpHandler.bind(this, this.supportMessage.bind(this))
                },
                replySupportMessage: {
                    auth: true,
                    roles: [UserRoles.manager, UserRoles.admin],
                    inputSchema: {
                        to: "uuid",
                        message: "string"
                    },
                    handler: this._httpHandler.bind(this, this.replySupportMessage.bind(this))
                },
                broadcastNews: {
                    auth: true,
                    roles: [UserRoles.manager, UserRoles.admin],
                    inputSchema: {
                        message: "string"
                    },
                    handler: this._httpHandler.bind(this, this.broadcastNews.bind(this))
                }
            });
        } catch (err) {
            this.log.error("Failed to initialize SupportService", err);
        }
    }

    async _httpHandler(
        handler: (user: User, params: GenericObject<any>) => Promise<GenericObject<any>>,
        req: RequestExtended,
        res: any
    ) {
        const result = await handler(req.meta.user, req.body.input);

        res.send({ result: result || "OK" });
        res.end();
    }

    #saveSupportMessage = async (supportMessage: SupportMessage) =>
        this.db.pg.query(sql`
    INSERT into messages ( timestamp, "from", "to", data ) VALUES (
        
        ${supportMessage.timestamp}, ${supportMessage.from}, ${supportMessage.to}, ${JSON.stringify(
            supportMessage.data
        )}
    )
    `);

    #saveNotifications = async (notifications: Notification[]) => {
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

    async supportMessage(user: User, { message }: { message: string }) {
        const newMessage: SupportMessage = {
            from: user.id,
            to: null,
            data: { message },
            timestamp: dayjs.utc().toISOString()
        };

        await this.#saveSupportMessage(newMessage);

        await mailUtil.send({
            to: "support@cryptuoso.com",
            subject: `New Support Request from user ${user.id}`,
            variables: {
                body: `<p>New Support Request from user <b>${user.id}</b></p>
                    <p>${message}</p>
                    <p>${newMessage.timestamp}</p>
                    `
            },
            tags: ["support"]
        });
    }

    async replySupportMessage(user: User, { to, message }: { to: string; message: string }) {
        const { telegramId, email } = await this.db.pg.one<{ telegramId: string; email: string }>(
            sql`SELECT telegram_id, email from users where id = ${to}`
        );

        const newMessage: SupportMessage = {
            from: user.id,
            to,
            data: { message },
            timestamp: dayjs.utc().toISOString()
        };
        await this.#saveSupportMessage(newMessage);

        const notification: Notification = {
            userId: to,
            timestamp: newMessage.timestamp,
            type: "message.support-reply",
            data: newMessage,
            sendTelegram: !!telegramId,
            sendEmail: !!email
        };

        await this.#saveNotifications([notification]);
    }

    async broadcastNews(user: User, { message }: { message: string }) {
        const users = await this.db.pg.many<{
            userId: string;
            telegramId: string;
            email: string;
            settings: UserSettings;
        }>(
            sql`SELECT id as user_id, telegram_id, email, settings 
            FROM users 
            WHERE status > 0;`
        );
        const timestamp = dayjs.utc().toISOString();
        const notifications: Notification[] = users.map(
            ({
                userId,
                telegramId,
                email,
                settings: {
                    notifications: { news }
                }
            }) => ({
                userId,
                timestamp,
                type: "message.broadcast",
                data: { message },
                sendTelegram: news.telegram && telegramId ? true : false,
                sendEmail: news.email && email ? true : false
            })
        );

        await this.#saveNotifications(notifications);
    }
}
