import { BaseService, BaseServiceConfig } from "@cryptuoso/service";

export type NotificationsServiceConfig = BaseServiceConfig;

export default class NotificationsService extends BaseService {
    constructor(config?: NotificationsServiceConfig) {
        super(config);
    }
}
