/* process.env.REDISCS = "localhost:1001";
process.env.PGCS = "postgresql://domanage:by0lxgsisx1f3fx6@cpz-db-prod-do-user-6134655-0.db.ondigitalocean.com:25061/cpz-dev?sslmode=require&ssl=1";
 */
import Service from "./app/service";
import log from "@cryptuoso/logger";

const service = new Service();

console.log("Starting", process.env.PGCS);

async function ByAll(count: number = 10) {
    const argArr = [];
    for(let i=0; i<count; ++i)
        argArr.push(service.tryGetAll());
    const results = await Promise.all(argArr);
}

async function ByStreams(count: number = 10) {
    const argArr = [];
    for(let i=0; i<count; ++i)
        argArr.push(service.tryGetStream());
    const results = await Promise.all(argArr);
    console.log(service.streamsConnectionsCount);
}

async function start() {
    try {
        await service.startService();

        console.log("Connected");
    } catch (error) {
        console.log(error);
        log.error(error, `Failed to start service ${process.env.SERVICE}`);
        process.exit(1);
    }

    const count = 1;
    let startTime = Date.now();
    
    /* await ByAll(count);
    console.log(count, " All times: ", Date.now() - startTime);
    
    startTime = Date.now();

    await ByStreams(count);
    console.log(count, " Streams times: ", Date.now() - startTime);  */

    await service.calcRobot('51c90607-6d38-4b7c-81c9-d349886e80b0');
    console.log(count, " All times: ", Date.now() - startTime);
}
start();
