import MailPublisherService from "./app/service";
import log from "@cryptuoso/logger";
//for test
import { MailPublisherEvents, NOTIFICATIONS_TYPES } from "@cryptuoso/mail-publisher-events";

const { MAIL_API_KEY: apiKey, MAIL_DOMAIN: domain, MAIL_HOST: host } = process.env;

const service = new MailPublisherService({ apiKey, domain, host });

// for test mails
const data = {
    to: "modecry@yandex.ru",
    subject: "NEWS!!!",
    tags: ["news"],
    notifications: [
        {
            message: "66666",
            bodyType: "default"
        },
        {
            code: "66666",
            bodyType: NOTIFICATIONS_TYPES.SIGNAL_TRADE
        },
        {
            code: "66666",
            bodyType: NOTIFICATIONS_TYPES.SIGNAL_TRADE
        },
        {
            code: "66666",
            bodyType: NOTIFICATIONS_TYPES.SIGNAL_TRADE
        }
    ]
};

const event = MailPublisherEvents.SEND_NOTIFICATIONS_AGGREGATE;

async function start() {
    try {
        await service.startService();
        service.testSendNotificationsMail(data, event); // TEST EVENTS
    } catch (error) {
        log.error(error, `Failed to start service ${process.env.SERVICE}`);
        process.exit(1);
    }
}
start();
