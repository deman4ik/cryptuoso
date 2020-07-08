import { ExwatcherBaseService } from "@cryptuoso/exwatcher-base";
import log from "@cryptuoso/logger";

const service = new ExwatcherBaseService({
    exchange: "binance_futures"
});

async function start() {
    try {
        await service.startService();
    } catch (error) {
        log.error(error, `Failed to start service ${process.env.SERVICE}`);
        process.exit(1);
    }
}
start();
