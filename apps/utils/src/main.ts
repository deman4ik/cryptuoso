//import Service from "./app/service";
import { UserRobotBaseService as Service } from "@cryptuoso/user-robot";
import log from "@cryptuoso/logger";

const service = new Service({ exchange: "binance_futures", userPortfolioId: "eb9e8141-1ac1-4514-a3c2-f24d8a3b515e" });

async function start() {
    try {
        await service.startService();
    } catch (error) {
        log.error(`Failed to start service ${process.env.SERVICE}`, error);
        process.exit(1);
    }
}
start();
