import Mailgun from "mailgun-js";
import logger from "@cryptuoso/logger";

// message send types
export interface SendProps {
    from?: string;
    to: string | Array<string>;
    subject: string;
    text?: string;
    html?: string;
    template: string;
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

class MailUtil {
    private mailgun: Mailgun.Mailgun;
    constructor(readonly config: MailUtilConfig) {
        try {
            this.mailgun = new Mailgun(config);
        } catch (e) {
            logger.error(e, "Failed to init mailgun instance!");
        }
    }

    /* Метод отправки сообщения*/
    send = async ({ from, to, subject, text, html, template, variables, tags }: SendProps) => {
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

export default MailUtil;
