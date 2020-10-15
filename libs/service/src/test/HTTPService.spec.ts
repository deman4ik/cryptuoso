process.env.PGCS = "localhost:5349";
process.env.SERVICE = "my_service";
process.env.API_KEY = "my_api_key";

import { Service, Protocol } from "restana";
import { HTTPService, HTTPServiceConfig } from "../lib/HTTPService";
import { ActionsHandlerError } from "@cryptuoso/errors";
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import { ajax, setProperty, getServerFromService, createServiceRoute } from "@cryptuoso/test-helpers";

const mockExit = jest.fn();
const mockLightship = {
    registerShutdownHandler: jest.fn(),
    signalReady: jest.fn(),
    shutdown: jest.fn()
};

function getLastRegisterShutdownHandler(): { (): Promise<any> } {
    const calls = mockLightship.registerShutdownHandler.mock.calls;
    return calls[calls.length - 1][0];
}

setProperty(process, "exit", mockExit);
setProperty(console, "error", jest.fn());
jest.mock("lightship", () => {
    return {
        LightshipType: jest.fn().mockImplementation(() => {
            return typeof mockLightship;
        }),
        createLightship: jest.fn().mockImplementation(() => {
            return mockLightship;
        })
    };
});
jest.mock("ioredis");
jest.mock("@cryptuoso/logger");
jest.mock("@cryptuoso/postgres");
jest.mock("@cryptuoso/events");

describe("Test 'BaseService' class", () => {
    const CONFIG: HTTPServiceConfig = { port: 4000 };
    // Willbe initialized in tests
    let httpService: HTTPService;
    let app: Service<Protocol.HTTP>;
    let mockPG: {
        mayBeOne: jest.Mock;
    };
    let mockRedis: {
        get: jest.Mock;
        setex: jest.Mock;
    };
    let shutdownHandler: { (): Promise<any> };

    afterAll(async () => {
        await shutdownHandler();
    });

    describe("Testing constructor, startService and _stopService", () => {
        describe("Test with valid input", () => {
            describe("Test with right config provided", () => {
                it("Should initialize correctly and doesn't call process.exit", () => {
                    httpService = new HTTPService(CONFIG);
                    app = getServerFromService(httpService);
                    mockPG = { mayBeOne: httpService.db.pg.maybeOne as any };
                    mockRedis = {
                        get: httpService.redis.get as any,
                        setex: httpService.redis.setex as any
                    };
                    shutdownHandler = getLastRegisterShutdownHandler();

                    expect(mockExit).toHaveBeenCalledTimes(0);
                });
            });
        });

        describe("Testing _stopServer method calling w/o _startServer method calling", () => {
            test("Shold quit correctly", async () => {
                await shutdownHandler();

                expect(app.getServer().listening).toStrictEqual(false);
                expect(mockExit).toHaveBeenCalledTimes(1);

                mockExit.mockClear();
            });
        });

        describe("Test with valid input", () => {
            describe("Test with right config provided", () => {
                test("Should initialize correctly and doesn't call process.exit", async () => {
                    await httpService.startService();

                    expect(mockExit).toHaveBeenCalledTimes(0);
                    expect(app.getServer().address().port).toEqual(CONFIG.port);
                });
            });

            describe("Test with w/o config", () => {
                test("Should initialize correctly and doesn't call process.exit", async () => {
                    const httpService2 = new HTTPService();
                    const shutdownHandler2 = getLastRegisterShutdownHandler();
                    const app2 = getServerFromService(httpService2);

                    await httpService2.startService();

                    expect(mockExit).toHaveBeenCalledTimes(0);
                    expect(app2.getServer().address().port).toEqual(3000);

                    await shutdownHandler2();
                });
            });
        });
    });

    describe("Testing methods", () => {
        describe("Testing _checkApiKey method", () => {
            describe("Testing with right requests", () => {
                test("Should return right response", async () => {
                    const res = await ajax.get(`http://localhost:${CONFIG.port}`, {
                        "x-api-key": process.env.API_KEY
                    });

                    expect(res.ok).toStrictEqual(true);
                    expect(res.parsedBody).toStrictEqual({ service: process.env.SERVICE, routes: app.routes() });
                });
            });

            describe("Testing with wrong requests", () => {
                describe("With wrong 'x-api-key' header", () => {
                    test("Should return error response", async () => {
                        const res = await ajax.get(`http://localhost:${CONFIG.port}`, { "x-api-key": "wrong_key" });

                        expect(res.status).toStrictEqual(403);
                        expect(res.parsedBody).toStrictEqual(
                            new ActionsHandlerError("Invalid API Key", null, "FORBIDDEN", 403).response
                        );
                    });
                });

                describe("Testing w/o 'x-api-key' header", () => {
                    test("Should return error response", async () => {
                        const res = await ajax.get(`http://localhost:${CONFIG.port}`);

                        expect(res.status).toStrictEqual(403);
                        expect(res.parsedBody).toStrictEqual(
                            new ActionsHandlerError("Invalid API Key", null, "FORBIDDEN", 403).response
                        );
                    });
                });
            });
        });

        describe("Testing _checkValidation method", () => {
            describe("Testing with right requests", () => {
                describe("Test with right schema", () => {
                    test("Should return right response", async () => {
                        const rightResponse = { success: true };

                        createServiceRoute(httpService, "my1", rightResponse);

                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/my1`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                action: { name: "my1" },
                                input: {},

                                session_variables: {}
                            }
                        );

                        expect(res.parsedBody).toEqual(rightResponse);
                    });
                });
            });

            describe("Testing with wrong requests", () => {
                describe("Test with wrong schema", () => {
                    test("Should return error response with validation code", async () => {
                        const rightResponse = { success: true };

                        createServiceRoute(httpService, "my2", rightResponse);

                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/my2`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                action: { name: "wrong" },
                                input: {},

                                session_variables: {}
                            }
                        );

                        expect(res.status).toStrictEqual(400);
                        expect(res.parsedBody["code"]).toEqual("VALIDATION");
                    });

                    test("Should return error response with validation code", async () => {
                        const rightResponse = { success: true };

                        createServiceRoute(httpService, "my3", rightResponse);

                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/my3`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                wrong: "wrong"
                            }
                        );

                        expect(res.status).toStrictEqual(400);
                        expect(res.parsedBody["code"]).toEqual("VALIDATION");
                    });
                });
            });
        });

        describe("Testing _checkAuth method", () => {
            describe("Testing with right requests", () => {
                describe("Testing (no cache, data in DB) with right roles; user-id passed (auth = true)", () => {
                    test("Should return right response", async () => {
                        const routeName = "my4";
                        const rightResponse = { success: true };
                        const userId = "user-id";
                        const userRole = "user-role";

                        createServiceRoute(httpService, routeName, rightResponse, [userRole], true);
                        mockRedis.get.mockImplementation(async () => null);
                        mockPG.mayBeOne.mockImplementation(async () => ({
                            id: userId,
                            roles: {
                                allowedRoles: [userRole]
                            }
                        }));
                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/${routeName}`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                action: { name: routeName },
                                input: {},

                                session_variables: { "x-hasura-user-id": userId, "x-hasura-role": userRole }
                            }
                        );

                        expect(res.parsedBody).toEqual(rightResponse);
                    });
                });

                describe("Testing (data in cache) with right roles; user-id passed (auth = true)", () => {
                    test("Should return right response", async () => {
                        const routeName = "my41";
                        const rightResponse = { success: true };
                        const userId = "user-id";
                        const userRole = "user-role";

                        createServiceRoute(httpService, routeName, rightResponse, [userRole], true);
                        mockRedis.get.mockImplementation(async () =>
                            JSON.stringify({
                                id: userId,
                                roles: {
                                    allowedRoles: [userRole]
                                }
                            })
                        );
                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/${routeName}`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                action: { name: routeName },
                                input: {},

                                session_variables: { "x-hasura-user-id": userId, "x-hasura-role": userRole }
                            }
                        );

                        expect(res.parsedBody).toEqual(rightResponse);
                    });
                });

                describe("Testing caching data (auth = true)", () => {
                    test("Should return right response", async () => {
                        const routeName = "my42";
                        const rightResponse = { success: true };
                        const userId = "user-id";
                        const userRole = "user-role";
                        const user = {
                            id: userId,
                            roles: {
                                allowedRoles: [userRole]
                            }
                        };
                        let userJSON: string;

                        createServiceRoute(httpService, routeName, rightResponse, [userRole], true);
                        // 1st request
                        mockRedis.get.mockImplementationOnce(async () => null);
                        mockPG.mayBeOne.mockImplementationOnce(async () => user);
                        mockRedis.setex.mockImplementationOnce(async (a: any, b: any, dataString: string) => {
                            userJSON = dataString;
                        });
                        // 2nd request
                        mockRedis.get.mockImplementationOnce(async () => userJSON);

                        const reqArgs = [
                            `http://localhost:${CONFIG.port}/actions/${routeName}`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                action: { name: routeName },
                                input: {},

                                session_variables: { "x-hasura-user-id": userId, "x-hasura-role": userRole }
                            }
                        ];

                        const res1 = await ajax.post.apply(null, reqArgs);
                        const res2 = await ajax.post.apply(null, reqArgs);

                        expect(userJSON).toStrictEqual(JSON.stringify(user));
                        expect(res1.parsedBody).toEqual(rightResponse);
                        expect(res2.parsedBody).toEqual(rightResponse);
                    });
                });

                describe("Testing with 'role' from from route (auth = false)", () => {
                    test("Should return right response", async () => {
                        const routeName = "my44";
                        const rightResponse = { success: true };
                        const userId = "user-id";
                        const routeRole = "route-role";

                        createServiceRoute(httpService, routeName, rightResponse, [routeRole], false);
                        mockRedis.get.mockClear();

                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/${routeName}`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                action: { name: routeName },
                                input: {},

                                session_variables: { "x-hasura-user-id": userId, "x-hasura-role": routeRole }
                            }
                        );

                        expect(res.parsedBody).toEqual(rightResponse);
                    });
                });

                describe("Testing w/o route roles", () => {
                    test("Should return right response", async () => {
                        const routeName = "my45";
                        const rightResponse = { success: true };
                        const userId = "user-id";

                        createServiceRoute(httpService, routeName, rightResponse, undefined, false);
                        mockRedis.get.mockClear();

                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/${routeName}`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                action: { name: routeName },
                                input: {},

                                session_variables: { "x-hasura-user-id": userId }
                            }
                        );

                        expect(mockRedis.get).toHaveBeenCalledTimes(0);
                        expect(res.parsedBody).toEqual(rightResponse);
                    });
                });
            });

            describe("Testing with wrong requests", () => {
                describe("Testing with empty 'user-id'", () => {
                    test("Should return error response", async () => {
                        const rightResponse = { success: true };
                        const errorResponse = new ActionsHandlerError(
                            "Invalid session variables",
                            null,
                            "UNAUTHORIZED",
                            401
                        ).response;

                        createServiceRoute(httpService, "my6", rightResponse, ["my-role"], true);
                        mockRedis.get.mockClear();

                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/my6`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                action: { name: "my6" },
                                input: {},

                                session_variables: { "x-hasura-user-id": "", "x-hasura-role": "my-role" }
                            }
                        );

                        expect(mockRedis.get).toHaveBeenCalledTimes(0);
                        expect(res.parsedBody).toEqual(errorResponse);
                    });
                });

                describe("Testing with wrong user-id (auth = true)", () => {
                    test("Should return error response", async () => {
                        const routeName = "my5";
                        const rightResponse = { success: true };
                        const userId = "user-id";
                        const routeRole = "route-role";
                        const errorResponse = new ActionsHandlerError(
                            "User account is not found",
                            null,
                            "NOT_FOUND",
                            404
                        ).response;

                        createServiceRoute(httpService, routeName, rightResponse, [routeRole], true);
                        mockRedis.get.mockImplementation(async () => null);
                        mockPG.mayBeOne.mockImplementation(async () => null);

                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/${routeName}`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                action: { name: routeName },
                                input: {},

                                session_variables: { "x-hasura-user-id": userId, "x-hasura-role": routeRole }
                            }
                        );

                        expect(res.parsedBody).toEqual(errorResponse);
                    });
                });

                describe("Testing with right roles; user-id passed; but User is blocked", () => {
                    test("Should return error response", async () => {
                        const routeName = "my51";
                        const rightResponse = { success: true };
                        const userId = "user-id";
                        const userRole = "user-role";
                        const errorResponse = new ActionsHandlerError("User blocked", null, "FORBIDDEN", 403).response;

                        createServiceRoute(httpService, routeName, rightResponse, [userRole], true);
                        mockRedis.get.mockImplementation(async () =>
                            JSON.stringify({
                                id: userId,
                                roles: {
                                    allowedRoles: [userRole]
                                },
                                status: -1
                            })
                        );
                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/${routeName}`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                action: { name: routeName },
                                input: {},

                                session_variables: { "x-hasura-user-id": userId, "x-hasura-role": userRole }
                            }
                        );

                        expect(res.parsedBody).toEqual(errorResponse);
                    });
                });

                describe("Testing with 'role' from allowedRoles but not from route (auth = true)", () => {
                    test("Should return error response", async () => {
                        const routeName = "my43";
                        const rightResponse = { success: true };
                        const userId = "user-id";
                        const userRole = "user-role";
                        const routeRole = "route-role";
                        const errorResponse = new ActionsHandlerError("Invalid role", null, "FORBIDDEN", 403).response;

                        createServiceRoute(httpService, routeName, rightResponse, [routeRole], true);
                        mockRedis.get.mockImplementation(async () =>
                            JSON.stringify({
                                id: userId,
                                roles: {
                                    allowedRoles: [userRole]
                                }
                            })
                        );
                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/${routeName}`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                action: { name: routeName },
                                input: {},

                                session_variables: { "x-hasura-user-id": userId, "x-hasura-role": userRole }
                            }
                        );

                        expect(res.parsedBody).toEqual(errorResponse);
                    });
                });

                describe("Testing with wrong user 'role' but right route 'role' (auth = true)", () => {
                    test("Should return error response", async () => {
                        const routeName = "my52";
                        const rightResponse = { success: true };
                        const userId = "user-id";
                        const routeRole = "route-role";
                        const errorResponse = new ActionsHandlerError("Invalid role", null, "FORBIDDEN", 403).response;

                        createServiceRoute(httpService, routeName, rightResponse, [routeRole], true);
                        mockRedis.get.mockImplementation(async () =>
                            JSON.stringify({
                                id: userId,
                                roles: {
                                    allowedRoles: ["other-role"]
                                }
                            })
                        );
                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/${routeName}`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                action: { name: routeName },
                                input: {},

                                session_variables: { "x-hasura-user-id": userId, "x-hasura-role": routeRole }
                            }
                        );

                        expect(res.parsedBody).toEqual(errorResponse);
                    });
                });

                describe("Testing with wrong 'role' (auth = false)", () => {
                    test("Should return error response", async () => {
                        const routeName = "my7";
                        const rightResponse = { success: true };
                        const userId = "user-id";
                        const routeRole = "route-role";
                        const errorResponse = new ActionsHandlerError("Invalid role", null, "FORBIDDEN", 403).response;

                        createServiceRoute(httpService, routeName, rightResponse, [routeRole], false);
                        mockRedis.get.mockClear();

                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/${routeName}`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                action: { name: routeName },
                                input: {},

                                session_variables: { "x-hasura-user-id": userId, "x-hasura-role": "wrong-role" }
                            }
                        );

                        expect(mockRedis.get).toHaveBeenCalledTimes(0);
                        expect(res.parsedBody).toEqual(errorResponse);
                    });
                });
            });
        });

        describe("Tesing _createServiceRoutes method", () => {
            describe("Testing with right arguments set", () => {
                describe("Testing with full arguments set", () => {
                    it("Should not throw error", () => {
                        expect(() =>
                            createServiceRoute(httpService, "my9", {}, ["my-role"], true, {})
                        ).not.toThrowError();
                        expect(() =>
                            createServiceRoute(httpService, "my10", {}, undefined, true, {})
                        ).not.toThrowError();
                    });
                });

                describe("Testing w/o 'inputSchema'", () => {
                    it("Should not throw error", () => {
                        expect(() => createServiceRoute(httpService, "my11", {}, ["my-role"], true)).not.toThrowError();
                    });
                });

                describe("Testing w/o 'auth' and 'inputSchema'", () => {
                    it("Should not throw error", () => {
                        expect(() => createServiceRoute(httpService, "my12", {}, ["my-role"])).not.toThrowError();
                    });
                });

                describe("Testing w/o 'roles, 'auth' and 'inputSchema'", () => {
                    it("Should not throw error", () => {
                        expect(() => createServiceRoute(httpService, "my13", {})).not.toThrowError();
                    });
                });
            });

            describe("Testing with wrong arguments set", () => {
                describe("Testing with empty 'name'", () => {
                    it("Should to throw error", () => {
                        expect(() => {
                            const arg: { [key: string]: any } = {};
                            arg[""] = {
                                handler: jest.fn(),
                                roles: ["my-role"],
                                auth: true,
                                schema: {}
                            };
                            httpService.createRoutes(arg);
                        }).toThrowError();
                    });
                });

                describe("Testing with empty 'handler'", () => {
                    it("Should to throw error", () => {
                        expect(() => {
                            const arg: { [key: string]: any } = {};
                            arg["my14"] = {
                                /* handler: () => {}, */
                                roles: ["my-role"],
                                auth: true,
                                schema: {}
                            };
                            httpService.createRoutes(arg);
                        }).toThrowError();
                    });
                });

                describe("Testing with non-function 'handler'", () => {
                    it("Should to throw error", () => {
                        expect(() => {
                            const arg: { [key: string]: any } = {};
                            arg["my15"] = {
                                handler: "handler",
                                roles: ["my-role"],
                                auth: true,
                                schema: {}
                            };
                            httpService.createRoutes(arg);
                        }).toThrowError();
                    });
                });
            });

            describe("Adding handler to existing route", () => {
                test("Should throw error", async () => {
                    const rightResponse = { first: true };

                    createServiceRoute(httpService, "my16", rightResponse, undefined, true);
                    expect(() =>
                        createServiceRoute(httpService, "my16", rightResponse, undefined, true)
                    ).toThrowError();
                    expect(() =>
                        createServiceRoute(httpService, "my17", rightResponse, undefined, true)
                    ).not.toThrowError();
                });
            });

            describe("Adding several handlers", () => {
                test("Should not throw error", async () => {
                    const rightResponse = { first: true };

                    createServiceRoute(httpService, "my18", rightResponse, undefined, true);
                    expect(() =>
                        createServiceRoute(httpService, "my19", rightResponse, undefined, true)
                    ).not.toThrowError();
                });
            });
        });
    });
});
