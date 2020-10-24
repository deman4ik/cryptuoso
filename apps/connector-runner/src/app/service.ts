import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";

export type ConnectorRunnerServiceConfig = HTTPServiceConfig;

export default class ConnectorRunnerService extends HTTPService {
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
        this.createQueue("connector");
    }
}
