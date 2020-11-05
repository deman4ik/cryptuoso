import Mailgun from "mailgun-js";
import logger from "@cryptuoso/logger";

// message send types
export interface SendProps {
    from?: string;
    to: string | Array<string>;
    subject: string;
    text?: string;
    html?: string;
    template?: string;
    variables?: { [key: string]: string };
    tags: Array<string>;
}

// subscribe type
export interface SubscribeProps {
    list: string;
    email: string;
    name?: string;
}

/**
 * Класс работы с отправкой email
 */
export interface MailUtilConfig {
    apiKey: string;
    domain: string;
    host?: string;
}

/*template types*/
export const TEMPLATE_TYPES: any = {
    main: "main"
};

export class MailUtil {
    private mailgun: Mailgun.Mailgun;
    constructor() {
        try {
            let config;
            if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
                config = {
                    apiKey: process.env.MAILGUN_API_KEY,
                    domain: process.env.MAILGUN_DOMAIN,
                    host: "api.eu.mailgun.net"
                };
            } else {
                config = { apiKey: "none", domain: "none" };
                logger.warn("Mail Service runs in TEST mode.");
            }
            this.mailgun = new Mailgun(config);
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
            await this.mailgun.messages().send({
                from,
                to,
                subject,
                text,
                html,
                template,
                "h:X-Mailgun-Variables": mailGunVariables,
                "o:tag": tags
            });
        } catch (e) {
            logger.error(e);
            throw e;
        }
    };

    /*Подписка на рассылку*/
    subscribeToList = async ({ list, email: address, name }: SubscribeProps) => {
        try {
            await this.mailgun.lists(list).members().create({
                subscribed: true,
                address,
                name
            });
            return true;
        } catch (e) {
            if (e.message.includes("Address already exists")) return;
            logger.error(e);
            throw e;
        }
    };
}

const mailUtil: MailUtil = new MailUtil();
export default mailUtil;
