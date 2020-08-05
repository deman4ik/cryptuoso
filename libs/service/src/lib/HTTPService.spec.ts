process.env.PGCS = "localhost:5349";

//import restana, { Service, Protocol, Request, Response, RequestHandler } from "restana";
import restana, { Service, Method, Protocol, Request, Response, RequestHandler } from "./my_restana";
import { BaseService, BaseServiceConfig } from "./BaseService";
import { HTTPService, HTTPServiceConfig, ActionPayload } from "./HTTPService";
import bodyParser from 'body-parser';
import helmet from 'helmet';
import MyService from './my-restana-service';
import { ForeignKeyIntegrityConstraintViolationError } from 'slonik';


var funcNext = (
    req: Request<Protocol.HTTP>,
    res: Response<Protocol.HTTP>,
    next: (error?: unknown) => void
) => {
    next();
};

jest.mock("body-parser", () => ({
    json: () => funcNext
}));

jest.mock("helmet", () => () => funcNext);

jest.mock("restana", () => restana);


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
const getProperty = (obj: any, prop: string) => {
    return obj[prop];
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

function getServerFromService(service: HTTPService): MyService<Protocol.HTTP> {
    return getProperty(service, "_server");
}

describe("Test 'BaseService' class", () => {
    process.env.API_KEY = "my_api_key";
    const CONFIG: HTTPServiceConfig = { port: 4000 };

    describe("Testing constructor", () => {
        describe("Test with valid input", () => {
            describe("Test with right config provided", () => {
                it("Should initialize correctly and doesn't call process.exit", () => {
                    const httpService = new HTTPService(CONFIG);
                    const app = getServerFromService(httpService);

                    expect(app._mockConstuctor).toHaveBeenCalledTimes(1);
                    expect(mockExit).toHaveBeenCalledTimes(0);
                });
                
                test("Should initialize correctly and app.port must equals to CONFIG.port", async () => {
                    const httpService = new HTTPService(CONFIG);
                    const app = getServerFromService(httpService);

                    await httpService.startService();

                    expect(app._port).toStrictEqual(CONFIG.port);
                });
            });

            describe("Test w/o config", () => {
                it("Should initialize correctly and doesn't call process.exit", () => {
                    const httpService = new HTTPService();
                    const app = getServerFromService(httpService);

                    expect(app._mockConstuctor).toHaveBeenCalledTimes(1);
                    expect(mockExit).toHaveBeenCalledTimes(0);
                });
                
                test("Should initialize correctly and app.port must equals to 3000", async () => {
                    const httpService = new HTTPService();
                    const app = getServerFromService(httpService);

                    await httpService.startService();

                    expect(app._port).toStrictEqual(3000);
                });
            });
        });

        
        describe("Test with invalid input", () => {
            describe("Test with null provided", () => {
                it("Should initialize correctly and doesn't call process.exit", () => {
                    const httpService = new HTTPService(null);
                    const app = getServerFromService(httpService);

                    expect(app._mockConstuctor).toHaveBeenCalledTimes(1);
                    expect(mockExit).toHaveBeenCalledTimes(0);
                });
            });
        });
    });

        
    describe("Testing methods", () => {
        describe("Test _stopServer calling before _startServer", () => {
            test("Should not call process.exit", async () => {
                new HTTPService();
                const shutdownHandler = getLastRegisterShutdownHandler();

                await shutdownHandler();

                expect(mockExit).toHaveBeenCalledTimes(0);
            });
        });


        describe("Testing _checkApiKey method", () => {
            describe("With right requests", () => {
                test("Should call Response.send with right args", async () => {
                    const httpService = new HTTPService();
                    const shutdownHandler = getLastRegisterShutdownHandler();
                    const app = getServerFromService(httpService);
        
                    await httpService.startService();
        
                    const result = await app._passRequest(
                        {
                            url: "/", headers: {
                                "x-api-key": process.env.API_KEY
                            }
                        },
                        Method.GET
                    );
        
                    shutdownHandler();

                    //expect(app._mockErrorHandler).toHaveBeenCalledTimes(0);
                    expect(result.res.send.mock.calls[0][0]).toEqual({ service: process.env.SERVICE, routes: app.routes() });
                });
            });
            
            describe("With wrong requests", () => {
                describe("With wrong 'x-api-key'", () => {
                    test("Should call _errorHandler method", async () => {
                        const httpService = new HTTPService();
                        const shutdownHandler = getLastRegisterShutdownHandler();
                        const app = getServerFromService(httpService);
            
                        await httpService.startService();
            
                        await app._passRequest(
                            {
                                url: "/", headers: {
                                    "x-api-key": "wrong_key"
                                }
                            },
                            Method.GET
                        );
            
                        shutdownHandler();

                        expect(app._mockErrorHandler).toHaveBeenCalledTimes(1);
                    });
                });
                
                describe("w/o 'x-api-key'", () => {
                    test("Should call _errorHandler method", async () => {
                        const httpService = new HTTPService();
                        const shutdownHandler = getLastRegisterShutdownHandler();
                        const app = getServerFromService(httpService);
            
                        await httpService.startService();
            
                        await app._passRequest(
                            {
                                url: "/"
                            },
                            Method.GET
                        );
            
                        shutdownHandler();

                        expect(app._mockErrorHandler).toHaveBeenCalledTimes(1);
                    });
                });
            });
        });
        

        describe("Testing _checkValidation method", () => {
            describe("With right requests", () => {
                test("Should call _checkAuth method", async () => {
                    const httpService = new HTTPService();
                    const shutdownHandler = getLastRegisterShutdownHandler();
                    const app = getServerFromService(httpService);

                    httpService.createRoutes({
                        "my": {
                            handler: async (req, res) => { },
                            roles: ["my-role"],
                            auth: true
                        }
                    })
        
                    await httpService.startService();
        
                    const result = await app._passRequest(
                        {
                            url: "/actions/my", headers: {
                                "x-api-key": process.env.API_KEY
                            },
                            body: {
                                action: { name: "my" },
                                input: { /* action: { name: "my" }, input: {  }, session_variables: { "x-hasura-role": "my-role" }  */},
                                session_variables: { "x-hasura-role": "my-role", "x-hasura-user-id": "id"}
                            }
                        },
                        Method.POST
                    );
        
                    shutdownHandler();
                    
                    console.log(result);
                    //console.warn(app._mockErrorHandler.mock.calls[0]);

                    expect(app._mockErrorHandler).toHaveBeenCalledTimes(0);
                    //expect(result.res.send.mock.calls[0][0]).toEqual({ service: process.env.SERVICE, routes: app.routes() });
                });
            });
        });
    });


    describe("", () => {
        test("Must return code 200 and Content-Type: json", async () => {
            const httpService = new HTTPService();
            const shutdownHandler = getLastRegisterShutdownHandler();
            const app = getServerFromService(httpService);

            await httpService.startService();

            shutdownHandler();

            expect(app._mockStart).toHaveBeenCalledTimes(1);
        });
        
        test("Must return code 200 and Content-Type: json", async () => {
            const httpService = new HTTPService();
            const shutdownHandler = getLastRegisterShutdownHandler();
            const app = getServerFromService(httpService);

            await httpService.startService();

            const result = await app._passRequest(
                {
                    url: "/", headers: {
                        "x-api-key": process.env.API_KEY
                    }
                },
                Method.GET
            );

            shutdownHandler();

            expect(result.res.send).toHaveBeenCalledTimes(1);
            expect(result.res.end).toHaveBeenCalledTimes(1);

            expect(app._mockStart).toHaveBeenCalledTimes(1);
            expect(app._mockClose).toHaveBeenCalledTimes(1);
        });
        
        test("Must return code 200 and Content-Type: json", async () => {
            const httpService = new HTTPService();
            const shutdownHandler = getLastRegisterShutdownHandler();
            const app = getServerFromService(httpService);

            //console.log(app._errorHandler, app._middlewares, app._routes);

            await httpService.startService();

            const result = await app._passRequest(
                {
                    url: "/", headers: {
                        "x-api-key": "not right"
                    }
                },
                Method.GET
            );

            shutdownHandler();
            
            expect(app._mockErrorHandler).toHaveBeenCalledTimes(1);
        });
        
        test("Must return code 200 and Content-Type: json", async () => {
            const httpService = new HTTPService();
            const shutdownHandler = getLastRegisterShutdownHandler();
            const app = getServerFromService(httpService);

            //console.log(app._errorHandler, app._middlewares, app._routes);

            await httpService.startService();

            const result = await app._passRequest(
                {
                    url: "/", headers: {
                        "x-api-key": "not right"
                    }
                },
                Method.GET
            );

            shutdownHandler();
            
            expect(app._mockErrorHandler).toHaveBeenCalledTimes(1);
        });
    });
});