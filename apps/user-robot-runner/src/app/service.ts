import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";

export type UserRobotRunnerServiceConfig = HTTPServiceConfig;

export default class UserRobotRunnerService extends HTTPService {
    #robotJobRetries = 3;
    constructor(config?: UserRobotRunnerServiceConfig) {
        super(config);
        try {
            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error(err, "While constructing UserRobotRunnerService");
        }
    }

    async onServiceStart() {
        this.createQueue("userRobot");
    }
}
