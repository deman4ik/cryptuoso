import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
// libs
import MailUtil, { MailUtilConfig } from "@cryptuoso/mail";

import { SendWelcome, MailPublisherSchema, MailPublisherEvents } from "@cryptuoso/mail-publisher-events";
// utils
import mailBuild from "./mailBuild";

export type MailPublisherServiceConfig = BaseServiceConfig;

/**
 *  Сервис оптравки сообщений
 */
class MailPublisherService extends BaseService {
    private mailUtilInstacnce: MailUtil;
    constructor(readonly mailUtilConfig?: MailUtilConfig, config?: MailPublisherServiceConfig) {
        super(config);
        this.mailUtilInstacnce = new MailUtil(mailUtilConfig);
        this.mailUtilConfig = mailUtilConfig;
        try {
            this.events.subscribe({
                [MailPublisherEvents.SEND_WELCOME]: {
                    handler: async (data) => {
                        await this.send(data, "welcome");
                    },
                    schema: MailPublisherSchema[MailPublisherEvents.SEND_WELCOME]
                }
            });
        } catch (err) {
            this.log.error(err, "While consctructing  MailPublisherService");
        }

        // test sendWelcome
        this.testWelcome({
            email: "modecry@yandex.ru",
            secretCode: "Test secret code",
            urlData: "TesturlData"
        });
    }

    /*send method*/
    private send = async (data: any, type: string) => {
        const { domain } = this.mailUtilConfig;
        const fromProp = data?.from || `Cryptuoso <noreply@${domain}>`;
        const mail = mailBuild(type, data);
        await this.mailUtilInstacnce.send({ ...mail, from: fromProp });
    };

    public testWelcome = async (data: SendWelcome) => {
        await this.events.emit<SendWelcome>(MailPublisherEvents.SEND_WELCOME, data);
        console.log("Send welcome is ok!");
    };
}

export default MailPublisherService;
