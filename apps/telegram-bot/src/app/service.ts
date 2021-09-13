import { BaseService, BaseServiceConfig } from "@cryptuoso/service";

export type TelegramBotServiceConfig = BaseServiceConfig;
export default class TelegramBotService extends BaseService {
    constructor(config?: TelegramBotServiceConfig) {
        super(config);
    }
}
