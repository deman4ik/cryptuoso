import { REMOTE_TEMPLATE_TYPES, SendProps, SubscribeProps } from "@cryptuoso/mail";

export const enum MailPublisherEvents {
    SEND_NOTIFICATION = "mail-publisher.send-notification",
    SEND_TEMPLATE_MAIL = "mail-publisher.send-template-mail",
    SEND_MAIL = "mail-publisher.send-mail",
    SUBSCRIBE_TO_LIST = "mail-publisher.subscribe-to-list"
}

// TODO: fill it more
export enum TemplateMailType {
    WELCOME = "welcome",
    USER_ACCOUNT_ACTIVATED = "user_account_activated",
    PASSWORD_CHANGE_CONFIRMATION = "password_change_confirmation",
    PASSWORD_RESET = "password_reset",
    PASSWORD_RESET_CONFIRMATION = "password_reset_confirmation",
    CHANGE_EMAIL = "change_email",
    CHANGE_EMAIL_CONFIRMATION = "change_email_confirmation"
}

export interface TemplateMailData {
    [TemplateMailType.WELCOME]: {
        urlData: string;
        secretCode: string;
    };
    [TemplateMailType.USER_ACCOUNT_ACTIVATED]: undefined;
    [TemplateMailType.PASSWORD_CHANGE_CONFIRMATION]: undefined;
    [TemplateMailType.PASSWORD_RESET]: {
        urlData: string;
        secretCode: string;
    };
    [TemplateMailType.PASSWORD_RESET_CONFIRMATION]: undefined;
    [TemplateMailType.CHANGE_EMAIL]: {
        secretCode: string;
    };
    [TemplateMailType.CHANGE_EMAIL_CONFIRMATION]: {
        emailNew: string;
    };
}

export interface MailPublisherEmittingData<T extends TemplateMailType = null> {
    [MailPublisherEvents.SEND_NOTIFICATION]: {
        notificationId: string;
        template?: REMOTE_TEMPLATE_TYPES;
    };
    [MailPublisherEvents.SEND_TEMPLATE_MAIL]: {
        from?: string;
        to: string;
        type: T;
        data?: TemplateMailData[T];
        template?: REMOTE_TEMPLATE_TYPES;
    };
    [MailPublisherEvents.SEND_MAIL]: SendProps;
    [MailPublisherEvents.SUBSCRIBE_TO_LIST]: SubscribeProps;
}

export function makeMailPublisherEmitObject<E extends MailPublisherEvents, T extends TemplateMailType>(
    type: E,
    data: MailPublisherEmittingData<T>[E] &
        (E extends MailPublisherEvents.SEND_TEMPLATE_MAIL
            ? { type: T } & (TemplateMailData[T] extends undefined ? {} : { data: TemplateMailData[T] })
            : {})
) {
    return {
        type,
        data
    };
}

// TODO: do & check
export const MailPublisherSchemes = {
    [MailPublisherEvents.SEND_NOTIFICATION]: {
        //$$root: true,
        //type: "object"
    },
    [MailPublisherEvents.SEND_TEMPLATE_MAIL]: {
        from: {
            type: "string",
            optional: true
        },
        to: "string",
        type: {
            type: "enum",
            values: Object.values(TemplateMailType)
        },
        data: "object",
        template: {
            type: "enum",
            optional: true,
            values: Object.values(REMOTE_TEMPLATE_TYPES)
        }
    },
    [MailPublisherEvents.SEND_MAIL]: {
        //$$root: true,
        //type: "object"
    },
    [MailPublisherEvents.SUBSCRIBE_TO_LIST]: {
        userId: "uuid",
        type: {
            type: "string",
            optional: true
        },
        needToSendImmediately: {
            type: "boolean",
            optional: true
        },
        data: "object"
    }
};
