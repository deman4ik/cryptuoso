import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";

export type UserPortfolioManagerServiceConfig = HTTPServiceConfig;

export default class UserPortfolioManagerService extends HTTPService {
    constructor(config?: UserPortfolioManagerServiceConfig) {
        super(config);
        try {
            //
        } catch (err) {
            this.log.error("Error while constructing UserPortfolioManagerService", err);
        }
    }
}
