import Service from "../app/service";
import { HTTPService } from "@cryptuoso/service";
import { sql } from "slonik";
import { getProperty, setProperty } from "@cryptuoso/test-helpers";
import { StatsCalcJobType } from "@cryptuoso/stats-calc-events";

const mockLog = {
    info: jest.fn(),
    error: jest.fn()
};

const mockEvents = {
    subscribe: jest.fn()
};

const mockAddOnStartHandler = jest.fn();
const mockAddOnStopHandler = jest.fn();
const mockCreateRoutes = jest.fn();

setProperty(HTTPService.prototype, "createRoutes", mockCreateRoutes);
setProperty(HTTPService.prototype, "events", mockEvents);
setProperty(HTTPService.prototype, "addOnStartHandler", mockAddOnStartHandler);
setProperty(HTTPService.prototype, "addOnStopHandler", mockAddOnStopHandler);
setProperty(HTTPService.prototype, "log", mockLog);

jest.mock("@cryptuoso/service");
jest.mock("bullmq");

describe("StatsCalcRunnerService methods", () => {
    const service = new Service();
    const mockPG = {
        maybeOne: jest.fn(),
        any: jest.fn()
    };

    setProperty(service, "db", {
        sql,
        pg: mockPG
    });

    let mockQueueAdd: jest.Mock;

    beforeAll(async (cb) => {
        //await service.startService();
        await service.onStartService();
        //mockQueueAdd = service.queues.calcStatistics.add as jest.Mock;
        mockQueueAdd = jest.fn();
        service.queueJob = mockQueueAdd;

        cb();
    });

    describe("queueJobWithExchangeAssetOption", () => {
        describe("exchange != null && asset != null", () => {
            test("Should call queueJob method with differrent arguments", async () => {
                const job = { robotId: "id" };
                const exchange = "e";
                const asset = "a";

                mockQueueAdd.mockClear();

                await service.queueJobWithExchangeAssetOption(StatsCalcJobType.usersRobotsAggr, job, exchange, asset);

                expect(mockQueueAdd).toBeCalledWith(StatsCalcJobType.usersRobotsAggr, { ...job });
                expect(mockQueueAdd).toBeCalledWith(StatsCalcJobType.usersRobotsAggr, { ...job, exchange });
                expect(mockQueueAdd).toBeCalledWith(StatsCalcJobType.usersRobotsAggr, { ...job, asset });
                expect(mockQueueAdd).toBeCalledWith(StatsCalcJobType.usersRobotsAggr, { ...job, exchange, asset });
            });
        });

        describe("exchange != null && asset == null", () => {
            test("Should call queueJob method with differrent arguments", async () => {
                const job = { robotId: "id" };
                const exchange = "e";
                const asset: string = null;

                mockQueueAdd.mockClear();

                await service.queueJobWithExchangeAssetOption(StatsCalcJobType.usersRobotsAggr, job, exchange, asset);

                expect(mockQueueAdd).toBeCalledWith(StatsCalcJobType.usersRobotsAggr, { ...job });
                expect(mockQueueAdd).toBeCalledWith(StatsCalcJobType.usersRobotsAggr, { ...job, exchange });
                expect(mockQueueAdd).not.toBeCalledWith(StatsCalcJobType.usersRobotsAggr, { ...job, asset });
                expect(mockQueueAdd).not.toBeCalledWith(StatsCalcJobType.usersRobotsAggr, { ...job, exchange, asset });
            });
        });

        describe("exchange == null && asset != null", () => {
            test("Should call queueJob method with differrent arguments", async () => {
                const job = { robotId: "id" };
                const exchange: string = null;
                const asset = "a";

                mockQueueAdd.mockClear();

                await service.queueJobWithExchangeAssetOption(StatsCalcJobType.usersRobotsAggr, job, exchange, asset);

                expect(mockQueueAdd).toBeCalledWith(StatsCalcJobType.usersRobotsAggr, { ...job });
                expect(mockQueueAdd).not.toBeCalledWith(StatsCalcJobType.usersRobotsAggr, { ...job, exchange });
                expect(mockQueueAdd).toBeCalledWith(StatsCalcJobType.usersRobotsAggr, { ...job, asset });
                expect(mockQueueAdd).not.toBeCalledWith(StatsCalcJobType.usersRobotsAggr, { ...job, exchange, asset });
            });
        });

        describe("exchange == null && asset == null", () => {
            test("Should call queueJob method with differrent arguments", async () => {
                const job = { robotId: "id" };
                const exchange: string = null;
                const asset: string = null;

                mockQueueAdd.mockClear();

                await service.queueJobWithExchangeAssetOption(StatsCalcJobType.usersRobotsAggr, job, exchange, asset);

                expect(mockQueueAdd).toBeCalledWith(StatsCalcJobType.usersRobotsAggr, { ...job });
                expect(mockQueueAdd).not.toBeCalledWith(StatsCalcJobType.usersRobotsAggr, { ...job, exchange });
                expect(mockQueueAdd).not.toBeCalledWith(StatsCalcJobType.usersRobotsAggr, { ...job, asset });
                expect(mockQueueAdd).not.toBeCalledWith(StatsCalcJobType.usersRobotsAggr, { ...job, exchange, asset });
            });
        });
    });

    describe("handleCalcUserSignalEvent", () => {
        test("Should call some methods", async () => {
            const userId = "user-id";
            const robotId = "robot-id";
            const calcAll = false;
            const exchange = "e";
            const asset = "a";

            mockPG.maybeOne.mockImplementation(async () => ({ exchange, asset }));

            const mockQueueJobExAsOpt = jest.spyOn(service, "queueJobWithExchangeAssetOption");

            mockQueueAdd.mockClear();
            mockQueueJobExAsOpt.mockClear();

            await service.handleCalcUserSignalEvent({ userId, robotId, calcAll });

            expect(mockQueueAdd).toBeCalledWith(
                StatsCalcJobType.userSignal,
                { calcAll, userId, robotId }
            );

            expect(mockQueueJobExAsOpt).toBeCalledWith(
                StatsCalcJobType.userSignalsAggr,
                { calcAll, userId },
                exchange,
                asset
            );
        });
    });

    describe("handleCalcUserSignalsEvent", () => {
        test("Should call some methods", async () => {
            const signal = { robotId: "id" };
            const signalsCount = Math.trunc(1 + 10 * Math.random());
            const signals = new Array(signalsCount).fill(signal);

            const exchangeAsset = { exchange: "e", asset: "a" };
            const exchangesAssetsCount = Math.trunc(1 + 10 * Math.random());
            const exchangesAssets = new Array(exchangesAssetsCount).fill(exchangeAsset);
            const args = { userId: "user-id", calcAll: false };

            mockPG.any.mockImplementation(async () => exchangesAssets);
            mockPG.any.mockImplementationOnce(async () => signals);

            mockQueueAdd.mockClear();

            await service.handleCalcUserSignalsEvent(args);

            expect(mockQueueAdd).toHaveBeenCalledTimes(signalsCount + 1 + 2 + exchangesAssetsCount);
            expect(mockQueueAdd).toBeCalledWith(StatsCalcJobType.userSignal, { ...args, robotId: signal.robotId });
            expect(mockQueueAdd).toBeCalledWith(StatsCalcJobType.userSignalsAggr, args);
            expect(mockQueueAdd).toBeCalledWith(StatsCalcJobType.userSignalsAggr, {
                ...args,
                exchange: exchangeAsset.exchange
            });
            expect(mockQueueAdd).toBeCalledWith(StatsCalcJobType.userSignalsAggr, {
                ...args,
                asset: exchangeAsset.asset
            });
            expect(mockQueueAdd).toBeCalledWith(StatsCalcJobType.userSignalsAggr, { ...args, ...exchangeAsset });
        });
    });

    describe("handleStatsCalcRobotEvent", () => {
        test("Should call some methods", async () => {
            const args = { calcAll: true, robotId: "robot-id" };
            const userId = "user-id";
            const exchange = "e";
            const asset = "a";
            const robot = { exchange, asset };
            const users = [
                { userId, exchange, asset },
                { userId, exchange, asset: "other" },
                { userId, exchange: "other", asset },
                { userId, exchange: "other", asset: "other" }
            ];
            mockPG.maybeOne.mockImplementation(async () => robot);
            mockPG.any.mockImplementation(async () => users);

            const mockQueueJobExAsOpt = jest.spyOn(service, "queueJobWithExchangeAssetOption");

            mockQueueAdd.mockClear();
            mockQueueJobExAsOpt.mockClear();

            await service.handleStatsCalcRobotEvent(args);

            expect(mockQueueAdd).toBeCalledWith(StatsCalcJobType.robot, args);
            expect(mockQueueAdd).toBeCalledWith(StatsCalcJobType.userSignals, args);

            expect(mockQueueJobExAsOpt).toBeCalledWith(
                StatsCalcJobType.robotsAggr,
                { calcAll: args.calcAll },
                exchange,
                asset
            );

            expect(mockQueueJobExAsOpt).toBeCalledWith(
                StatsCalcJobType.userSignalsAggr,
                { calcAll: args.calcAll, userId },
                exchange,
                asset
            );

            expect(mockQueueJobExAsOpt).toBeCalledWith(
                StatsCalcJobType.userSignalsAggr,
                { calcAll: args.calcAll, userId },
                exchange,
                null
            );

            expect(mockQueueJobExAsOpt).toBeCalledWith(
                StatsCalcJobType.userSignalsAggr,
                { calcAll: args.calcAll, userId },
                null,
                asset
            );

            expect(mockQueueJobExAsOpt).toBeCalledWith(
                StatsCalcJobType.userSignalsAggr,
                { calcAll: args.calcAll, userId },
                null,
                null
            );
        });
    });

    describe("handleStatsCalcRobotsEvent", () => {
        test("Should call some methods", async () => {
            const calcAll = true;
            const args = { calcAll };
            const robots = [{ id: "robot-id1" }, { id: "robot-id2" }, { id: "robot-id3" }, { id: "robot-id4" }];
            mockPG.any.mockImplementation(async () => robots);

            const mockhandleStatsCalcRobotEvent = jest.spyOn(service, "handleStatsCalcRobotEvent");

            await service.handleStatsCalcRobotsEvent(args);

            for (const { id: robotId } of robots)
                expect(mockhandleStatsCalcRobotEvent).toBeCalledWith({ calcAll, robotId });
        });
    });

    describe("handleStatsCalcUserRobotEvent", () => {
        test("Should call some methods", async () => {
            const calcAll = true;
            const userRobotId = "u-r-id";
            const args = { calcAll, userRobotId };
            const userId = "user-id";
            const exchange = "e";
            const asset = "a";
            const userRobot = { userId, exchange, asset };

            mockPG.maybeOne.mockImplementation(async () => userRobot);

            const mockQueueJobExAsOpt = jest.spyOn(service, "queueJobWithExchangeAssetOption");
            mockQueueAdd.mockClear();

            await service.handleStatsCalcUserRobotEvent(args);

            expect(mockQueueAdd).toBeCalledWith(StatsCalcJobType.userRobot, args);

            expect(mockQueueJobExAsOpt).toBeCalledWith(StatsCalcJobType.usersRobotsAggr, { calcAll }, exchange, asset);

            expect(mockQueueJobExAsOpt).toBeCalledWith(
                StatsCalcJobType.userRobotAggr,
                { calcAll, userId },
                exchange,
                asset
            );
        });
    });

    describe("handleRecalcAllRobotsEvent", () => {
        test("Should call some methods", async () => {
            const exchange = "e";
            const asset = "a";
            const currency = "c";
            const strategy = "s";
            const args = { exchange, asset, currency, strategy };
            const robots = [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }];
            const signals = [
                { robotId: "1", userId: "1" },
                { robotId: "2", userId: "2" },
                { robotId: "3", userId: "3" },
                { robotId: "4", userId: "4" }
            ];

            mockPG.any.mockImplementation(async () => signals);
            mockPG.any.mockImplementationOnce(async () => robots);

            const mockHandleStatsCalcRobotEvent = jest.spyOn(service, "handleStatsCalcRobotEvent");
            const mockQueueJobExAsOpt = jest.spyOn(service, "queueJobWithExchangeAssetOption");
            const mockHandleCalcUserSignalEvent = jest.spyOn(service, "handleCalcUserSignalEvent");

            mockHandleStatsCalcRobotEvent.mockClear();
            mockQueueJobExAsOpt.mockClear();
            mockHandleCalcUserSignalEvent.mockClear();

            await service.handleRecalcAllRobotsEvent(args);

            for (const { id: robotId } of robots)
                expect(mockHandleStatsCalcRobotEvent).toBeCalledWith({ robotId, calcAll: true }, false);

            expect(mockQueueJobExAsOpt).toBeCalledWith(StatsCalcJobType.robotsAggr, { calcAll: true }, exchange, asset);

            for (const { robotId, userId } of signals)
                expect(mockHandleCalcUserSignalEvent).toBeCalledWith({ robotId, userId, calcAll: true });
        });
    });

    describe("handleRecalcAllUserSignalsEvent", () => {
        test("Should call some methods", async () => {
            const robotId = "robot-id";
            const userId = "user-id";
            const exchange = "e";
            const asset = "a";
            const currency = "c";
            const strategy = "s";
            const args = { exchange, asset, currency, strategy, robotId, userId };
            const signals = [
                { robotId: "1", userId: "1" },
                { robotId: "2", userId: "2" },
                { robotId: "3", userId: "3" },
                { robotId: "4", userId: "4" }
            ];

            mockPG.any.mockImplementation(async () => signals);

            const mockHandleCalcUserSignalEvent = jest.spyOn(service, "handleCalcUserSignalEvent");

            mockHandleCalcUserSignalEvent.mockClear();

            await service.handleRecalcAllUserSignalsEvent(args);

            for (const { robotId, userId } of signals)
                expect(mockHandleCalcUserSignalEvent).toBeCalledWith({ robotId, userId, calcAll: true });
        });
    });

    describe("handleRecalcAllUserRobotsEvent", () => {
        test("Should call some methods", async () => {
            const robotId = "robot-id";
            const userId = "user-id";
            const exchange = "e";
            const asset = "a";
            const currency = "c";
            const strategy = "s";
            const args = { exchange, asset, currency, strategy, robotId, userId };
            const userRobots = [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }];

            mockPG.any.mockImplementation(async () => userRobots);

            const mockHandleStatsCalcUserRobotEvent = jest.spyOn(service, "handleStatsCalcUserRobotEvent");
            const mockQueueJobExAsOpt = jest.spyOn(service, "queueJobWithExchangeAssetOption");

            mockHandleStatsCalcUserRobotEvent.mockClear();
            mockQueueJobExAsOpt.mockClear();

            await service.handleRecalcAllUserRobotsEvent(args);

            for (const { id: userRobotId } of userRobots)
                expect(mockHandleStatsCalcUserRobotEvent).toBeCalledWith({ userRobotId, calcAll: true }, false);

            expect(mockQueueJobExAsOpt).toBeCalledWith(
                StatsCalcJobType.usersRobotsAggr,
                { calcAll: true },
                exchange,
                asset
            );
        });
    });
});
