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

async function measureFunction(
    name: string,
    func: { (robotId: string, updateAll: boolean): Promise<any> },
    count: number,
    robotId: string,
    updateAll: boolean
) {
    const startTime = Date.now();
    try {
        await startSeveralFunctions(async () => {
            return await func(robotId, updateAll);
        }, count);
    } catch(err) {
        console.log(`${name} error: ${err.message}`);
    }
    console.log(`${name}: \t time - ${Date.now() - startTime}, \t copies - ${count}`);
}

async function testService() {
    const count = 7;
    const updateAll = true;
    const robotId = "51c90607-6d38-4b7c-81c9-d349886e80b0";

    //console.log(await service.getRobot(robotId));

    //await service.checkStreamOrder(robotId, updateAll);

    //await service.streamAgain();

    await measureFunction(
        "Single",
        service.calcRobotBySingleQuery.bind(service),
        count, robotId, updateAll
    );

    await measureFunction(
        "Chunks",
        service.calcRobotByChunks.bind(service),
        count, robotId, updateAll
    );

    await measureFunction(
        "Chunks + c",
        service.calcRobotByChunksWithConnection.bind(service),
        count, robotId, updateAll
    );

    await measureFunction(
        "Stream",
        service.calcRobotByStream.bind(service),
        count, robotId, updateAll
    );
}

async function start() {
    try {
        await service.startService();

        console.log("Connected");

        testService();
    } catch (error) {
        log.error(error, `Failed to start service ${process.env.SERVICE}`);
        process.exit(1);
    }
}
start();
