export const enum MailPublisherEvents {
    SEND_WELCOME = "mail-publisher.sendWelcome"
}

export const MailPublisherSchema = {
    [MailPublisherEvents.SEND_WELCOME]: {
        email: "string",
        secretCode: "string",
        urlData: "string"
    }
};

export interface SendWelcome {
    email: string;
    secretCode: string;
    urlData: string;
}
