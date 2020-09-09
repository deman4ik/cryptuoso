import Service from "../app/service";
import { measureFunction } from "@cryptuoso/test-helpers";
import log from "@cryptuoso/logger";

export async function testService(service: Service) {
    const count = 20;
    const updateAll = true;
    const robotId = "51c90607-6d38-4b7c-81c9-d349886e80b0"; // 8504
    //const userRobotId = "d2d1fe2d-c517-4161-a583-66f218c9217a";
    //const userId = "b6d0e992-f716-42d5-b69c-6a0b29ef4172"; //"8a671981-2b11-4ae5-bc3f-1a63befdba72"; //"b6d0e992-f716-42d5-b69c-6a0b29ef4172"; //"8a671981-2b11-4ae5-bc3f-1a63befdba72";
    const results = [];
    //const exitDate = "2020-06-11T06:46:15.081Z"; // "2020-05-12T23:24:28.493Z"; //

    /* await new Promise((resolve) => setTimeout(resolve, 20000)); */

    log.info("Tests starting");

    /* const backendProcessId = await service.db.pg.oneFirst(service.db.sql`SELECT pg_backend_pid()`);
    
    setTimeout(async () => {
        console.log("Closing");
        await service.db.pg.query(service.db.sql`SELECT pg_cancel_backend(${backendProcessId})`);
    }, 3000); */

    results.push(await measureFunction(
        "calcRobot",
        service.calcRobot.bind(service),
        [robotId, updateAll],
        count
    ));

    /* results.push(
        await measureFunction("calcRobotsAggr", service.calcRobotsAggr.bind(service), ["binance_futures"], count)
    ); */

    /* results.push(await measureFunction(
        "calcUsersRobotsAggr",
        service.calcUsersRobotsAggr.bind(service),
        [],
        count
    )); */

    /* results.push(await measureFunction(
        "calcUserSignalsAggr",
        service.calcUserSignalsAggr.bind(service),
        [userId, null, null, updateAll],
        count
    )); */

    /* results.push(await measureFunction(
        "calcUserRobotsAggr",
        service.calcUserRobotsAggr.bind(service),
        [userId, 'kraken', 'BTC', updateAll],
        count
    )); */

    /* results.push(await measureFunction(
        "calcUserRobot",
        service.calcUserRobot.bind(service),
        [userRobotId, updateAll],
        count
    )); */

    /* results.push(await measureFunction(
        "calcUserSignalsAggr",
        service.calcUserSignalsAggr.bind(service),
        [userId, null, null, updateAll],
        count
    )); */

    /* results.push(await measureFunction(
        "calcUserSignals",
        service.calcUserSignals.bind(service),
        [robotId, updateAll],
        count
    )); */

    /* results.push(await measureFunction(
        "calcUserSignal",
        service.calcUserSignal.bind(service),
        ["8a671981-2b11-4ae5-bc3f-1a63befdba72", robotId, updateAll],
        count
    )); */

    //await service.printUsers();
    //await service.printUserAggrStats("userRobot");
    //await service.printUserSignals();
    //await service.printRobots();

    console.log(results);
    //console.log(JSON.stringify(results));
    return results;
}
