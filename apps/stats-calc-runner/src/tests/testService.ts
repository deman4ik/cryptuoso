import Service from "../app/service";

export async function testService(service: Service) {
    const calcAll = false;
    const robotId = "51c90607-6d38-4b7c-81c9-d349886e80b0"; // 8504
    const userRobotId = "d2d1fe2d-c517-4161-a583-66f218c9217a";
    const userId = "8a671981-2b11-4ae5-bc3f-1a63befdba72";
    const exchange = "kraken"; // "bitfinex"
    const asset = "BTC"; //

    /* console.log("handleCalcUserSignalEvent", await service.handleCalcUserSignalEvent({
        calcAll, userId, robotId
    }));

    console.log("handleCalcUserSignalsEvent", await service.handleCalcUserSignalsEvent({
        calcAll, userId
    }));

    console.log("handleStatsCalcRobotEvent", await service.handleStatsCalcRobotEvent({
        calcAll, robotId
    }));

    console.log("handleStatsCalcRobotsEvent", await service.handleStatsCalcRobotsEvent({
        calcAll
    }));

    console.log("handleStatsCalcUserRobotEvent", await service.handleStatsCalcUserRobotEvent({
        calcAll, userRobotId
    }));

    console.log("handleStatsCalcUserRobotsEvent", await service.handleStatsCalcUserRobotsEvent({
        calcAll, userId
    }));

    console.log("handleStatsCalcUserRobotsEvent", await service.handleStatsCalcUserRobotsEvent({
        calcAll, userId, exchange
    }));

    console.log("handleStatsCalcUserRobotsEvent", await service.handleStatsCalcUserRobotsEvent({
        calcAll, userId, asset
    }));

    console.log("handleStatsCalcUserRobotsEvent", await service.handleStatsCalcUserRobotsEvent({
        calcAll, userId, asset, exchange
    })); */

    console.log(
        "handleRecalcAllRobotsEvent",
        await service.handleRecalcAllRobotsEvent({
            /* calcAll, userId, asset, exchange */
        })
    );

    console.log(
        "handleRecalcAllUserSignalsEvent",
        await service.handleRecalcAllUserSignalsEvent({
            /* calcAll, userId, asset, exchange */
        })
    );

    console.log(
        "handleRecalcAllUserRobotsEvent",
        await service.handleRecalcAllUserRobotsEvent({
            /* calcAll, userId, asset, exchange */
        })
    );
}
