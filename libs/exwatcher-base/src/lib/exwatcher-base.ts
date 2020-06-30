import { BaseService, BaseServiceConfig } from "@cryptuoso/service";

export interface ExwatcherBaseServiceConfig extends BaseServiceConfig {
    exchange: string;
}

export class ExwatcherBaseService extends BaseService {
    constructor(config?: ExwatcherBaseServiceConfig) {
        super(config);
    }
}
