import MailPublisherService from "./app/service";
import log from "@cryptuoso/logger";
import { MAIL_SUBJECTS } from "./app/constants";
//for test
import { MailPublisherEvents, NOTIFICATIONS_TYPES } from "@cryptuoso/mail-publisher-events";

/*work with service*/
const { MAIL_API_KEY: apiKey, MAIL_DOMAIN: domain, MAIL_HOST: host } = process.env;
const service = new MailPublisherService({ apiKey, domain, host });

// for test mails
const data = {
    email: "modecry@yandex.ru"
};

const event = MailPublisherEvents.SEND_PASSWORD_RESET_CONFIRMATION;

async function start() {
    try {
        await service.startService();
        service.testEvent(data, event); // TEST EVENTS
    } catch (error) {
        log.error(error, `Failed to start service ${process.env.SERVICE}`);
        process.exit(1);
    }
}
start();
