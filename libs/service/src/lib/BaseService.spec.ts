process.env.PGCS = "localhost:5349";
import "jest-extended";
import Redis from "ioredis";
import logger from "@cryptuoso/logger";
import { sql, pg } from "@cryptuoso/postgres";
import { Events } from "@cryptuoso/events";
import { BaseService } from "./BaseService";

const ERROR_CODE = 1;
const mockExit = jest.fn();
const mockLightshipType = {
    registerShutdownHandler: jest.fn(),
    signalReady: jest.fn(),
    shutdown: jest.fn()
};
const getLastRegisterShutdownHandler = () => {
    const calls = mockLightshipType.registerShutdownHandler.mock.calls;
    return calls[calls.length - 1][0];
};
const setProperty = (object: any, property: any, value: any) => {
    const originalProperty = Object.getOwnPropertyDescriptor(object, property);
    Object.defineProperty(object, property, { value });
    return originalProperty;
};

setProperty(process, "exit", mockExit);
setProperty(console, "error", jest.fn());
jest.mock("lightship", () => {
    return {
        LightshipType: jest.fn().mockImplementation(() => {
            return mockLightshipType;
        }),
        createLightship: jest.fn().mockImplementation(() => {
            return mockLightshipType;
        })
    };
});
jest.mock("ioredis");
jest.mock("@cryptuoso/logger");
jest.mock("@cryptuoso/postgres");
jest.mock("@cryptuoso/events");

describe("Test 'BaseService' class", () => {
    describe("Test constructor", () => {
        describe("Test constructor with argument", () => {
            const config = { name: "my_name" };
            const baseService = new BaseService(config);

            describe("Testing sql property", () => {
                it("Should be type of sql", () => {
                    expect(typeof baseService.db.sql).toStrictEqual(typeof sql);
                });
            });

            describe("Testing log property", () => {
                it("Should be type of logger", () => {
                    expect(typeof baseService.log).toStrictEqual(typeof logger);
                });
            });

            describe("Testing redis property", () => {
                it("Should be type of Redis", () => {
                    expect(baseService.redis instanceof Redis).toStrictEqual(true);
                });
            });

            describe("Testing events property", () => {
                it("Should be type of events", () => {
                    expect(baseService.events instanceof Events).toStrictEqual(true);
                });
            });

            describe("Testing name property", () => {
                it(`Should be equals to ${config.name}`, () => {
                    expect(baseService.name).toStrictEqual(config.name);
                });
            });
        });

        describe("Test constructor with argument and LightshipType.registerShutdownHandler calls count is 1", () => {
            it("Should call 'createLightship.registerShutdownHandler' 1 time", () => {
                const config = { name: "my_name" };

                jest.clearAllMocks();
                new BaseService(config);

                expect(mockLightshipType.registerShutdownHandler).toHaveBeenCalledTimes(1);
            });
        });

        describe("Test constructor w/o argument", () => {
            process.env.SERVICE = "my_service";
            const baseService = new BaseService();

            describe("Testing name property", () => {
                it("Should be equals to process.env.SERVICE", () => {
                    expect(baseService.name).toStrictEqual(process.env.SERVICE);
                });
            });
        });

        describe("Test constructor with null passed", () => {
            process.env.SERVICE = "my_service";
            const baseService = new BaseService(null);

            describe("Testing name property", () => {
                it("Should be equals to process.env.SERVICE", () => {
                    expect(baseService.name).toStrictEqual(process.env.SERVICE);
                });
            });
        });
    });

    describe("Test methods", () => {
        describe("Testing startService", () => {
            test("Testing mockLightshipType.signalReady calls count is 1", async () => {
                const baseService = new BaseService();
                const methodStopService = getLastRegisterShutdownHandler();

                mockLightshipType.signalReady.mockClear();

                await baseService.startService();

                expect(mockLightshipType.signalReady).toHaveBeenCalledTimes(1);
                await methodStopService();
            });
        });

        describe("Testing outer errors", () => {
            test("Testing Logger.error calls count is 1 by uncaughtException", async () => {
                const baseService = new BaseService();
                const proto = Object.getPrototypeOf(baseService);

                jest.clearAllMocks();

                try {
                    new Error("Mock error");
                } catch (error) {
                    expect(proto["#handleUncaughtException"]).toHaveBeenCalledTimes(1);
                }
            });
        });

        describe("Testing outer errors", () => {
            test("Testing Logger.error calls count is 1 by unhandledRejection", async () => {
                const baseService = new BaseService();
                const proto = Object.getPrototypeOf(baseService);

                jest.clearAllMocks();

                try {
                    Promise.reject(new Error("Mock error"));
                } catch (error) {
                    expect(proto["#handleUnhandledRejection"]).toHaveBeenCalledTimes(1);
                }
            });
        });

        describe("Test addOnStartHandler method", () => {
            test("Testing just one handler", async () => {
                const baseService = new BaseService();
                const f = jest.fn();

                baseService.addOnStartHandler(f);

                await baseService.startService();

                expect(f).toHaveBeenCalledTimes(1);
            });

            test("Testing several handlers right order", async () => {
                const baseService = new BaseService();
                const fs: jest.Mock[] = new Array(10);

                for (let i = 0; i < fs.length; ++i) {
                    fs[i] = jest.fn();
                    await baseService.addOnStartHandler(fs[i]);
                }

                await baseService.startService();

                for (let i = 1; i < fs.length; ++i) expect(fs[i]).toHaveBeenCalledAfter(fs[i - 1]);
            });

            test("Testing with error throwing", async () => {
                const baseService = new BaseService();

                jest.clearAllMocks();

                baseService.addOnStartHandler(() => {
                    throw new Error("Mock error");
                });

                await baseService.startService().catch(jest.fn());

                expect(mockExit).toHaveBeenCalledWith(ERROR_CODE);
            });
        });

        describe("Test addOnStopHandler method", () => {
            test("Testing just one handler", async () => {
                const baseService = new BaseService();
                const methodStopService = getLastRegisterShutdownHandler();
                const f = jest.fn();

                baseService.addOnStopHandler(f);

                await methodStopService();

                expect(f).toHaveBeenCalledTimes(1);
            });

            test("Testing several handlers right order", async () => {
                const baseService = new BaseService();
                const methodStopService = getLastRegisterShutdownHandler();
                const fs: jest.Mock[] = new Array(10);

                for (let i = 0; i < fs.length; ++i) {
                    fs[i] = jest.fn();
                    await baseService.addOnStopHandler(fs[i]);
                }

                await methodStopService();

                for (let i = 1; i < fs.length; ++i) expect(fs[i]).toHaveBeenCalledAfter(fs[i - 1]);
            });

            test("Testing with error throwing", async () => {
                const baseService = new BaseService();
                const methodStopService = getLastRegisterShutdownHandler();

                jest.clearAllMocks();

                baseService.addOnStopHandler(() => {
                    throw new Error("error");
                });

                await methodStopService().catch(jest.fn());

                expect(mockExit).toHaveBeenCalledWith(ERROR_CODE);
            });
        });
    });

    describe("Testing stopService method", () => {
        describe("Testing stopService called after startService", () => {
            test("Testing sql.end calls count is 1", async () => {
                const baseService = new BaseService();
                const methodStopService = getLastRegisterShutdownHandler();

                jest.clearAllMocks();

                await baseService.startService();
                await methodStopService();

                expect(pg.end).toHaveBeenCalledTimes(1);
            });

            /* test("Testing mockLightshipType.shutdown calls count is 1", async () => {
                const baseService = new BaseService();
                const methodStopService = getLastRegisterShutdownHandler();
        
                await baseService.startService();
                jest.clearAllMocks();
                await methodStopService();

                expect(mockLightshipType.shutdown).toHaveBeenCalledTimes(1);
            }); */

            test("Testing Redis.quit calls count is 1", async () => {
                const baseService = new BaseService();
                const methodStopService = getLastRegisterShutdownHandler();

                await baseService.startService();
                jest.clearAllMocks();
                await methodStopService();

                expect(baseService.redis.quit).toHaveBeenCalledTimes(1);
            });
        });

        describe("Testing stopService called w/o startService calling", () => {
            test("Testing success ending stopService", async () => {
                new BaseService();
                const methodStopService = getLastRegisterShutdownHandler();

                expect(await methodStopService().then(() => "success")).toStrictEqual("success");
            });
        });

        describe("Testing startService after stopService calling", () => {
            test("Testing success start", async () => {
                const baseService = new BaseService();
                const methodStopService = getLastRegisterShutdownHandler();

                await baseService.startService();
                await methodStopService();

                expect(await baseService.startService().then(() => "success")).toStrictEqual("success");
            });
        });

        describe("Testing startService at the new class instance after stopService calling at the old one", () => {
            test("Testing success start of the new class instance", async () => {
                const baseService = new BaseService();
                const methodStopService = getLastRegisterShutdownHandler();

                await baseService.startService();
                await methodStopService();

                const baseService2 = new BaseService();

                expect(await baseService2.startService().then(() => "success")).toStrictEqual("success");
            });
        });
    });
});
