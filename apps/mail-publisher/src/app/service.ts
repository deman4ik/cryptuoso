import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
// libs
import MailUtil, { MailUtilConfig } from "@cryptuoso/mail";
import { MailPublisherSchema, MailPublisherEvents } from "@cryptuoso/mail-publisher-events";
// utils
import { mailBuild, emailBodyBuilder } from "./mailBuild";

export type MailPublisherServiceConfig = BaseServiceConfig;

/**
 *  Сервис оптравки сообщений
 */
class MailPublisherService extends BaseService {
    private mailUtilInstacnce: MailUtil;
    constructor(readonly mailUtilConfig?: MailUtilConfig, config?: MailPublisherServiceConfig) {
        super(config);
        this.mailUtilInstacnce = new MailUtil(mailUtilConfig);
        try {
            this.events.subscribe({
                /*Subscribe to just mails*/
                [MailPublisherEvents.SEND_WELCOME]: {
                    handler: async (data) => {
                        await this.sendMail(data, "welcome");
                    },
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_WELCOME]
                },
                /*Subscribe to notifications*/
                [MailPublisherEvents.SEND_SUPPORT_REPLY]: {
                    handler: this.sendNotificationsMail,
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_SUPPORT_REPLY]
                },
                [MailPublisherEvents.SEND_SIGNAL_ALERT]: {
                    handler: this.sendNotificationsMail,
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_SIGNAL_ALERT]
                },
                [MailPublisherEvents.SEND_SIGNAL_TRADE]: {
                    handler: this.sendNotificationsMail,
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_SIGNAL_TRADE]
                },
                [MailPublisherEvents.SEND_USER_EX_ACC_ERROR]: {
                    handler: this.sendNotificationsMail,
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_USER_EX_ACC_ERROR]
                },
                [MailPublisherEvents.SEND_USER_ROBOT_STARTED]: {
                    handler: this.sendNotificationsMail,
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_USER_ROBOT_STARTED]
                },
                [MailPublisherEvents.SEND_USER_ROBOT_STOPPED]: {
                    handler: this.sendNotificationsMail,
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_USER_ROBOT_STOPPED]
                },
                [MailPublisherEvents.SEND_USER_ROBOT_PAUSED]: {
                    handler: this.sendNotificationsMail,
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_USER_ROBOT_PAUSED]
                },
                [MailPublisherEvents.SEND_USER_ROBOT_RESUMED]: {
                    handler: this.sendNotificationsMail,
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_USER_ROBOT_RESUMED]
                },
                [MailPublisherEvents.SEND_USER_ROBOT_FAILED]: {
                    handler: this.sendNotificationsMail,
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_USER_ROBOT_FAILED]
                },
                [MailPublisherEvents.SEND_ORDER_ERROR]: {
                    handler: this.sendNotificationsMail,
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_ORDER_ERROR]
                },
                [MailPublisherEvents.SEND_MESSAGE_BROADCAST]: {
                    handler: this.sendNotificationsMail,
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_MESSAGE_BROADCAST]
                },
                [MailPublisherEvents.SEND_NOTIFICATIONS_AGGREGATE]: {
                    handler: this.sendNotificationsMail,
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_NOTIFICATIONS_AGGREGATE]
                }
            });
        } catch (err) {
            this.log.error(err, "While consctructing  MailPublisherService");
        }
    }

    /*send simple mail*/
    private sendMail = async (data: any, type: string) => {
        const { domain } = this.mailUtilConfig;
        const fromProp = data?.from || `Cryptuoso <noreply@${domain}>`;
        const mail = mailBuild(type, data);
        await this.mailUtilInstacnce.send({ ...mail, from: fromProp });
    };
    public testSendingMails = async (data: any, event: any) => {
        await this.events.emit(event, data);
    };

    /*send notifications mail*/
    private sendNotificationsMail = async (data: any, template = "main") => {
        const { domain } = this.mailUtilConfig;
        const { to, tags, subject, notifications } = data;
        const fromProp = data?.from || `Cryptuoso <noreply@${domain}>`;
        let body = "";
        if (notifications) {
            notifications.forEach((notify: any) => {
                body += emailBodyBuilder(notify.bodyType, notify);
            });
            if (body) {
                await this.mailUtilInstacnce.send({
                    to,
                    subject,
                    tags,
                    template,
                    from: fromProp,
                    variables: {
                        body
                    }
                });
            }
        }
    };

    public testSendNotificationsMail = async (data: any, event: any) => {
        try {
            await this.events.emit(event, data);
        } catch (e) {
            console.error(e);
        }
    };
}

export default MailPublisherService;
