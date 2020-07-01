import MailPublisherService from "./app/service";
import log from "@cryptuoso/logger";

const { MAIL_API_KEY: apiKey, MAIL_DOMAIN: domain, MAIL_HOST: host } = process.env;

const service = new MailPublisherService({ apiKey, domain, host });

async function start() {
    try {
        await service.startService();
    } catch (error) {
        log.error(error, `Failed to start service ${process.env.SERVICE}`);
        process.exit(1);
    }
}
start();
