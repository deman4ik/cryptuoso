process.env.PGCS = "localhost:5349";

import { HTTPService, HTTPServiceConfig } from "./HTTPService";
import { ActionsHandlerError } from "@cryptuoso/errors";

import { ajax, setProperty, getServerFromService, createRoute } from "./HTTPService.spec.helpers";

const mockExit = jest.fn();
const mockLightshipType = {
    registerShutdownHandler: jest.fn(),
    signalReady: jest.fn(),
    shutdown: jest.fn()
};

function getLastRegisterShutdownHandler(): { (): Promise<any> } {
    const calls = mockLightshipType.registerShutdownHandler.mock.calls;
    return calls[calls.length - 1][0];
}

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
    const CONFIG: HTTPServiceConfig = { port: 4000 };
    process.env.SERVICE = "my_service";
    process.env.API_KEY = "my_api_key";

    describe("Testing constructor", () => {
        describe("Test with valid input", () => {
            describe("Test with right config provided", () => {
                test("Should initialize correctly and doesn't call process.exit", async () => {
                    new HTTPService(CONFIG);

                    expect(mockExit).toHaveBeenCalledTimes(0);
                });
            });
        });

        describe("Test with valid input", () => {
            describe("Test with right config provided", () => {
                test("Should initialize correctly and doesn't call process.exit", async () => {
                    const httpService = new HTTPService(CONFIG);
                    const shutdownHandler = getLastRegisterShutdownHandler();
                    const app = getServerFromService(httpService);

                    await httpService.startService();

                    expect(mockExit).toHaveBeenCalledTimes(0);
                    expect(app.getServer().address().port).toEqual(CONFIG.port);

                    await shutdownHandler();
                });
            });

            describe("Test with w/o config", () => {
                test("Should initialize correctly and doesn't call process.exit", async () => {
                    const httpService = new HTTPService();
                    const shutdownHandler = getLastRegisterShutdownHandler();
                    const app = getServerFromService(httpService);

                    await httpService.startService();

                    expect(mockExit).toHaveBeenCalledTimes(0);
                    expect(app.getServer().address().port).toEqual(3000);

                    await shutdownHandler();
                });
            });
        });
    });

    describe("Testing methods", () => {
        describe("Testing _stopServer method calling w/o _startServer method calling", () => {
            test("Shold quit correctly", async () => {
                const httpService = new HTTPService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();
                const app = getServerFromService(httpService);

                await shutdownHandler();

                expect(app.getServer().listening).toStrictEqual(false);
            });
        });

        describe("Testing _checkApiKey method", () => {
            describe("Testing with right requests", () => {
                describe("Should return right response", () => {
                    test("", async () => {
                        const httpService = new HTTPService(CONFIG);
                        const shutdownHandler = getLastRegisterShutdownHandler();
                        const app = getServerFromService(httpService);

                        await httpService.startService();

                        const res = await ajax.get(`http://localhost:${CONFIG.port}`, {
                            "x-api-key": process.env.API_KEY
                        });

                        await shutdownHandler();

                        expect(res.ok).toStrictEqual(true);
                        expect(res.parsedBody).toStrictEqual({ service: process.env.SERVICE, routes: app.routes() });
                    });
                });
            });

            describe("Testing with wrong requests", () => {
                describe("With wrong 'x-api-key' header", () => {
                    test("Should return error response", async () => {
                        const httpService = new HTTPService(CONFIG);
                        const shutdownHandler = getLastRegisterShutdownHandler();

                        await httpService.startService();

                        const res = await ajax.get(`http://localhost:${CONFIG.port}`, { "x-api-key": "wrong_key" });

                        await shutdownHandler();

                        expect(res.status).toStrictEqual(403);
                        expect(res.parsedBody).toStrictEqual(
                            new ActionsHandlerError("Forbidden: Invalid API Key", null, "FORBIDDEN", 403).response
                        );
                    });
                });

                describe("Testing w/o 'x-api-key' header", () => {
                    test("Should return error response", async () => {
                        const httpService = new HTTPService(CONFIG);
                        const shutdownHandler = getLastRegisterShutdownHandler();

                        await httpService.startService();

                        const res = await ajax.get(`http://localhost:${CONFIG.port}`);

                        await shutdownHandler();

                        expect(res.status).toStrictEqual(403);
                        expect(res.parsedBody).toStrictEqual(
                            new ActionsHandlerError("Forbidden: Invalid API Key", null, "FORBIDDEN", 403).response
                        );
                    });
                });
            });
        });

        describe("Testing _checkValidation method", () => {
            describe("Testing with right requests", () => {
                describe("Test with right schema", () => {
                    test("Should return right response", async () => {
                        const httpService = new HTTPService(CONFIG);
                        const shutdownHandler = getLastRegisterShutdownHandler();
                        const rightResponse = { success: true };

                        createRoute(httpService, "my", rightResponse);

                        await httpService.startService();

                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/my`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                action: { name: "my" },
                                input: {},
                                // eslint-disable-next-line @typescript-eslint/camelcase
                                session_variables: {}
                            }
                        );

                        await shutdownHandler();

                        expect(res.parsedBody).toEqual(rightResponse);
                    });
                });
            });

            describe("Testing with wrong requests", () => {
                describe("Test with wrong schema", () => {
                    test("Should return error response with validation code", async () => {
                        const httpService = new HTTPService(CONFIG);
                        const shutdownHandler = getLastRegisterShutdownHandler();
                        const rightResponse = { success: true };

                        createRoute(httpService, "my", rightResponse);

                        await httpService.startService();

                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/my`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                action: { name: "wrong" },
                                input: {},
                                // eslint-disable-next-line @typescript-eslint/camelcase
                                session_variables: {}
                            }
                        );

                        await shutdownHandler();

                        expect(res.status).toStrictEqual(400);
                        expect(res.parsedBody["code"]).toEqual("VALIDATION");
                    });

                    test("Should return error response with validation code", async () => {
                        const httpService = new HTTPService(CONFIG);
                        const shutdownHandler = getLastRegisterShutdownHandler();
                        const rightResponse = { success: true };

                        createRoute(httpService, "my", rightResponse);

                        await httpService.startService();

                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/my`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                wrong: "wrong"
                            }
                        );

                        await shutdownHandler();

                        expect(res.status).toStrictEqual(400);
                        expect(res.parsedBody["code"]).toEqual("VALIDATION");
                    });
                });
            });

            describe("Testing _checkAuth method", () => {
                describe("Testing with right requests", () => {
                    describe("Testing with right roles; user-id passed", () => {
                        test("Should return right response", async () => {
                            const httpService = new HTTPService(CONFIG);
                            const shutdownHandler = getLastRegisterShutdownHandler();
                            const rightResponse = { success: true };

                            createRoute(httpService, "my", rightResponse, ["my-role"], true);

                            await httpService.startService();

                            const res = await ajax.post(
                                `http://localhost:${CONFIG.port}/actions/my`,
                                { "x-api-key": process.env.API_KEY },
                                {
                                    action: { name: "my" },
                                    input: {},
                                    // eslint-disable-next-line @typescript-eslint/camelcase
                                    session_variables: { "x-hasura-user-id": "user-id", "x-hasura-role": "my-role" }
                                }
                            );

                            await shutdownHandler();

                            expect(res.parsedBody).toEqual(rightResponse);
                        });
                    });

                    describe("Testing w/o roles", () => {
                        test("Should return right response", async () => {
                            const httpService = new HTTPService(CONFIG);
                            const shutdownHandler = getLastRegisterShutdownHandler();
                            const rightResponse = { success: true };

                            createRoute(httpService, "my", rightResponse, [], true);

                            await httpService.startService();

                            const res = await ajax.post(
                                `http://localhost:${CONFIG.port}/actions/my`,
                                { "x-api-key": process.env.API_KEY },
                                {
                                    action: { name: "my" },
                                    input: {},
                                    // eslint-disable-next-line @typescript-eslint/camelcase
                                    session_variables: { "x-hasura-user-id": "user-id" }
                                }
                            );

                            await shutdownHandler();

                            expect(res.parsedBody).toEqual(rightResponse);
                        });
                    });
                });

                describe("Testing with wrong requests", () => {
                    describe("Testing with empty 'user-id'", () => {
                        test("Should return error response", async () => {
                            const httpService = new HTTPService(CONFIG);
                            const shutdownHandler = getLastRegisterShutdownHandler();
                            const rightResponse = { success: true };
                            const errorResponse = new ActionsHandlerError(
                                "Unauthorized: Invalid session variables",
                                null,
                                "UNAUTHORIZED",
                                401
                            ).response;

                            createRoute(httpService, "my", rightResponse, ["my-role"], true);

                            await httpService.startService();

                            const res = await ajax.post(
                                `http://localhost:${CONFIG.port}/actions/my`,
                                { "x-api-key": process.env.API_KEY },
                                {
                                    action: { name: "my" },
                                    input: {},
                                    // eslint-disable-next-line @typescript-eslint/camelcase
                                    session_variables: { "x-hasura-user-id": "", "x-hasura-role": "my-role" }
                                }
                            );

                            await shutdownHandler();

                            expect(res.parsedBody).toEqual(errorResponse);
                        });
                    });

                    describe("Testing with empty 'role'", () => {
                        test("Should return error response", async () => {
                            const httpService = new HTTPService(CONFIG);
                            const shutdownHandler = getLastRegisterShutdownHandler();
                            const rightResponse = { success: true };
                            const errorResponse = new ActionsHandlerError(
                                "Forbidden: Invalid role",
                                null,
                                "FORBIDDEN",
                                403
                            ).response;

                            createRoute(httpService, "my", rightResponse, ["my-role"], true);

                            await httpService.startService();

                            const res = await ajax.post(
                                `http://localhost:${CONFIG.port}/actions/my`,
                                { "x-api-key": process.env.API_KEY },
                                {
                                    action: { name: "my" },
                                    input: {},
                                    // eslint-disable-next-line @typescript-eslint/camelcase
                                    session_variables: { "x-hasura-user-id": "user-id", "x-hasura-role": "" }
                                }
                            );

                            await shutdownHandler();

                            expect(res.parsedBody).toEqual(errorResponse);
                        });
                    });

                    describe("Testing with wrong 'role'", () => {
                        test("Should return error response", async () => {
                            const httpService = new HTTPService(CONFIG);
                            const shutdownHandler = getLastRegisterShutdownHandler();
                            const rightResponse = { success: true };
                            const errorResponse = new ActionsHandlerError(
                                "Forbidden: Invalid role",
                                null,
                                "FORBIDDEN",
                                403
                            ).response;

                            createRoute(httpService, "my", rightResponse, ["my-role"], true);

                            await httpService.startService();

                            const res = await ajax.post(
                                `http://localhost:${CONFIG.port}/actions/my`,
                                { "x-api-key": process.env.API_KEY },
                                {
                                    action: { name: "my" },
                                    input: {},
                                    // eslint-disable-next-line @typescript-eslint/camelcase
                                    session_variables: { "x-hasura-user-id": "user-id", "x-hasura-role": "wrong" }
                                }
                            );

                            await shutdownHandler();

                            expect(res.parsedBody).toEqual(errorResponse);
                        });
                    });
                });
            });

            describe("Tesing _createRoutes method", () => {
                describe("Testing with right arguments set", () => {
                    describe("Testing with full arguments set", () => {
                        it("Should not throw error", () => {
                            const httpService = new HTTPService(CONFIG);

                            expect(() => createRoute(httpService, "my", {}, ["my-role"], true, {})).not.toThrowError();
                            expect(() => createRoute(httpService, "my2", {}, [], true, {})).not.toThrowError();
                        });
                    });

                    describe("Testing w/o 'inputSchema'", () => {
                        it("Should not throw error", () => {
                            const httpService = new HTTPService(CONFIG);

                            expect(() => createRoute(httpService, "my", {}, ["my-role"], true)).not.toThrowError();
                        });
                    });

                    describe("Testing w/o 'auth' and 'inputSchema'", () => {
                        it("Should not throw error", () => {
                            const httpService = new HTTPService(CONFIG);

                            expect(() => createRoute(httpService, "my", {}, ["my-role"])).not.toThrowError();
                        });
                    });

                    describe("Testing w/o 'roles, 'auth' and 'inputSchema'", () => {
                        it("Should not throw error", () => {
                            const httpService = new HTTPService(CONFIG);

                            expect(() => createRoute(httpService, "my", {})).not.toThrowError();
                        });
                    });
                });

                describe("Testing with wrong arguments set", () => {
                    describe("Testing with empty 'name'", () => {
                        it("Should to throw error", () => {
                            const httpService = new HTTPService(CONFIG);

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
                            const httpService = new HTTPService(CONFIG);

                            expect(() => {
                                const arg: { [key: string]: any } = {};
                                arg["my"] = {
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
                            const httpService = new HTTPService(CONFIG);

                            expect(() => {
                                const arg: { [key: string]: any } = {};
                                arg["my"] = {
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
                        const httpService = new HTTPService(CONFIG);
                        const rightResponse = { first: true };

                        createRoute(httpService, "my", rightResponse, [], true);
                        expect(() => createRoute(httpService, "my", rightResponse, [], true)).toThrowError();
                        expect(() => createRoute(httpService, "my3", rightResponse, [], true)).not.toThrowError();
                    });
                });

                describe("Adding several handlers", () => {
                    test("Should not throw error", async () => {
                        const httpService = new HTTPService(CONFIG);
                        const rightResponse = { first: true };

                        createRoute(httpService, "my1", rightResponse, [], true);
                        expect(() => createRoute(httpService, "my2", rightResponse, [], true)).not.toThrowError();
                    });
                });
            });
        });
    });
});
