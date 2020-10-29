import { COVER_TEMPLATE_TYPES } from "@cryptuoso/mail";
//import { formatHTML } from "@cryptuoso/helpers";
import { TemplateMailType, TemplateMailData } from "@cryptuoso/mail-publisher-events";
import {
    stringOrFunction,
    getStringOrFunctionValue,
    getArrayOrFunctionValue,
    MAIL_TEMPLATES,
    NOTIFICATIONS_AGGREGATE_SUBJECT
} from "./mail-templates";
import { LOCALES_NAMES } from "./locales";

// May be used for all bodies if need
export const formatHTML = (htmlStr: string): string => {
    return htmlStr.replace(/(?:\r\n|\r|\n)/g, "<br />");
};

function getFormattedBody(body: stringOrFunction, data: any, locale: LOCALES_NAMES) {
    return formatHTML(getStringOrFunctionValue(body, data, locale));
}

function getMaiTemplate(type: string) {
    const mail = MAIL_TEMPLATES[type as TemplateMailType];

    if (!mail) throw new Error(`Unknown template mail type (${type})`);

    return mail;
}

export function buildEmailBody(
    type: TemplateMailType,
    data: TemplateMailData[TemplateMailType],
    locale = LOCALES_NAMES.EN
) {
    const mail = getMaiTemplate(type);

    return getFormattedBody(mail.body, data, locale);
}

export function buildEmail(
    type: TemplateMailType,
    data: TemplateMailData[TemplateMailType],
    locale = LOCALES_NAMES.EN
) {
    const mail = getMaiTemplate(type);

    return {
        subject: getStringOrFunctionValue(mail.subject, data, locale),
        tags: getArrayOrFunctionValue(mail.tags, data),
        variables: {
            body: getFormattedBody(mail.body, data, locale)
        },
        template: COVER_TEMPLATE_TYPES[mail.cover_template] || COVER_TEMPLATE_TYPES.main
    };
}

export function buildNotificationsEmail(
    notifications: { type: TemplateMailType; data: TemplateMailData[TemplateMailType] }[],
    locale = LOCALES_NAMES.EN
) {
    if (!notifications?.length) throw new Error("Empty notifications array");

    if (notifications.length === 1) {
        const { type, data } = notifications[0];
        return buildEmail(type, data, locale);
    }

    let body = "";
    const tags: string[] = [];

    for (const { type, data } of notifications) {
        const mail = getMaiTemplate(type);

        body += getFormattedBody(mail.body, data, locale);

        if (mail.tags.length) tags.push(...getArrayOrFunctionValue(mail.tags, data));
    }

    return {
        subject: NOTIFICATIONS_AGGREGATE_SUBJECT,
        tags,
        variables: {
            body
        },
        template: COVER_TEMPLATE_TYPES.main
    };
}
