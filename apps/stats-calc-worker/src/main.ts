import Service from "./app/service";
import log from "@cryptuoso/logger";
import { testService } from "./tests/testService";

const service = new Service();

log.info("Starting", process.env.PGCS);

async function start() {
    try {
        await service.startService();

        log.info("Connected");

        //testService(service);
    } catch (error) {
        log.error(error, `Failed to start service ${process.env.SERVICE}`);
        process.exit(1);
    }
}
start();
