import Service from "./app/service";
import log from "@cryptuoso/logger";
import { testService } from "./tests/testService";

const service = new Service();

async function start() {
    try {
        console.log(process.env.REDISCS);
        await service.startService();

        await testService(service);
    } catch (error) {
        log.error(error, `Failed to start service ${process.env.SERVICE}`);
        process.exit(1);
    }
}
start();
