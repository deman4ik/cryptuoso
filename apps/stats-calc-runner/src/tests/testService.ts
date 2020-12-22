import Service from "../app/service";

async function checkResult(name: string, prom: Promise<any>) {
    try {
        console.log(name, await prom);
    } catch (err) {
        console.log(`Error while run ${name}`, err);
    }
}

export async function testService(service: Service) {
    const calcAll = true;
    const robotId = "51c90607-6d38-4b7c-81c9-d349886e80b0"; // 8504
    const userRobotId = "d2d1fe2d-c517-4161-a583-66f218c9217a";
    const userId = "8a671981-2b11-4ae5-bc3f-1a63befdba72";
    const exchange = "kraken"; // "bitfinex"
    const asset = "BTC"; //

    await checkResult(
        "handleCalcUserSignalEvent",
        service.handleCalcUserSignalEvent({
            calcAll,
            userId,
            robotId
        })
    );

    await checkResult(
        "handleCalcUserSignalsEvent",
        service.handleCalcUserSignalsEvent({
            calcAll,
            userId
        })
    );

    await checkResult(
        "handleStatsCalcRobotEvent",
        service.handleStatsCalcRobotEvent({
            calcAll,
            robotId
        })
    );

    await checkResult(
        "handleStatsCalcRobotsEvent",
        service.handleStatsCalcRobotsEvent({
            calcAll
        })
    );

    await checkResult(
        "handleStatsCalcUserRobotEvent",
        service.handleStatsCalcUserRobotEvent({
            calcAll,
            userRobotId
        })
    );

    await checkResult(
        "handleStatsCalcUserRobotsEvent",
        service.handleStatsCalcUserRobotsEvent({
            calcAll,
            userId
        })
    );

    await checkResult(
        "handleStatsCalcUserRobotsEvent",
        service.handleStatsCalcUserRobotsEvent({
            calcAll,
            userId,
            exchange
        })
    );

    await checkResult(
        "handleStatsCalcUserRobotsEvent",
        service.handleStatsCalcUserRobotsEvent({
            calcAll,
            userId,
            asset
        })
    );

    await checkResult(
        "handleStatsCalcUserRobotsEvent",
        service.handleStatsCalcUserRobotsEvent({
            calcAll,
            userId,
            asset,
            exchange
        })
    );

    await checkResult(
        "handleRecalcAllRobotsEvent",
        service.handleRecalcAllRobotsEvent({
            /* calcAll, userId, asset, exchange */
        })
    );

    await checkResult(
        "handleRecalcAllUserSignalsEvent",
        service.handleRecalcAllUserSignalsEvent({
            /* calcAll, userId, asset, exchange */
        })
    );

    await checkResult(
        "handleRecalcAllUserRobotsEvent",
        service.handleRecalcAllUserRobotsEvent({
            /* calcAll, userId, asset, exchange */
        })
    );
}
