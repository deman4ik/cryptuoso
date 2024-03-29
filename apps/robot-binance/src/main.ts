import { RobotBaseService } from "@cryptuoso/robot";
import log from "@cryptuoso/logger";

const service = new RobotBaseService({
    exchange: "binance_futures"
});

async function start() {
    try {
        await service.startService();
    } catch (error) {
        log.error(`Failed to start service ${process.env.SERVICE}`, error);
        process.exit(1);
    }
}
start();
