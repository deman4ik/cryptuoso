import { COVER_TEMPLATE_TYPES } from "@cryptuoso/mail";
//import { formatHTML } from "@cryptuoso/helpers";
import { TemplateMailType, TemplateMailData } from "@cryptuoso/mail-publisher-events";
import {
    MAIL_TEMPLATES,
    NOTIFICATIONS_AGGREGATE_SUBJECT
} from "./mail-templates";
import { LANGS } from "./locales";

function getMaiTemplate(type: string) {
    const mail = MAIL_TEMPLATES[type as TemplateMailType];

    if (!mail) throw new Error(`Unknown template mail type (${type})`);

    return mail;
}

export function buildEmailBody(
    type: TemplateMailType,
    data: TemplateMailData[TemplateMailType],
    lang = LANGS.EN
) {
    const mail = getMaiTemplate(type);

    return mail.body(lang, data);
}

export function buildEmail(
    type: TemplateMailType,
    data: TemplateMailData[TemplateMailType],
    lang = LANGS.EN
) {
    const mail = getMaiTemplate(type);

    return {
        subject: mail.subject(lang, data),
        tags: Array.from(mail.tags),
        variables: {
            body: mail.body(lang, data)
        },
        template: COVER_TEMPLATE_TYPES[mail.cover_template] || COVER_TEMPLATE_TYPES.main
    };
}

export function buildNotificationsEmail(
    notifications: { type: TemplateMailType; data: TemplateMailData[TemplateMailType] }[],
    lang = LANGS.EN
) {
    if (!notifications?.length) throw new Error("Empty notifications array");

    if (notifications.length === 1) {
        const { type, data } = notifications[0];
        return buildEmail(type, data, lang);
    }

    let body = "";
    const tags: string[] = [];

    for (const { type, data } of notifications) {
        const mail = getMaiTemplate(type);

        body += mail.body(lang, data);

        if (mail.tags.length) tags.push(...mail.tags);
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
