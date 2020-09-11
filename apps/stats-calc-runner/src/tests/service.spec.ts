import Service from "../app/service";
import { HTTPService } from "@cryptuoso/service";
import { sql } from "slonik";
import { getProperty, setProperty } from "@cryptuoso/test-helpers";
import { StatsCalcJobType } from '@cryptuoso/stats-calc-events';

const mockLog = {
    info: jest.fn(console.info),
    error: jest.fn(console.error)
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

describe("methods", () => {
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
    
    describe("handleCalcUserSignalEvent", () => {
        test("Should call some methods", async () => {
            mockPG.maybeOne.mockImplementation(async () => ({}));

            mockQueueAdd.mockClear();

            await service.handleCalcUserSignalEvent({userId: "", robotId: ""});

            expect(mockQueueAdd).toHaveBeenCalledTimes(2);
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
            const args = { userId: "", calcAll: false };

            mockPG.any.mockImplementation(async () => exchangesAssets);
            mockPG.any.mockImplementationOnce(async () => signals);

            mockQueueAdd.mockClear();

            await service.handleCalcUserSignalsEvent(args);

            expect(mockQueueAdd).toHaveBeenCalledTimes(signalsCount + 1 + 2 + exchangesAssetsCount);
            expect(mockQueueAdd).toBeCalledWith(
                StatsCalcJobType.userSignal, { ...args, robotId: signal.robotId }
            );
            expect(mockQueueAdd).toBeCalledWith(
                StatsCalcJobType.userSignalsAggr, args
            );
            expect(mockQueueAdd).toBeCalledWith(
                StatsCalcJobType.userSignalsAggr, { ...args, exchange: exchangeAsset.exchange }
            );
            expect(mockQueueAdd).toBeCalledWith(
                StatsCalcJobType.userSignalsAggr, { ...args, asset: exchangeAsset.asset }
            );
            expect(mockQueueAdd).toBeCalledWith(
                StatsCalcJobType.userSignalsAggr, { ...args, ...exchangeAsset }
            );
        });
    });
});
