import Service from "./app/service";
import log from "@cryptuoso/logger";
import Monitoring from "./tests/monitoring";

const service = new Service();
const monitor = new Monitoring();

console.log("Starting", process.env.PGCS);

async function startSeveralFunctions(func: { (): Promise<any> }, count: number = 10) {
    const argArr = [];
    let errorsCount = 0;
    for (let i = 0; i < count; ++i)
        argArr.push(func().catch((e) => {
            console.log("Function Error: ", e.message);
            ++errorsCount;
            return e.message;
        }));
    const errors = Array.from(new Set(await Promise.all(argArr))).filter((el) => el);
    return { threadsCount: count, errorsCount, errors };
}

async function measureCalcRobot(
    name: string,
    func: { (robotId: string, updateAll: boolean): Promise<any> },
    count: number,
    robotId: string,
    updateAll: boolean
) {
    /* log.info("Call GC");
    global.gc(); */
    log.info(`${name} starts`);

    monitor.clear();
    monitor.start();

    const res = await startSeveralFunctions(async () => {
        //setTimeout(() => console.log("JS: ", service.pgJS.getPoolState()), 1000);
        //setTimeout(() => console.log("NATIVE: ", service.db.pg.getPoolState()), 1000);
        return await func(robotId, updateAll);
    }, count);

    monitor.stop();
    log.info(`${name} ends`);
    return { name, ...res, ...monitor.getMetricks() };
}

async function testService() {
    const count = 10;
    const updateAll = true;
    const robotId = "51c90607-6d38-4b7c-81c9-d349886e80b0"; // 8504
    const results = [];

    /* await new Promise((resolve) => setTimeout(resolve, 20000)); */

    log.info("Tests starting");

    /* const backendProcessId = await service.db.pg.oneFirst(service.db.sql`SELECT pg_backend_pid()`);
    
    setTimeout(async () => {
        console.log("Closing");
        await service.db.pg.query(service.db.sql`SELECT pg_cancel_backend(${backendProcessId})`);
    }, 3000); */

    //await service.streamAgain();

    /* results.push(await measureCalcRobot(
        "Single",
        service.getPositionsCount.bind(service),
        count, robotId, updateAll
    )); */

    results.push(await measureCalcRobot(
        "Single",
        service.calcRobotBySingleQuery.bind(service),
        count, robotId, updateAll
    ));

    results.push(await measureCalcRobot(
        "Chunks",
        service.calcRobotByChunks.bind(service),
        count, robotId, updateAll
    ));

    results.push(await measureCalcRobot(
        "Chunks + c",
        service.calcRobotByChunksWithConnection.bind(service),
        count, robotId, updateAll
    ));

    /* results.push(await measureCalcRobot(
        "Stream",
        service.calcRobotByStream.bind(service),
        count, robotId, updateAll
    ));

    results.push(await measureCalcRobot(
        "Stream + c",
        service.calcRobotByStreamWithConnection.bind(service),
        count, robotId, updateAll
    )); */

    console.log(JSON.stringify(results));
}

async function start() {
    try {
        await service.startService();

        log.info("Connected");

        testService();
    } catch (error) {
        log.error(error, `Failed to start service ${process.env.SERVICE}`);
        process.exit(1);
    }
}
start();
