import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { MailUtil, REMOTE_TEMPLATE_TYPES } from "@cryptuoso/mail";
import {
    MailPublisherSchemes,
    MailPublisherEvents,
    MailPublisherEmittingData,
    TemplateMailType,
    TemplateMailData
} from "@cryptuoso/mail-publisher-events";
import { buildEmail, buildNotificationsEmail } from "./utils";
import { Job } from "bullmq";
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

export type MailPublisherServiceConfig = BaseServiceConfig;

class MailPublisherService extends BaseService {
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
        const users: { id: string; email: string }[] = await this.db.pg.any(this.db.sql`
            SELECT u.id, u.email
            FROM users u, notifications n
            WHERE n.send_email = true
                AND u.id = n.user_id
                AND u.email IS NOT NULL
            GROUP BY u.id, u.email;
        `);

        for (const { id, email } of users) {
            const notifications: {
                id: string;
                type: TemplateMailType;
                data: TemplateMailData[TemplateMailType];
            }[] = await this.db.pg.any(this.db.sql`
                UPDATE notifications
                SET send_mail = false
                WHERE user_id = ${id}
                    AND send_email = true
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

    async _sendNotificationHandler(data: MailPublisherEmittingData[MailPublisherEvents.SEND_NOTIFICATION]) {
        try {
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
                RETURNING user_id, "type", data;
            `);

            if (!notification) throw new Error(`Notification with id "${notificationId}" doesn't exists`);

            const { userId, type, data: notificationData } = notification;

            const email = (await this.db.pg.maybeOneFirst(this.db.sql`
                SELECT email
                FROM users
                WHERE id = ${userId};
            `)) as string;

            if (!email) {
                this.log.error(
                    `Can't send notification (id: ${notificationId}). Reason: User (id: ${userId}) has no email`
                );
                return;
            }

            const mailgunId = await this.sendTemplateMail(type, notificationData, email);
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

    async _sendTemplateMailHandler(data: MailPublisherEmittingData<any>[MailPublisherEvents.SEND_TEMPLATE_MAIL]) {
        try {
            // TODO: validate
            await this.sendTemplateMail(data.type, data.data, data.to, data.from, data.template);
        } catch (err) {
            this.log.error(
                `Failed to handle '${MailPublisherEvents.SEND_TEMPLATE_MAIL}' event (${JSON.stringify(data)})`,
                err
            );
            throw err;
        }
    }

    async _sendMailHandler(data: MailPublisherEmittingData[MailPublisherEvents.SEND_MAIL]) {
        try {
            await this.mailUtilInstance.send(data);
        } catch (err) {
            this.log.error(`Failed to handle '${MailPublisherEvents.SEND_MAIL}' event (${JSON.stringify(data)})`, err);
            throw err;
        }
    }

    async _subscribeToListHandler(data: MailPublisherEmittingData[MailPublisherEvents.SUBSCRIBE_TO_LIST]) {
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
        from?: string,
        template?: REMOTE_TEMPLATE_TYPES
    ) {
        if (!to) throw new Error("Recipient address must not be empty");

        return await this.mailUtilInstance.send({
            ...buildEmail(type, data, template),
            to,
            from
        });
    }
}

export default MailPublisherService;
