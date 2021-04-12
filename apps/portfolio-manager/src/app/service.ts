import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";

export type PortfolioManagerServiceConfig = HTTPServiceConfig;

export default class PortfolioManagerService extends HTTPService {
    constructor(config?: PortfolioManagerServiceConfig) {
        super(config);
        try {
            //
        } catch (err) {
            this.log.error("Error while constructing PortfolioManagerService", err);
        }
    }
}
