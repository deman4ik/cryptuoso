import { BaseService, BaseServiceConfig } from "@cryptuoso/service";

export type ConnectorRunnerServiceConfig = BaseServiceConfig;

export default class ConnectorRunnerService extends BaseService {
    #robotJobRetries = 3;
    constructor(config?: ConnectorRunnerServiceConfig) {
        super(config);
        try {
            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error(err, "While constructing ConnectorRunnerService");
        }
    }

    async onServiceStart() {
        this.createQueue("Connector");
    }
}
