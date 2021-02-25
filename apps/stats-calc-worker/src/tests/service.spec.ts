import Service, { getCalcFromAndInitStats } from "../app/service";
import { TradeStats, TradeStatsClass, checkTradeStats } from "@cryptuoso/stats-calc";
import dayjs from "@cryptuoso/dayjs";
import { pg } from "@cryptuoso/postgres";
import { setProperty, getProperty } from "@cryptuoso/test-helpers";
import { StatsCalcJobType, StatsCalcJob } from "@cryptuoso/stats-calc-events";
import { Job } from "bullmq";
import { Pool } from "threads";
import { BasePosition } from "@cryptuoso/market";
import { v4 as uuid } from "uuid";

const mockPG = {
    any: pg.any as jest.Mock,
    maybeOne: pg.maybeOne as jest.Mock,
    oneFirst: pg.oneFirst as jest.Mock,
    query: pg.query as jest.Mock
};

const mockExit = jest.fn();

setProperty(process, "exit", mockExit);

jest.mock("slonik", () => ({
    createTypeParserPreset: jest.fn(() => []),
    createPool: jest.fn(() => {
        return {
            maybeOne: jest.fn(),
            any: jest.fn(),
            oneFirst: jest.fn(),
            query: jest.fn()
        };
    }),
    sql: jest.fn()
}));

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

            makeLocker() {
                return {
                    lock: jest.fn(),
                    unlock: jest.fn()
                };
            }

            async startService() {
                if (this.#onStartHandler) await this.#onStartHandler();
            }

            async stopService() {
                if (this.#onStopHandler) await this.#onStopHandler();
            }

            createWorker = jest.fn();
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
jest.mock("@cryptuoso/logger");
//jest.mock("@cryptuoso/postgres");
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

            expect(checkTradeStats(initStats)).toBeTruthy();

            expect(initStats.equity).toStrictEqual(rightStats.equity);
            expect(initStats.equityAvg).toStrictEqual(rightStats.equityAvg);
            expect(initStats.firstPositionEntryDate).toStrictEqual(rightStats.firstPositionEntryDate);
            expect(initStats.lastPositionExitDate).toStrictEqual(rightStats.lastPositionExitDate);
            expect(initStats.lastUpdatedAt).toStrictEqual(rightStats.lastUpdatedAt);
            expect(initStats.statistics).toStrictEqual(rightStats.statistics);
        });
    });
});

async function combineArgs(
    args: { [key: string]: any },
    callback: { (currentArgs: typeof args, currentArgsNames: string[]): any },
    provideAll = false
) {
    const argsNames = Object.keys(args);

    let cnt = argsNames.length ** 2;

    if (!provideAll) --cnt;

    for (let i = 0; i < cnt; ++i) {
        const currentArgs: typeof args = {};
        const currentArgsNames = [];

        for (let j = 0; j < argsNames.length; ++j) {
            if ((i >> j) % 2) {
                currentArgs[argsNames[j]] = args[argsNames[j]];
                currentArgsNames.push(argsNames[j]);
            }
        }

        await callback(currentArgs, currentArgsNames);
    }
}

function testStatsCalcMethod({
    methodName,
    jobType,
    baseArgs,
    addArgs,
    needCheckStatsExisting = true,
    isStatsSingle = true
}: {
    methodName: string;
    jobType: StatsCalcJobType;
    baseArgs: { [key: string]: any };
    addArgs?: { [key: string]: any };
    needCheckStatsExisting?: boolean;
    isStatsSingle?: boolean;
}) {
    describe(`${methodName} method`, () => {
        const service = new Service();
        const mockUpsertStats = jest.fn();

        service.calcStatistics = jest.fn();
        setProperty(service, "upsertStats", mockUpsertStats);

        let func: { (...args: any[]): Promise<boolean> } = getProperty(service, methodName);
        func = func.bind(service);

        describe("With combine nulls arguments", () => {
            test("Should to throw errors", async () => {
                await combineArgs(baseArgs, async (currentArgs, currentArgsNames) => {
                    await expect(service.process(makeJob(jobType, currentArgs)))
                        .rejects.toThrowError()
                        .catch(() => {
                            throw new Error(`${currentArgsNames.join(", ")} args with nulls provided`);
                        });
                });
            });
        });

        describe("Base args provided", () => {
            test("Should call need method", async () => {
                const service2 = new Service();

                const routes = getProperty(service2, "routes");

                routes[jobType].handler = jest.fn();

                await service2.process(makeJob(jobType, baseArgs));

                expect(routes[jobType].handler).toHaveBeenCalled();
            });
        });

        if (addArgs) {
            describe("Base and addidional args provided", () => {
                test("Should call need method", async () => {
                    const service2 = new Service();

                    const routes = getProperty(service2, "routes");

                    routes[jobType].handler = jest.fn();

                    await service2.process(makeJob(jobType, { ...baseArgs, ...addArgs }));

                    expect(routes[jobType].handler).toHaveBeenCalled();
                });
            });
        }

        if (needCheckStatsExisting) {
            describe(`Base args} provided but is wrong`, () => {
                test("Should to throw error", async () => {
                    if (isStatsSingle) mockPG.maybeOne.mockImplementation(async () => null);
                    else mockPG.any.mockImplementation(async () => []);

                    await expect(func(baseArgs)).rejects.toThrowError();
                });
            });
        }

        describe(`Base args provided but positions not exists`, () => {
            test("Should to throw error", async () => {
                if (isStatsSingle) mockPG.maybeOne.mockImplementation(async () => ({}));
                else mockPG.any.mockImplementationOnce(async () => [{}]);

                mockPG.oneFirst.mockImplementation(async () => 0);
                await expect(func(baseArgs)).resolves.toStrictEqual(false);
            });
        });

        describe(`Base args provided and positions exists`, () => {
            test("Should to call upsertStats", async () => {
                if (isStatsSingle) mockPG.maybeOne.mockImplementation(async () => ({}));
                else mockPG.any.mockImplementationOnce(async () => [{}]);

                mockPG.oneFirst.mockImplementation(async () => service.defaultChunkSize);
                mockPG.any.mockImplementation(async () => [{}]);

                mockUpsertStats.mockClear();

                await func(baseArgs);

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

                await service.calcStatistics({} as TradeStats, [] as BasePosition[]);

                expect(pool.queue).toHaveBeenCalledTimes(1);
            });
        });
    });

    testStatsCalcMethod({
        methodName: "calcRobot",
        jobType: StatsCalcJobType.robot,
        baseArgs: { robotId: uuid() }
    });

    testStatsCalcMethod({
        methodName: "calcRobotsAggr",
        jobType: StatsCalcJobType.robotsAggr,
        baseArgs: {},
        addArgs: { exchange: "exchange", asset: "asset" },
        needCheckStatsExisting: false,
        isStatsSingle: false
    });

    testStatsCalcMethod({
        methodName: "calcUsersRobotsAggr",
        jobType: StatsCalcJobType.usersRobotsAggr,
        baseArgs: {},
        addArgs: { exchange: "exchange", asset: "asset" },
        needCheckStatsExisting: false,
        isStatsSingle: false
    });

    testStatsCalcMethod({
        methodName: "calcUserSignal",
        jobType: StatsCalcJobType.userSignal,
        baseArgs: { userId: uuid(), robotId: uuid() }
    });

    testStatsCalcMethod({
        methodName: "calcUserSignals",
        jobType: StatsCalcJobType.userSignals,
        baseArgs: { robotId: uuid() },
        needCheckStatsExisting: false,
        isStatsSingle: false
    });

    testStatsCalcMethod({
        methodName: "calcUserSignalsAggr",
        jobType: StatsCalcJobType.userSignalsAggr,
        baseArgs: { userId: uuid() },
        addArgs: { exchange: "exchange", asset: "asset" },
        needCheckStatsExisting: false
    });

    testStatsCalcMethod({
        methodName: "calcUserRobot",
        jobType: StatsCalcJobType.userRobot,
        baseArgs: { userRobotId: uuid() }
    });

    testStatsCalcMethod({
        methodName: "calcUserRobotsAggr",
        jobType: StatsCalcJobType.userRobotAggr,
        baseArgs: { userId: uuid() },
        addArgs: { exchange: "exchange", asset: "asset" },
        needCheckStatsExisting: false
    });
});
