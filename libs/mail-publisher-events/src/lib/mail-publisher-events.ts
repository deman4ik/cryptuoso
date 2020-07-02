import { extend } from "dayjs";

export const enum MailPublisherEvents {
    SEND_WELCOME = "mail-publisher.sendWelcome",
    SEND_SUPPORT_REPLY = "mail-publisher.support-reply"
}

const BASE_NOTIFY_DATA = {
    to: "string",
    subject: "string",
    tags: {
        type: "array",
        items: "string"
    }
};
// notifications data
const supportReplyData = {
    type: "object",
    props: {
        bodyType: { type: "string" },
        message: { type: "string" }
    }
};

export const MailPublisherSchema = {
    [MailPublisherEvents.SEND_WELCOME]: {
        email: "string",
        secretCode: "string",
        urlData: "string"
    },
    [MailPublisherEvents.SEND_SUPPORT_REPLY]: {
        ...BASE_NOTIFY_DATA,
        notifications: {
            type: "array",
            items: [supportReplyData]
        }
    }
};

/*mails*/
export interface SendWelcome {
    email: string;
    secretCode: string;
    urlData: string;
}

/*notifications*/
interface BaseNotifyInterface {
    to: string;
    subject: string;
    tags: Array<string>;
}
// notifications types
type supportReplyDataType = {
    message: string;
    bodyType: string;
};

export interface SendSupportReply extends BaseNotifyInterface {
    notifications: [supportReplyDataType];
}
