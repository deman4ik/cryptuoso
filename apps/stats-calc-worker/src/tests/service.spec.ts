import Service, { StatisticCalcWorkerServiceConfig, getCalcFromAndInitStats } from "../app/service";
import { RobotStats, isRobotStats, PositionDataForStats } from "@cryptuoso/trade-statistics";
import {
    UserSignalPosition,
    UserAggrStatsType,
    RobotStatsWithExists,
    UserSignalsWithExists
} from "@cryptuoso/user-state";
import dayjs from "@cryptuoso/dayjs";
import { pg } from "@cryptuoso/postgres";
import { setProperty, getProperty } from "@cryptuoso/test-helpers";
import { StatsCalcJobType, StatsCalcJob } from "@cryptuoso/stats-calc-events";
import { Job } from "bullmq";
import { Pool } from "threads";

const mockPG = {
    any: pg.any as jest.Mock,
    maybeOne: pg.maybeOne as jest.Mock,
    oneFirst: pg.oneFirst as jest.Mock,
    query: pg.query as jest.Mock
};

const mockExit = jest.fn();

function getLastCallArg(fn: any): fn is jest.Mock {
    const calls = fn.mock.calls;
    return calls[calls.length - 1][0];
}

function makeJob(name: string, data: StatsCalcJob = {}) {
    return { name, data } as Job<StatsCalcJob>;
}

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
jest.mock("@cryptuoso/logger");
jest.mock("@cryptuoso/postgres");
jest.mock("@cryptuoso/events");
jest.mock("@cryptuoso/mail");

describe("getCalcFromAndInitStats function", () => {
    const emptyRobotStats = new RobotStats();
    const robotStatsWithLastPosDate = new RobotStats();

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
            const wrongStats = {} as RobotStats;
            const { calcFrom, initStats } = getCalcFromAndInitStats(wrongStats, null);

            expect(calcFrom).toStrictEqual(null);
            expect(initStats).toStrictEqual(null);
        });
    });

    describe("stats is wrong with `statsExists` property, calcAll = null", () => {
        test("Should returns nulls", () => {
            const wrongStats = {} as RobotStatsWithExists;
            wrongStats.statsExists = "id";
            const { calcFrom, initStats } = getCalcFromAndInitStats(wrongStats, null);

            expect(calcFrom).toStrictEqual(null);
            expect(initStats).toStrictEqual(null);
        });
    });

    describe("stats is right w/o `statsExists` property, calcAll = false", () => {
        test("Should returns nulls", () => {
            const { calcFrom, initStats } = getCalcFromAndInitStats(robotStatsWithLastPosDate, false);

            expect(calcFrom).toStrictEqual(null);
            expect(initStats).toStrictEqual(null);
        });
    });

    describe("stats is right with `statsExists` property, calcAll = true", () => {
        test("Should returns nulls", () => {
            const rightStats: RobotStatsWithExists = { ...robotStatsWithLastPosDate, statsExists: "id" };
            const { calcFrom, initStats } = getCalcFromAndInitStats(rightStats, true);

            expect(calcFrom).toStrictEqual(null);
            expect(initStats).toStrictEqual(null);
        });
    });

    describe("stats is right with `statsExists` property, calcAll = false", () => {
        test("Should returns right calcFrom date and initStats typeof RobotStats", () => {
            const rightStats: RobotStatsWithExists = { ...robotStatsWithLastPosDate, statsExists: "id" };
            const { calcFrom, initStats } = getCalcFromAndInitStats(rightStats, false);

            expect(calcFrom).toStrictEqual(rightStats.lastPositionExitDate);

            expect(isRobotStats(initStats)).toBeTruthy();

            expect(initStats.equity).toStrictEqual(rightStats.equity);
            expect(initStats.equityAvg).toStrictEqual(rightStats.equityAvg);
            expect(initStats.lastPositionExitDate).toStrictEqual(rightStats.lastPositionExitDate);
            expect(initStats.lastUpdatedAt).toStrictEqual(rightStats.lastUpdatedAt);
            expect(initStats.statistics).toStrictEqual(rightStats.statistics);
        });
    });
});

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

                await service.calcStatistics({} as RobotStats, [] as PositionDataForStats[]);

                expect(pool.queue).toHaveBeenCalledTimes(1);
            });
        });
    });

    testMethod("calcRobot", 1, ["robot-id"]);

    testMethod("calcUserSignal", 2, ["user-id", "robot-id"]);

    testMethod("calcUserSignals", 1, ["robot-id"]);

    testMethod("calcUserSignalsAggr", 1, ["user-id", "exchange", "asset"]);

    testMethod("calcUserRobot", 1, ["user-robot-id"]);

    testMethod("calcUserRobotsAggr", 1, ["user-id", "exchange", "asset"]);
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

function combineArgs(
    args: any[], argsNames: string[], minArgsCount: number,
    callback: { (currentArgs: any[], currentArgsNames: string[]): any },
    provideAll = false, defultValue: any = null
) {
    const cnt = minArgsCount ** 2 + Number(provideAll);

    for (let i = 0; i < cnt; ++i) {
        const currentArgs = new Array(args.length).fill(defultValue);
        const currentArgsNames = [];

        for(let j=0; j < minArgsCount; ++j) {
            if((i >> j) % 2) {
                currentArgs[j] = args[j];
                currentArgsNames.push(argsNames[j]);
            }
        }
        
        callback(currentArgs, currentArgsNames);
    }
}

function testMethod(methodName: string, minArgsCount: number, args: any[]) {
    describe(`${methodName} method`, () => {
        const service = new Service();
        const mockUpsertStats = jest.fn();

        service.calcStatistics = jest.fn();
        setProperty(service, "upsertStats", mockUpsertStats);

        let func: { (...args: any[]): Promise<boolean> } = getProperty(service, methodName);
        const argsNames = getParams(func);
        func = func.bind(service);

        const nullArgs = new Array(args.length);
        const undefinedArgs = new Array(args.length);

        for (let i = 0; i <= args.length; ++i) {
            nullArgs[i] = new Array(args.length).fill(null);
            undefinedArgs[i] = new Array(args.length).fill(undefined);

            for (let j = 0; j < i; ++j) {
                nullArgs[i][j] = args[j];
                undefinedArgs[i][j] = args[j];
            }
        }

        describe("with undefined arguments provided", () => {
            test("Should to throw error", async () => {
                expect(func(...undefinedArgs[0])).rejects.toThrowError();
            });
        });
        
        combineArgs(
            args, argsNames, minArgsCount,
            (currentArgs, currentArgsNames) => {
                describe(`${currentArgsNames.join(", ")} args with nulls provided`, () => {
                    test("Should to throw error", () => {
                        expect(func(...currentArgs)).rejects.toThrowError();
                    });
                });
            }
        );

        describe(`${argsNames.slice(0, minArgsCount).join(", ")} provided but is wrong`, () => {
            test("Should to throw error", async () => {
                mockPG.maybeOne.mockImplementation(async () => null);
                expect(func(...nullArgs[minArgsCount])).rejects.toThrowError();
            });
        });

        describe(`${argsNames.slice(0, minArgsCount).join(", ")} provided but positions not exists`, () => {
            test("Should to throw error", async () => {
                mockPG.maybeOne.mockImplementation(async () => ({}));
                mockPG.oneFirst.mockImplementation(async () => 0);
                expect(func(...nullArgs[minArgsCount])).resolves.toStrictEqual(false);
            });
        });

        describe(`${argsNames.slice(0, minArgsCount).join(", ")} provided but positions exists`, () => {
            test("Should to call upsertStats", async () => {
                mockPG.maybeOne.mockImplementation(async () => ({}));
                mockPG.oneFirst.mockImplementation(async () => service.defaultChunkSize);
                mockPG.any.mockImplementation(async () => [{}]);

                mockUpsertStats.mockImplementation(async () => {
                    console.warn("upsertStats", methodName);
                });
                mockUpsertStats.mockClear();

                console.log(await func(...nullArgs[minArgsCount]));
                expect(mockUpsertStats).toHaveBeenCalledTimes(1);
            });
        });
    });
}
