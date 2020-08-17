/* process.env.REDISCS = "localhost:1001";
process.env.PGCS = "postgresql://domanage:by0lxgsisx1f3fx6@cpz-db-prod-do-user-6134655-0.db.ondigitalocean.com:25061/cpz-dev?sslmode=require&ssl=1";
 */
import Service from "./app/service";
import log from "@cryptuoso/logger";

const service = new Service();

console.log("Starting", process.env.PGCS);

async function startSeveralFunctions(func: { (): Promise<any> }, count: number = 10) {
    const argArr = [];
    for (let i = 0; i < count; ++i) argArr.push(func());
    return await Promise.all(argArr);
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

    const count = 10;
    const robotId = "51c90607-6d38-4b7c-81c9-d349886e80b0";
    let startTime;

    startTime = Date.now();
    await startSeveralFunctions(async () => await service.calcRobotBySingleQuery(robotId), count);
    console.log("All time: ", Date.now() - startTime);

    startTime = Date.now();
    await startSeveralFunctions(async () => await service.calcRobotByChunks(robotId), count);
    console.log("Chunks time: ", Date.now() - startTime);

    startTime = Date.now();
    await startSeveralFunctions(async () => await service.calcRobotByStream(robotId), count);
    console.log("Stream time: ", Date.now() - startTime);
}
start();
