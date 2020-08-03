import { createLightship, LightshipType } from "lightship";
import Redis from "ioredis";
import logger, { Logger } from "@cryptuoso/logger";
import { sql } from "@cryptuoso/postgres";
import { Events } from "@cryptuoso/events";

const setProperty = (object: any, property: any, value: any) => {
    const originalProperty = Object.getOwnPropertyDescriptor(object, property)
    Object.defineProperty(object, property, { value })
    return originalProperty
}

const mockExit = jest.fn()
setProperty(process, 'exit', mockExit);
const ERROR_CODE = 1;

const mockLightshipType = {
    registerShutdownHandler: jest.fn(),
    signalReady: jest.fn(),
    shutdown: jest.fn()
};
jest.mock('lightship', () => {
    return {
        LightshipType: jest.fn().mockImplementation(() => {
            return mockLightshipType;
        }),
        createLightship: jest.fn().mockImplementation(() => {
            return mockLightshipType;
        })
    };
});
jest.mock('ioredis');
jest.mock('@cryptuoso/logger');
jest.mock('@cryptuoso/postgres');
jest.mock('@cryptuoso/events');

import {BaseService, BaseServiceConfig} from "./BaseService";

describe("Test 'BaseService' class", () => {
    describe("Test constructor", () => {
        describe("Test constructor with argument", () => {
            const config = { name: "my_name" };
            const baseService = new BaseService(config);
            
            /* it("Should call 'createLightship' 1 time", () => {
                expect(createLightship).toHaveBeenCalledTimes(1);
            });

            it("Should call 'Redis' 1 time", () => {
                expect(Redis).toHaveBeenCalledTimes(1);
            });
            
            it("Should call 'Events' 1 time", () => {
                expect(Events).toHaveBeenCalledTimes(1);
            });
            
            it("Should call 'createLightship.registerShutdownHandler' 1 time", () => {
                expect(mockLightshipType.registerShutdownHandler).toHaveBeenCalledTimes(1);
            }); */

            describe("Testing sql property", () => {
                it("Should be type of sql", () => {
                    expect(typeof baseService.sql).toStrictEqual(typeof sql);
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
                const baseService = new BaseService(config);

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

                mockLightshipType.signalReady.mockClear();
        
                await baseService.startService();
                
                expect(mockLightshipType.signalReady).toHaveBeenCalledTimes(1);
                await baseService.stopService();
            });

            test("Testing Logger.info calls count is 2", async () => {
                const baseService = new BaseService();

                jest.clearAllMocks();
        
                await baseService.startService();

                expect(logger.info).toHaveBeenCalledTimes(2);
                await baseService.stopService();
            });
        });

        describe("Testing outer errors", () => {
            test("Testing Logger.error calls count is 1 by unhandledRejection", async () => {
                const baseService = new BaseService();

                jest.clearAllMocks();

                try {
                    Promise.reject(new Error('mock error'));
                } catch(error) {
                    expect(logger.error).toHaveBeenCalledTimes(1);
                }
            });
        });

        describe("Testing outer errors", () => {
            test("Testing Logger.error calls count is 1 by uncaughtException", async () => {
                const baseService = new BaseService();

                jest.clearAllMocks();

                try {
                    new Error('mock error');
                } catch(error) {
                    expect(logger.error).toHaveBeenCalledTimes(1);
                }
            });
        });

        describe("Testing addOnStartHandler", () => {
            test("Testing w/o error throwing", async () => {
                const baseService = new BaseService();
                const f = jest.fn();
                
                baseService.addOnStartHandler(f);

                await baseService.startService();

                expect(f).toHaveBeenCalledTimes(1);
            });

            test("Testing with error throwing", async () => {
                const baseService = new BaseService();

                jest.clearAllMocks();
                
                baseService.addOnStartHandler(() => {
                    throw new Error("error");
                });

                await baseService.startService().catch(e => {});

                expect(mockExit).toHaveBeenCalledWith(ERROR_CODE);
            });
        });

        describe("Testing addOnStopHandler", () => {
            test("Testing w/o error throwing", async () => {
                const baseService = new BaseService();
                const f = jest.fn();
                
                baseService.addOnStopHandler(f);

                await baseService.stopService();

                expect(f).toHaveBeenCalledTimes(1);
            });

            test("Testing with error throwing", async () => {
                const baseService = new BaseService();

                jest.clearAllMocks();
                
                baseService.addOnStopHandler(() => {
                    throw new Error("error");
                });

                await baseService.stopService().catch(e => {});

                expect(mockExit).toHaveBeenCalledWith(ERROR_CODE);
            });
        });
    });

    

    describe("Testing stopService method", () => {
        describe("Testing stopService called after startService", () => {
            test("Testing sql.end calls count is 1", async () => {
                const baseService = new BaseService();
                
                jest.clearAllMocks();
        
                await baseService.startService();
                await baseService.stopService();
                
                expect(sql.end).toHaveBeenCalledTimes(1);
            });

            test("Testing Logger.info calls count is 1", async () => {
                const baseService = new BaseService();
        
                await baseService.startService();
                jest.clearAllMocks();
                await baseService.stopService();

                expect(logger.info).toHaveBeenCalledTimes(1);
            });

            test("Testing mockLightshipType.shutdown calls count is 1", async () => {
                const baseService = new BaseService();
        
                await baseService.startService();
                jest.clearAllMocks();
                await baseService.stopService();

                expect(mockLightshipType.shutdown).toHaveBeenCalledTimes(1);
            });

            test("Testing Redis.shutdown calls count is 1", async () => {
                const baseService = new BaseService();
        
                await baseService.startService();
                jest.clearAllMocks();
                await baseService.stopService();

                expect(baseService.redis.shutdown).toHaveBeenCalledTimes(1);
            });
        });

        describe("Testing stopService called w/o startService calling", () => {
            test("Testing success ending stopService", async () => {
                const baseService = new BaseService();
                
                expect(await baseService.stopService().then(() => "success")).toStrictEqual("success");
            });
        });

        describe("Testing startService after stopService calling", () => {
            test("Testing success start", async () => {
                const baseService = new BaseService();
                
                await baseService.startService();
                await baseService.stopService();
                
                expect(await baseService.startService().then(() => "success")).toStrictEqual("success");
            });
        });

        describe("Testing startService at the new class instance after stopService calling at the old one", () => {
            test("Testing success start of the new class instance", async () => {
                const baseService = new BaseService();
                
                await baseService.startService();
                await baseService.stopService();

                const baseService2 = new BaseService();
                
                expect(await baseService2.startService().then(() => "success")).toStrictEqual("success");
            });
        });
    });
});
