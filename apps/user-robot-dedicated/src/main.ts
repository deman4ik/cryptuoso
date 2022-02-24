import { UserRobotBaseService as Service } from "@cryptuoso/user-robot";
import log from "@cryptuoso/logger";

if (!process.env.EXCHANGE) {
    log.error("No env vars");
} else {
    const service = new Service();

    async function start() {
        try {
            await service.startService();
        } catch (error) {
            log.error(`Failed to start service ${process.env.SERVICE}`, error);
            process.exit(1);
        }
    }
    start();
}
