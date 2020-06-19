import ImporterRunner from "./app/service";
import log from "@cryptuoso/logger";

const service = new ImporterRunner();

async function start() {
    try {
        await service.startService();
    } catch (error) {
        log.error(error, `Failed to start service ${process.env.SERVICE}`);
        process.exit(1);
    }
}
start();
