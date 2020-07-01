import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
// libs
import MailUtil, { MailUtilConfig } from "@cryptuoso/mail";
// utils
import mailBuilder from "./mailBuilder";
import { from } from "scramjet";

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
    }

    /*send method*/
    send = (type: string, data: any) => {
        const { domain } = this.mailUtilConfig;
        const fromProp = data.from || `Cryptuoso <noreply@${domain}>`;
        const mail = mailBuilder(type, data);
        this.mailUtilInstacnce.send({ ...mail, from: fromProp });
    };
}

export default MailPublisherService;
