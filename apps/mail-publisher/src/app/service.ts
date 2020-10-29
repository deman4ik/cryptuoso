import { HTTPService, HTTPServiceConfig, RequestExtended } from "@cryptuoso/service";
import { MailUtil } from "@cryptuoso/mail";
import {
    mailPublisherConfig,
    MailPublisherSchemes,
    MailPublisherEvents,
    MailPublisherEventData,
    TemplateMailType,
    TemplateMailData
} from "@cryptuoso/mail-publisher-events";
import { buildEmail, buildNotificationsEmail } from "./utils";
import { Job } from "bullmq";
import { UserRoles, UserSettings } from "@cryptuoso/user-state";
//import { v4 as uuid } from "uuid";

/* interface Notification {
    id: string;
    type: TemplateMailType;
    userId: string;
    data: TemplateMailData;
    sendTelegram: boolean;
    sendEmail: boolean;
    readed: boolean;
} */

const enum JobTypes {
    checkNotifications = "checkNotifications"
}

export type MailPublisherServiceConfig = HTTPServiceConfig;

class MailPublisherService extends HTTPService {
    mailUtilInstance: MailUtil;

    constructor(config?: MailPublisherServiceConfig) {
        super(config);

        try {
            this.mailUtilInstance = new MailUtil(this.redis);

            this.events.subscribe({
                [MailPublisherEvents.SEND_NOTIFICATION]: {
                    handler: this._sendNotificationHandler.bind(this),
                    schema: MailPublisherSchemes[MailPublisherEvents.SEND_NOTIFICATION]
                },
                [MailPublisherEvents.SEND_TEMPLATE_MAIL]: {
                    handler: this._sendTemplateMailHandler.bind(this),
                    schema: MailPublisherSchemes[MailPublisherEvents.SEND_TEMPLATE_MAIL]
                },
                [MailPublisherEvents.SEND_MAIL]: {
                    handler: this._sendMailHandler.bind(this),
                    schema: MailPublisherSchemes[MailPublisherEvents.SEND_MAIL]
                },
                [MailPublisherEvents.SUBSCRIBE_TO_LIST]: {
                    handler: this._subscribeToListHandler.bind(this),
                    schema: MailPublisherSchemes[MailPublisherEvents.SUBSCRIBE_TO_LIST]
                }
            });

            this.createRoutes({
                send_template_mail: {
                    auth: true,
                    roles: [UserRoles.admin, UserRoles.manager],
                    inputSchema: MailPublisherSchemes[MailPublisherEvents.SEND_TEMPLATE_MAIL],
                    handler: this._httpHandler.bind(this, this._sendTemplateMailHandler.bind(this))
                },
                send_mail: {
                    auth: true,
                    roles: [UserRoles.admin, UserRoles.manager],
                    inputSchema: MailPublisherSchemes[MailPublisherEvents.SEND_MAIL],
                    handler: this._httpHandler.bind(this, this._sendMailHandler.bind(this))
                }
            });

            this.addOnStartHandler(this._onServiceStart);
        } catch (err) {
            this.log.error(err, "While consctructing MailPublisherService");
        }
    }

    async _onServiceStart() {
        const queueKey = this.name;

        this.createQueue(queueKey);
        this.createWorker(queueKey, this.processJob);

        await this.addJob(queueKey, JobTypes.checkNotifications, null, {
            jobId: JobTypes.checkNotifications,
            repeat: {
                // TODO: check
                cron: "30 6 * * * *"
            },
            removeOnComplete: true,
            removeOnFail: 100
        });
    }

    async processJob(job: Job) {
        try {
            if (this.lightship.isServerShuttingDown()) throw new Error("Server is shutting down");

            if (job.name === JobTypes.checkNotifications) await this.checkNotifications();
            else throw new Error(`Unknown job name ${job.name}`);
        } catch (err) {
            this.log.error(`Failed to process job "${job.name}"`, job, err);
            throw err;
        }
    }

    async checkNotifications() {
        const timeThreshold = mailPublisherConfig.getNotificationsThresholdTimeString();
        const users: { id: string; email: string }[] = await this.db.pg.any(this.db.sql`
            SELECT u.id, u.email
            FROM users u, notifications n
            WHERE n.send_email = true
                AND u.id = n.user_id
                AND u.email IS NOT NULL
                AND n.created_at > ${timeThreshold}
            GROUP BY u.id, u.email;
        `);

        for (const { id, email } of users) {
            const userSettings: UserSettings = (await this.db.pg.maybeOneFirst(this.db.sql`
                SELECT settings
                FROM users
                WHERE id = ${id};
            `)) as any;

            let impossibleTypes: TemplateMailType[];

            if (userSettings?.notifications) impossibleTypes = mailPublisherConfig.getImpossibleTypes(userSettings);

            const notifications: {
                id: string;
                type: TemplateMailType;
                data: TemplateMailData[TemplateMailType];
            }[] = await this.db.pg.any(this.db.sql`
                UPDATE notifications
                SET send_mail = false
                WHERE user_id = ${id}
                    AND send_email = true
                    AND created_at > ${timeThreshold}
                    ${
                        impossibleTypes?.length
                            ? this.db.sql`AND "type" NOT IN (${this.db.sql.array(impossibleTypes, "text")})`
                            : this.db.sql``
                    }
                RETURNING id, "type", data;
            `);

            if (!notifications.length) continue;

            const mailgunId = await this.sendNotificationsMail(notifications, email);
            await this.db.pg.query(this.db.sql`
                UPDATE notifications
                SET mailgun_id = ${mailgunId}
                WHERE id IN (${this.db.sql.array(
                    notifications.map((n) => n.id),
                    "uuid"
                )};
            `);
        }
    }

    async _httpHandler(
        handler: (data: MailPublisherEventData[MailPublisherEvents]) => Promise<any>,
        req: RequestExtended,
        res: any
    ) {
        try {
            await handler(req.body?.input);
            res.send({ result: "OK" });
            res.end();
        } catch (err) {
            this.log.error(
                `Failed to handle HTTP request on route ${req.url} with params ${JSON.stringify(req.body?.input)}`
            );
            throw err;
        }
    }

    async _sendNotificationHandler(data: MailPublisherEventData[MailPublisherEvents.SEND_NOTIFICATION]) {
        try {
            const timeThreshold = mailPublisherConfig.getNotificationsThresholdTimeString();
            const { notificationId } = data;
            const notification: {
                userId: string;
                type: TemplateMailType;
                data: TemplateMailData[TemplateMailType];
            } = await this.db.pg.maybeOne(this.db.sql`
                UPDATE notifications
                SET send_email = false
                WHERE id = ${notificationId}
                    AND send_email = true
                    AND created_at > ${timeThreshold}
                RETURNING user_id, "type", data;
            `);

            if (!notification) throw new Error(`Notification with id "${notificationId}" doesn't exists or not valid`);

            const { userId, type, data: notificationData } = notification;

            const user: {
                email: string;
                settings: UserSettings;
            } = await this.db.pg.maybeOne(this.db.sql`
                SELECT email
                FROM users
                WHERE id = ${userId};
            `);

            if (!user) throw new Error(`Bad userId in notification (id: ${notificationId}, userId: ${userId})`);

            if (!user?.email) {
                this.log.error(
                    `Can't send notification (id: ${notificationId}). Reason: User (id: ${userId}) has no email`
                );
                return;
            }

            if (!mailPublisherConfig.checkNotificationType(user.settings, type)) {
                this.log.error(
                    `Can't send notification (id: ${notificationId}). Reason: User (id: ${userId}) unsubscribed`
                );
                return;
            }

            const mailgunId = await this.sendTemplateMail(type, notificationData, user.email);
            await this.db.pg.query(this.db.sql`
                UPDATE notifications
                SET mailgun_id = ${mailgunId}
                WHERE id = ${notificationId};
            `);
        } catch (err) {
            this.log.error(
                `Failed to handle '${MailPublisherEvents.SEND_NOTIFICATION}' event (${JSON.stringify(data)})`,
                err.message
            );
            throw err;
        }
    }

    async _sendTemplateMailHandler(data: MailPublisherEventData[MailPublisherEvents.SEND_TEMPLATE_MAIL]) {
        try {
            // TODO: validate
            await this.sendTemplateMail(data.type, data.data, data.to, data.from);
        } catch (err) {
            this.log.error(
                `Failed to handle '${MailPublisherEvents.SEND_TEMPLATE_MAIL}' event (${JSON.stringify(data)})`,
                err
            );
            throw err;
        }
    }

    async _sendMailHandler(data: MailPublisherEventData[MailPublisherEvents.SEND_MAIL]) {
        try {
            await this.mailUtilInstance.send(data);
        } catch (err) {
            this.log.error(`Failed to handle '${MailPublisherEvents.SEND_MAIL}' event (${JSON.stringify(data)})`, err);
            throw err;
        }
    }

    async _subscribeToListHandler(data: MailPublisherEventData[MailPublisherEvents.SUBSCRIBE_TO_LIST]) {
        try {
            await this.mailUtilInstance.subscribeToList(data);
        } catch (err) {
            this.log.error(
                `Failed to handle '${MailPublisherEvents.SUBSCRIBE_TO_LIST}' event (${JSON.stringify(data)})`,
                err
            );
            throw err;
        }
    }

    private async sendNotificationsMail(
        notifications: { type: TemplateMailType; data: TemplateMailData[TemplateMailType] }[],
        to: string,
        from?: string
    ) {
        if (!to) throw new Error("Recipient address must not be empty");
        if (!notifications?.length) throw new Error("Notifications array must not be empty");

        return await this.mailUtilInstance.send({
            ...buildNotificationsEmail(notifications),
            to,
            from
        });
    }

    private async sendTemplateMail(
        type: TemplateMailType,
        data: TemplateMailData[TemplateMailType],
        to: string,
        from?: string
    ) {
        if (!to) throw new Error("Recipient address must not be empty");

        return await this.mailUtilInstance.send({
            ...buildEmail(type, data),
            to,
            from
        });
    }
}

export default MailPublisherService;
