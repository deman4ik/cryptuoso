import Service, { getCalcFromAndInitStats } from "../app/service";
import { TradeStats, TradeStatsClass, isTradeStats, PositionDataForStats } from "@cryptuoso/trade-statistics";
import dayjs from "@cryptuoso/dayjs";
import { pg } from "@cryptuoso/postgres";
import { setProperty, getProperty } from "@cryptuoso/test-helpers";
import { StatsCalcJobType, StatsCalcJob } from "@cryptuoso/stats-calc-events";
import { Job } from "bullmq";
import { Pool } from "threads";
import { StatisticsType } from "../app/statsWorkerTypes";

const mockPG = {
    any: pg.any as jest.Mock,
    maybeOne: pg.maybeOne as jest.Mock,
    oneFirst: pg.oneFirst as jest.Mock,
    query: pg.query as jest.Mock
};

const mockExit = jest.fn();

setProperty(process, "exit", mockExit);

jest.mock("@cryptuoso/service", () => {
    return {
        BaseService: class BaseService {
            #onStartHandler: { (): Promise<any> };
            #onStopHandler: { (): Promise<any> };
            addOnStartHandler = jest.fn(async (func: any) => (this.#onStartHandler = func.bind(this)));
            addOnStopHandler = jest.fn(async (func: any) => (this.#onStopHandler = func.bind(this)));
            log = {
                info: jest.fn(),
                error: jest.fn()
            };
            db = {
                sql: jest.fn(),
                pg: mockPG
            };

            async startService() {
                if (this.#onStartHandler) await this.#onStartHandler();
            }

            async stopService() {
                if (this.#onStopHandler) await this.#onStopHandler();
            }
        },
        BaseServiceConfig: {}
    };
});

jest.mock("threads", () => ({
    Pool: jest.fn(() => ({
        queue: jest.fn(),
        terminate: jest.fn()
    })),
    spawn: jest.fn()
}));
jest.mock("bullmq");
jest.mock("lightship");
jest.mock("ioredis");
//jest.mock("@cryptuoso/logger");
jest.mock("@cryptuoso/postgres");
jest.mock("@cryptuoso/events");
jest.mock("@cryptuoso/mail");

function makeJob(name: string, data: StatsCalcJob = {}) {
    return { name, data } as Job<StatsCalcJob>;
}

describe("getCalcFromAndInitStats function", () => {
    const robotStatsWithLastPosDate = new TradeStatsClass();

    robotStatsWithLastPosDate.lastPositionExitDate = dayjs().toISOString();

    describe("stats = null, calcAll = null", () => {
        test("Should returns nulls", () => {
            const { calcFrom, initStats } = getCalcFromAndInitStats(null, null);

            expect(calcFrom).toStrictEqual(null);
            expect(initStats).toStrictEqual(null);
        });
    });

    describe("stats = null, calcAll = true", () => {
        test("Should returns nulls", () => {
            const { calcFrom, initStats } = getCalcFromAndInitStats(null, true);

            expect(calcFrom).toStrictEqual(null);
            expect(initStats).toStrictEqual(null);
        });
    });

    describe("stats = null, calcAll = false", () => {
        test("Should returns nulls", () => {
            const { calcFrom, initStats } = getCalcFromAndInitStats(null, false);

            expect(calcFrom).toStrictEqual(null);
            expect(initStats).toStrictEqual(null);
        });
    });

    describe("stats is wrong object, calcAll = null", () => {
        test("Should returns nulls", () => {
            const wrongStats = {} as TradeStats;
            const { calcFrom, initStats } = getCalcFromAndInitStats(wrongStats, null);

            expect(calcFrom).toStrictEqual(null);
            expect(initStats).toStrictEqual(null);
        });
    });

    describe("stats is right, calcAll = true", () => {
        test("Should returns nulls", () => {
            const rightStats: TradeStats = { ...robotStatsWithLastPosDate };
            const { calcFrom, initStats } = getCalcFromAndInitStats(rightStats, true);

            expect(calcFrom).toStrictEqual(null);
            expect(initStats).toStrictEqual(null);
        });
    });

    describe("stats is right, calcAll = false", () => {
        test("Should returns right calcFrom date and initStats typeof TradeStats", () => {
            const rightStats: TradeStats = { ...robotStatsWithLastPosDate };
            const { calcFrom, initStats } = getCalcFromAndInitStats(rightStats, false);

            expect(calcFrom).toStrictEqual(rightStats.lastPositionExitDate);

            expect(isTradeStats(initStats)).toBeTruthy();

            expect(initStats.equity).toStrictEqual(rightStats.equity);
            expect(initStats.equityAvg).toStrictEqual(rightStats.equityAvg);
            expect(initStats.lastPositionExitDate).toStrictEqual(rightStats.lastPositionExitDate);
            expect(initStats.lastUpdatedAt).toStrictEqual(rightStats.lastUpdatedAt);
            expect(initStats.statistics).toStrictEqual(rightStats.statistics);
        });
    });
});

function getParams(func: { (...args: any[]): any }) {
    let str = func.toString();

    str = str
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/(.)*/g, "")
        .replace(/{[\s\S]*}/, "")
        .replace(/=>/g, "")
        .trim();

    const start = str.indexOf("(") + 1;
    const end = str.length - 1;

    const result = str.substring(start, end).split(", ");

    const params: string[] = [];

    result.forEach((element) => {
        element = element.replace(/=[\s\S]*/g, "").trim();

        if (element.length > 0) params.push(element);
    });

    return params;
}

async function combineArgs(
    args: any[],
    argsNames: string[],
    minArgsCount: number,
    callback: { (currentArgs: any[], currentArgsNames: string[]): any },
    provideAll = false,
    defaultValue: any = null
) {
    let cnt = minArgsCount ** 2;

    if (!provideAll) --cnt;

    for (let i = 0; i < cnt; ++i) {
        const currentArgs = new Array(args.length).fill(defaultValue);
        const currentArgsNames = [];

        for (let j = 0; j < minArgsCount; ++j) {
            if ((i >> j) % 2) {
                currentArgs[j] = args[j];
                currentArgsNames.push(argsNames[j]);
            }
        }

        await callback(currentArgs, currentArgsNames);
    }
}

function testStatsCalcMethod({
    methodName,
    minArgsCount,
    args,
    needCheckStatsExisting = true,
    isStatsSingle = true
}: {
    methodName: string;
    minArgsCount: number;
    args: any[];
    needCheckStatsExisting?: boolean;
    isStatsSingle?: boolean;
}) {
    describe(`${methodName} method`, () => {
        const service = new Service();
        const mockUpsertStats = jest.fn();

        service.calcStatistics = jest.fn();
        setProperty(service, "upsertStats", mockUpsertStats);

        let func: { (...args: any[]): Promise<boolean> } = getProperty(service, methodName);
        const argsNames = getParams(func);
        func = func.bind(service);

        const minArgsOtherNulls = new Array(args.length).fill(null);

        for (let i = 0; i < minArgsCount; ++i) minArgsOtherNulls[i] = args[i];

        describe("With combine nulls arguments", () => {
            test("Should to throw errors", async () => {
                await combineArgs(args, argsNames, minArgsCount, async (currentArgs, currentArgsNames) => {
                    await expect(func(...currentArgs))
                        .rejects.toThrowError()
                        .catch(() => {
                            throw new Error(`${currentArgsNames.join(", ")} args with nulls provided`);
                        });
                });
            });
        });

        if (needCheckStatsExisting) {
            describe(`${argsNames.slice(0, minArgsCount).join(", ")} provided but is wrong`, () => {
                test("Should to throw error", async () => {
                    if (isStatsSingle) mockPG.maybeOne.mockImplementation(async () => null);
                    else mockPG.any.mockImplementation(async () => []);
                    await expect(func(...minArgsOtherNulls)).rejects.toThrowError();
                });
            });
        }

        describe(`${argsNames.slice(0, minArgsCount).join(", ")} provided but positions not exists`, () => {
            test("Should to throw error", async () => {
                if (isStatsSingle) mockPG.maybeOne.mockImplementation(async () => ({}));
                else mockPG.any.mockImplementationOnce(async () => [{}]);
                mockPG.oneFirst.mockImplementation(async () => 0);
                await expect(func(...minArgsOtherNulls)).resolves.toStrictEqual(false);
            });
        });

        describe(`${argsNames.slice(0, minArgsCount).join(", ")} provided and positions exists`, () => {
            test("Should to call upsertStats", async () => {
                if (isStatsSingle) mockPG.maybeOne.mockImplementation(async () => ({}));
                else mockPG.any.mockImplementationOnce(async () => [{}]);
                mockPG.oneFirst.mockImplementation(async () => service.defaultChunkSize);
                mockPG.any.mockImplementation(async () => [{}]);

                mockUpsertStats.mockClear();

                await func(...minArgsOtherNulls);

                expect(service.calcStatistics).toHaveBeenCalled();
                expect(mockUpsertStats).toHaveBeenCalledTimes(1);
            });
        });
    });
}

describe("stats-calc-worker class", () => {
    describe("constructor", () => {
        test("Should initialize handlers", async () => {
            const service = new Service();

            expect(service.addOnStartHandler).toHaveBeenCalledTimes(1);
            expect(service.addOnStopHandler).toHaveBeenCalledTimes(1);
        });
    });

    describe("process method", () => {
        const service = new Service();

        describe("On robot job", () => {
            test("Should call calcRobot method 1 time", async () => {
                service.calcRobot = jest.fn();

                await service.process(makeJob(StatsCalcJobType.robot));

                expect(service.calcRobot).toHaveBeenCalledTimes(1);
            });
        });

        describe("On robotsAggr job", () => {
            test("Should call calcRobotsAggr method 1 time", async () => {
                service.calcRobotsAggr = jest.fn();

                await service.process(makeJob(StatsCalcJobType.robotsAggr));

                expect(service.calcRobotsAggr).toHaveBeenCalledTimes(1);
            });
        });

        describe("On usersRobotsAggr job", () => {
            test("Should call calcUsersRobotsAggr method 1 time", async () => {
                service.calcUsersRobotsAggr = jest.fn();

                await service.process(makeJob(StatsCalcJobType.usersRobotsAggr));

                expect(service.calcUsersRobotsAggr).toHaveBeenCalledTimes(1);
            });
        });

        describe("On userRobot job", () => {
            test("Should call calcUserRobot method 1 time", async () => {
                service.calcUserRobot = jest.fn();

                await service.process(makeJob(StatsCalcJobType.userRobot));

                expect(service.calcUserRobot).toHaveBeenCalledTimes(1);
            });
        });

        describe("On userSignal job", () => {
            test("Should call calcUserSignal method 1 time", async () => {
                service.calcUserSignal = jest.fn();

                await service.process(makeJob(StatsCalcJobType.userSignal));

                expect(service.calcUserSignal).toHaveBeenCalledTimes(1);
            });
        });

        describe("On userSignals job", () => {
            test("Should call calcUserSignals method 1 time", async () => {
                service.calcUserSignals = jest.fn();

                await service.process(makeJob(StatsCalcJobType.userSignals));

                expect(service.calcUserSignals).toHaveBeenCalledTimes(1);
            });
        });

        describe("On userSignalsAggr job", () => {
            test("Should call calcUserSignalsAggr method 1 time", async () => {
                service.calcUserSignalsAggr = jest.fn();

                await service.process(makeJob(StatsCalcJobType.userSignalsAggr));

                expect(service.calcUserSignalsAggr).toHaveBeenCalledTimes(1);
            });
        });

        describe("On userRobotAggr job", () => {
            test("Should call calcUserRobotsAggr method 1 time", async () => {
                service.calcUserRobotsAggr = jest.fn();

                await service.process(makeJob(StatsCalcJobType.userRobotAggr));

                expect(service.calcUserRobotsAggr).toHaveBeenCalledTimes(1);
            });
        });
    });

    describe("makeChunksGenerator method", () => {
        const service = new Service();
        const makeChunksGenerator = getProperty(service, "makeChunksGenerator").bind(service) as {
            (query: any, chunkSize: number): () => AsyncGenerator<any[], void>;
        };

        describe("Testing arguments", () => {
            describe("When chunkSize = null", () => {
                test("Should to throw error", async () => {
                    expect(() => makeChunksGenerator("", null)).toThrowError();
                });
            });

            describe("When chunkSize = 0", () => {
                test("Should to throw error", async () => {
                    expect(() => makeChunksGenerator("", 0)).toThrowError();
                });
            });

            describe("When chunkSize < 0", () => {
                test("Should to throw error", async () => {
                    expect(() => makeChunksGenerator("", -100)).toThrowError();
                });
            });

            describe("When chunkSize > 0", () => {
                test("Should not to throw error", async () => {
                    expect(() => makeChunksGenerator("", 100)).not.toThrowError();
                });
            });
        });

        describe("Testing generator", () => {
            describe("1st DB answer is empty", () => {
                test("Should done generator", async () => {
                    const size = 100;
                    const gen = makeChunksGenerator("", size)();

                    mockPG.any.mockImplementation(() => []);

                    expect(await gen.next()).toStrictEqual({ value: undefined, done: true });
                });
            });

            describe("1st DB answer is not full size", () => {
                test("Should gives 1 chunk and done generator", async () => {
                    const size = 100;
                    const gen = makeChunksGenerator("", size)();
                    const halfArr = new Array(size >> 1);

                    mockPG.any.mockImplementation(() => halfArr);

                    expect(await gen.next()).toStrictEqual({ value: halfArr, done: false });

                    expect(await gen.next()).toStrictEqual({ value: undefined, done: true });
                });
            });

            describe("Not 1st DB answer is not full size", () => {
                test("Should gives some chunks and done generator", async () => {
                    const size = 100;
                    const gen = makeChunksGenerator("", size)();
                    const arr = new Array(size);
                    const halfArr = new Array(size >> 1);

                    mockPG.any.mockImplementation(() => arr);

                    expect(await gen.next()).toStrictEqual({ value: arr, done: false });

                    expect(await gen.next()).toStrictEqual({ value: arr, done: false });

                    mockPG.any.mockImplementation(() => halfArr);

                    expect(await gen.next()).toStrictEqual({ value: halfArr, done: false });

                    expect(await gen.next()).toStrictEqual({ value: undefined, done: true });
                });
            });

            describe("Not 1st DB answer is empty", () => {
                test("Should gives some chunks and done generator", async () => {
                    const size = 100;
                    const gen = makeChunksGenerator("", size)();
                    const arr = new Array(size);

                    mockPG.any.mockImplementation(() => arr);

                    expect(await gen.next()).toStrictEqual({ value: arr, done: false });

                    expect(await gen.next()).toStrictEqual({ value: arr, done: false });

                    mockPG.any.mockImplementation(() => []);

                    expect(await gen.next()).toStrictEqual({ value: undefined, done: true });
                });
            });
        });
    });

    describe("calcStatistics method", () => {
        const service = new Service();

        service.startService();

        describe("Call method", () => {
            test("Should call queue of Pool", async () => {
                const pool = getProperty(service, "pool") as Pool<any>;

                await service.calcStatistics(StatisticsType.Simple, {} as TradeStats, [] as PositionDataForStats[]);

                expect(pool.queue).toHaveBeenCalledTimes(1);
            });
        });
    });

    testStatsCalcMethod({
        methodName: "calcRobot",
        minArgsCount: 1,
        args: ["robot-id"]
    });

    testStatsCalcMethod({
        methodName: "calcRobotsAggr",
        minArgsCount: 0,
        args: ["exchange", "asset"],
        needCheckStatsExisting: false,
        isStatsSingle: false
    });

    testStatsCalcMethod({
        methodName: "calcUsersRobotsAggr",
        minArgsCount: 0,
        args: ["exchange", "asset"],
        needCheckStatsExisting: false,
        isStatsSingle: false
    });

    testStatsCalcMethod({
        methodName: "calcUserSignal",
        minArgsCount: 2,
        args: ["user-id", "robot-id"]
    });

    testStatsCalcMethod({
        methodName: "calcUserSignals",
        minArgsCount: 1,
        args: ["robot-id"],
        needCheckStatsExisting: false,
        isStatsSingle: false
    });

    testStatsCalcMethod({
        methodName: "calcUserSignalsAggr",
        minArgsCount: 1,
        args: ["user-id", "exchange", "asset"],
        needCheckStatsExisting: false
    });

    testStatsCalcMethod({
        methodName: "calcUserRobot",
        minArgsCount: 1,
        args: ["user-robot-id"]
    });

    testStatsCalcMethod({
        methodName: "calcUserRobotsAggr",
        minArgsCount: 1,
        args: ["user-id", "exchange", "asset"],
        needCheckStatsExisting: false
    });
});
