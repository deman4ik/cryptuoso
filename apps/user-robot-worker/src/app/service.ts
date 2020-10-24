import { BaseService, BaseServiceConfig } from "@cryptuoso/service";

export type UserRobotRunnerServiceConfig = BaseServiceConfig;

export default class UserRobotRunnerService extends BaseService {
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
        this.createQueue("UserRobot");
    }
}
