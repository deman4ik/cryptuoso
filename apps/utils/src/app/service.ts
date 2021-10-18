import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";

export type UtilsServiceConfig = HTTPServiceConfig;

export default class UtilsService extends HTTPService {
    constructor(config?: UtilsServiceConfig) {
        super(config);

        try {
            //    this.addOnStartedHandler(this.onStarted);
        } catch (err) {
            this.log.error("Error while constructing UtilsService", err);
        }
    }
}
