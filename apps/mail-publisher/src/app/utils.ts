import { REMOTE_TEMPLATE_TYPES } from "@cryptuoso/mail";
//import { formatHTML } from "@cryptuoso/helpers";
import { TemplateMailType, TemplateMailData } from "@cryptuoso/mail-publisher-events";
import { getStringOrFunctionValue, MAIL_TEMPLATES, NOTIFICATIONS_AGGREGATE_SUBJECT } from "./mail-templates";

// May be used for all bodies if need
export const formatHTML = (htmlStr: string): string => {
    return htmlStr.replace(/(?:\r\n|\r|\n)/g, "<br />");
};

function getMaiTemplate(type: string) {
    const mail = MAIL_TEMPLATES[type as TemplateMailType];

    if (!mail) throw new Error(`Unknown template mail type (${type})`);

    return mail;
}

export function buildEmailBody(type: TemplateMailType, data: TemplateMailData) {
    const mail = getMaiTemplate(type);

    return getStringOrFunctionValue(mail.body, data);
}

export function buildEmail(type: TemplateMailType, data: TemplateMailData, templateType?: REMOTE_TEMPLATE_TYPES) {
    const mail = getMaiTemplate(type);

    return {
        subject: getStringOrFunctionValue(mail.subject, data),
        tags: Array.from(mail.tags),
        variables: {
            body: getStringOrFunctionValue(mail.body, data)
        },
        template: REMOTE_TEMPLATE_TYPES[templateType] || REMOTE_TEMPLATE_TYPES.main
    };
}

export function buildNotificationsEmail(
    notifications: { type: TemplateMailType; data: TemplateMailData }[],
    templateType?: REMOTE_TEMPLATE_TYPES
) {
    if (!notifications?.length) throw new Error("Empty notifications array");

    if (notifications.length === 1) {
        const { type, data } = notifications[0];
        return buildEmail(type, data, templateType);
    }

    let body = "";
    const tags: string[] = [];

    for (const { type, data } of notifications) {
        const mail = getMaiTemplate(type);

        body += getStringOrFunctionValue(mail.body, data);

        if (mail.tags.length) tags.push(...mail.tags);
    }

    return {
        subject: NOTIFICATIONS_AGGREGATE_SUBJECT,
        tags,
        variables: {
            body
        },
        template: REMOTE_TEMPLATE_TYPES[templateType] || REMOTE_TEMPLATE_TYPES.main
    };
}
