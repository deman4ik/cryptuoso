import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
// libs
import MailUtil, { MailUtilConfig } from "@cryptuoso/mail";

import {
    SendWelcome,
    SendSupportReply,
    MailPublisherSchema,
    MailPublisherEvents
} from "@cryptuoso/mail-publisher-events";
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
        this.mailUtilConfig = mailUtilConfig;
        try {
            this.events.subscribe({
                [MailPublisherEvents.SEND_WELCOME]: {
                    handler: async (data) => {
                        await this.sendMail(data, "welcome");
                    },
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_WELCOME]
                },
                [MailPublisherEvents.SEND_SUPPORT_REPLY]: {
                    handler: this.sendNotificationsMail,
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_SUPPORT_REPLY]
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
    public testWelcome = async (data: SendWelcome) => {
        await this.events.emit<SendWelcome>(MailPublisherEvents.SEND_WELCOME, data);
    };

    /*send notifications mail*/
    private sendNotificationsMail = async (data: any, template = "main") => {
        const { domain } = this.mailUtilConfig;
        const { to, subject, tags, notifications } = data;
        const fromProp = data?.from || `Cryptuoso <noreply@${domain}>`;
        let body: string = "";

        if (notifications) {
            notifications.forEach((notify: any) => {
                body += emailBodyBuilder(notify.bodyType, notify);
            });
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
    };

    public testSendNotificationsMail = async (data: SendSupportReply) => {
        await this.events.emit<SendSupportReply>(MailPublisherEvents.SEND_SUPPORT_REPLY, data);
        console.log("Send welcome is ok!");
    };
}

export default MailPublisherService;
