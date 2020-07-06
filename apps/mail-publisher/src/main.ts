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
    to: "modecry@yandex.ru",
    subject: MAIL_SUBJECTS.NOTIFICATIONS_AGGREGATE,
    tags: ["notifications"],
    notifications: [
        {
            code: "BR_1_Kraken_BTC_USD_5m",
            bodyType: NOTIFICATIONS_TYPES.SIGNAL_ALERT
        },
        {
            code: "BR_1_Kraken_BTC_USD_5m",
            bodyType: NOTIFICATIONS_TYPES.SIGNAL_TRADE
        },
        {
            name: "a194d6e5-0188-4fcf-bbe4-9c9ae15fcb57",
            error:
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt utlabore et dolore magna aliqua.",
            bodyType: NOTIFICATIONS_TYPES.USER_EX_ACC_ERROR
        },
        {
            code: "BR_1_Kraken_BTC_USD_5m",
            status: "started",
            message:
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt utlabore et dolore magna aliqua.",
            bodyType: "robotStatuses"
        },
        {
            code: "BR_1_Kraken_BTC_USD_5m",
            status: "paused",
            message:
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt utlabore et dolore magna aliqua.",
            bodyType: "robotStatuses"
        },
        {
            code: "BR_1_Kraken_BTC_USD_5m",
            status: "stopped",
            message:
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt utlabore et dolore magna aliqua.",
            bodyType: "robotStatuses"
        },
        {
            code: "BR_1_Kraken_BTC_USD_5m",
            status: "resumed",
            message:
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt utlabore et dolore magna aliqua.",
            bodyType: "robotStatuses"
        },
        {
            jobType: "Test_job_type",
            id: "c99b2c1f-9ac5-4b82-ab09-e72f6bce5cae",
            error:
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididuntutlabore et dolore magna aliqua.",
            code: "BR_1_Kraken_BTC_USD_5m",
            bodyType: NOTIFICATIONS_TYPES.USER_ROBOT_FAILED
        },
        {
            exId: "321321",
            id: "c99b2c1f-9ac5-4b82-ab09-e72f6bce5cae",
            error:
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididuntutlabore et dolore magna aliqua.",
            code: "BR_1_Kraken_BTC_USD_5m",
            bodyType: NOTIFICATIONS_TYPES.ORDER_ERROR
        }
    ]
};

const event = MailPublisherEvents.SEND_NOTIFICATIONS_AGGREGATE;

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
