import Service from "./app/service";
import log from "@cryptuoso/logger";

const service = new Service();

async function start() {
    try {
        await service.startService();
        await service.handleUserPortfolioBuilded({ userPortfolioId: "b6340c3b-c604-49d8-9485-758f0ab7465a" });
    } catch (error) {
        log.error(`Failed to start service ${process.env.SERVICE}`, error);
        process.exit(1);
    }
}
start();
