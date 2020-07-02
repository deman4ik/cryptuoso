import MailPublisherService from "./app/service";
import log from "@cryptuoso/logger";

const { MAIL_API_KEY: apiKey, MAIL_DOMAIN: domain, MAIL_HOST: host } = process.env;

const service = new MailPublisherService({ apiKey, domain, host });

async function start() {
    try {
        await service.startService();
        service.testSendNotificationsMail({
            to: "modecry@yandex.ru",
            subject: "Support message reply",
            tags: ["replySupport"],
            notifications: [
                {
                    message:
                        "🚀🚀🚀 We are proud to announce the release of <b>Cryptuoso Trading Web App!</b>\\n\\nCheck it out <a href='https://cryptuoso.com'>https://cryptuoso.com</a> !\\n\\nNow you can access all Cryptuoso robots, trades and statistics from any device!\\n\\nYou can login to Web App with your Telegram account  - all your robots will be there!\\n\\n🆕 Also Cryptuoso Robots now available with <a href='https://www.binance.com/en/futures/ref/cryptuoso'>Binance Futures</a>!\\n\\n⚠️ Cryptuoso Platform is still in <b>BETA</b>, so please let us know about your thoughts and concerns.\\n\\nWhile in BETA all Cryptuoso Platform’s features is <b>FREE</b> for a limited time!\\n\\nStart trading crypto with us now!",
                    bodyType: "default"
                }
            ]
        });
    } catch (error) {
        log.error(error, `Failed to start service ${process.env.SERVICE}`);
        process.exit(1);
    }
}
start();
