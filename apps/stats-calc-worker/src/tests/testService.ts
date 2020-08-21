import Service from "../app/service";
import { measureFunction } from "./measuring";
import log from "@cryptuoso/logger";

export async function testService(service: Service) {
    const count = 100;
    const updateAll = false;
    const robotId = "51c90607-6d38-4b7c-81c9-d349886e80b0"; // 8504
    const results = [];
    const exitDate = "2020-06-11T06:46:15.081Z"; // "2020-05-12T23:24:28.493Z"; //

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

    console.log(results);
    console.log(JSON.stringify(results));
    return results;
}