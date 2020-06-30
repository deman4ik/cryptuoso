import { BaseService, BaseServiceConfig } from "@cryptuoso/service";

export type MailPublisherServiceConfig = BaseServiceConfig;

class MailPublisherService extends BaseService {
    constructor(config?: MailPublisherServiceConfig) {
        super(config);
        console.log("Mail publisher is work!");
    }
}

export default MailPublisherService;
