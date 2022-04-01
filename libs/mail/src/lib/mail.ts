import Mailgun from "mailgun.js";
import formData from "form-data";
import logger from "@cryptuoso/logger";

export interface SendProps {
    from?: string;
    to: string;
    subject: string;
    text?: string;
    html?: string;
    template?: string;
    variables?: { [key: string]: string };
    tags: Array<string>;
}

export interface SubscribeProps {
    list: string;
    email: string;
    name?: string;
}

export class MailUtil {
    private client;
    constructor() {
        try {
            const mailgun = new Mailgun(formData);
            this.client = mailgun.client({
                username: "api",
                key: process.env.MAILGUN_API_KEY,
                url: "https://api.eu.mailgun.net"
            });
        } catch (e) {
            logger.error(e, "Failed to init mailgun instance!");
        }
    }

    /* Метод отправки сообщения*/
    send = async ({
        from = "Cryptuoso <noreply@cryptuoso.com>",
        to,
        subject,
        text,
        html,
        template = "simple",
        variables,
        tags
    }: SendProps) => {
        try {
            const mailGunVariables = variables && Object.keys(variables) && JSON.stringify(variables);

            const response = await this.client.messages.create(process.env.MAILGUN_DOMAIN, {
                from,
                to,
                subject,
                text,
                html,
                template,
                "h:X-Mailgun-Variables": mailGunVariables,
                "o:tag": tags
            });
            logger.info(response);
        } catch (e) {
            logger.error(e);
            throw e;
        }
    };
}

const mailUtil: MailUtil = new MailUtil();
export default mailUtil;
