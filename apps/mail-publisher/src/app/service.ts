import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
// libs
import MailUtil, { MailUtilConfig } from "@cryptuoso/mail";
import { MailPublisherSchema, MailPublisherEvents } from "@cryptuoso/mail-publisher-events";
// utils
import { mailBuild, emailBodyBuilder } from "./utils";

export type MailPublisherServiceConfig = BaseServiceConfig;

/**
 *  Сервис оптравки сообщений
 */
class MailPublisherService extends BaseService {
    private mailUtilInstance: MailUtil;
    constructor(readonly mailUtilConfig?: MailUtilConfig, config?: MailPublisherServiceConfig) {
        super(config);
        this.mailUtilInstance = new MailUtil(mailUtilConfig);
        try {
            this.events.subscribe({
                /*Subscribe to just mails*/
                [MailPublisherEvents.SEND_WELCOME]: {
                    handler: async (data) => {
                        await this.sendMail(data, "welcome");
                    },
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_WELCOME]
                },
                [MailPublisherEvents.SEND_CHANGE_EMAIL]: {
                    handler: async (data) => {
                        await this.sendMail(data, "changeEmail");
                    },
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_CHANGE_EMAIL]
                },
                [MailPublisherEvents.SEND_CHANGE_EMAIL_CONFIRM]: {
                    handler: async (data) => {
                        await this.sendMail(data, "changeEmailConfirm");
                    },
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_CHANGE_EMAIL_CONFIRM]
                },
                [MailPublisherEvents.SEND_PASSWORD_RESET]: {
                    handler: async (data) => {
                        await this.sendMail(data, "passwordReset");
                    },
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_PASSWORD_RESET]
                },
                [MailPublisherEvents.SEND_PASSWORD_CHANGE_CONFIRMATION]: {
                    handler: async (data) => {
                        await this.sendMail(data, "passwordChangeConfirm");
                    },
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_PASSWORD_CHANGE_CONFIRMATION]
                },
                [MailPublisherEvents.SEND_PASSWORD_RESET_CONFIRMATION]: {
                    handler: async (data) => {
                        await this.sendMail(data, "passwordResetConfirm");
                    },
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_PASSWORD_RESET_CONFIRMATION]
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
        await this.mailUtilInstance.send({ ...mail, from: fromProp });
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
                await this.mailUtilInstance.send({
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

    // public testEvent = async (data: any, event: any) => {
    //     try {
    //         await this.events.emit(event, data);
    //     } catch (e) {
    //         console.error(e);
    //     }
    // };
}

export default MailPublisherService;
