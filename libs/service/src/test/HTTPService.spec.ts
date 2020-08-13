process.env.PGCS = "localhost:5349";
process.env.SERVICE = "my_service";
process.env.API_KEY = "my_api_key";

import { Service, Protocol } from "restana";
import { HTTPService, HTTPServiceConfig } from "../lib/HTTPService";
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
    // Willbe initialized in tests
    let httpService: HTTPService;
    let app: Service<Protocol.HTTP>;
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
                            new ActionsHandlerError("Forbidden: Invalid API Key", null, "FORBIDDEN", 403).response
                        );
                    });
                });

                describe("Testing w/o 'x-api-key' header", () => {
                    test("Should return error response", async () => {
                        const res = await ajax.get(`http://localhost:${CONFIG.port}`);

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
                        const rightResponse = { success: true };

                        createRoute(httpService, "my1", rightResponse);

                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/my1`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                action: { name: "my1" },
                                input: {},
                                // eslint-disable-next-line @typescript-eslint/camelcase
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

                        createRoute(httpService, "my2", rightResponse);

                        const res = await ajax.post(
                            `http://localhost:${CONFIG.port}/actions/my2`,
                            { "x-api-key": process.env.API_KEY },
                            {
                                action: { name: "wrong" },
                                input: {},
                                // eslint-disable-next-line @typescript-eslint/camelcase
                                session_variables: {}
                            }
                        );

                        expect(res.status).toStrictEqual(400);
                        expect(res.parsedBody["code"]).toEqual("VALIDATION");
                    });

                    test("Should return error response with validation code", async () => {
                        const rightResponse = { success: true };

                        createRoute(httpService, "my3", rightResponse);

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

            describe("Testing _checkAuth method", () => {
                describe("Testing with right requests", () => {
                    describe("Testing with right roles; user-id passed", () => {
                        test("Should return right response", async () => {
                            const rightResponse = { success: true };

                            createRoute(httpService, "my4", rightResponse, ["my-role"], true);

                            const res = await ajax.post(
                                `http://localhost:${CONFIG.port}/actions/my4`,
                                { "x-api-key": process.env.API_KEY },
                                {
                                    action: { name: "my4" },
                                    input: {},
                                    // eslint-disable-next-line @typescript-eslint/camelcase
                                    session_variables: { "x-hasura-user-id": "user-id", "x-hasura-role": "my-role" }
                                }
                            );

                            expect(res.parsedBody).toEqual(rightResponse);
                        });
                    });

                    describe("Testing w/o roles", () => {
                        test("Should return right response", async () => {
                            const rightResponse = { success: true };

                            createRoute(httpService, "my5", rightResponse, [], true);

                            const res = await ajax.post(
                                `http://localhost:${CONFIG.port}/actions/my5`,
                                { "x-api-key": process.env.API_KEY },
                                {
                                    action: { name: "my5" },
                                    input: {},
                                    // eslint-disable-next-line @typescript-eslint/camelcase
                                    session_variables: { "x-hasura-user-id": "user-id" }
                                }
                            );

                            expect(res.parsedBody).toEqual(rightResponse);
                        });
                    });
                });

                describe("Testing with wrong requests", () => {
                    describe("Testing with empty 'user-id'", () => {
                        test("Should return error response", async () => {
                            const rightResponse = { success: true };
                            const errorResponse = new ActionsHandlerError(
                                "Unauthorized: Invalid session variables",
                                null,
                                "UNAUTHORIZED",
                                401
                            ).response;

                            createRoute(httpService, "my6", rightResponse, ["my-role"], true);

                            const res = await ajax.post(
                                `http://localhost:${CONFIG.port}/actions/my6`,
                                { "x-api-key": process.env.API_KEY },
                                {
                                    action: { name: "my6" },
                                    input: {},
                                    // eslint-disable-next-line @typescript-eslint/camelcase
                                    session_variables: { "x-hasura-user-id": "", "x-hasura-role": "my-role" }
                                }
                            );

                            expect(res.parsedBody).toEqual(errorResponse);
                        });
                    });

                    describe("Testing with empty 'role'", () => {
                        test("Should return error response", async () => {
                            const rightResponse = { success: true };
                            const errorResponse = new ActionsHandlerError(
                                "Forbidden: Invalid role",
                                null,
                                "FORBIDDEN",
                                403
                            ).response;

                            createRoute(httpService, "my7", rightResponse, ["my-role"], true);

                            const res = await ajax.post(
                                `http://localhost:${CONFIG.port}/actions/my7`,
                                { "x-api-key": process.env.API_KEY },
                                {
                                    action: { name: "my7" },
                                    input: {},
                                    // eslint-disable-next-line @typescript-eslint/camelcase
                                    session_variables: { "x-hasura-user-id": "user-id", "x-hasura-role": "" }
                                }
                            );

                            expect(res.parsedBody).toEqual(errorResponse);
                        });
                    });

                    describe("Testing with wrong 'role'", () => {
                        test("Should return error response", async () => {
                            const rightResponse = { success: true };
                            const errorResponse = new ActionsHandlerError(
                                "Forbidden: Invalid role",
                                null,
                                "FORBIDDEN",
                                403
                            ).response;

                            createRoute(httpService, "my8", rightResponse, ["my-role"], true);

                            const res = await ajax.post(
                                `http://localhost:${CONFIG.port}/actions/my8`,
                                { "x-api-key": process.env.API_KEY },
                                {
                                    action: { name: "my8" },
                                    input: {},
                                    // eslint-disable-next-line @typescript-eslint/camelcase
                                    session_variables: { "x-hasura-user-id": "user-id", "x-hasura-role": "wrong" }
                                }
                            );

                            expect(res.parsedBody).toEqual(errorResponse);
                        });
                    });
                });
            });

            describe("Tesing _createRoutes method", () => {
                describe("Testing with right arguments set", () => {
                    describe("Testing with full arguments set", () => {
                        it("Should not throw error", () => {
                            expect(() => createRoute(httpService, "my9", {}, ["my-role"], true, {})).not.toThrowError();
                            expect(() => createRoute(httpService, "my10", {}, [], true, {})).not.toThrowError();
                        });
                    });

                    describe("Testing w/o 'inputSchema'", () => {
                        it("Should not throw error", () => {
                            expect(() => createRoute(httpService, "my11", {}, ["my-role"], true)).not.toThrowError();
                        });
                    });

                    describe("Testing w/o 'auth' and 'inputSchema'", () => {
                        it("Should not throw error", () => {
                            expect(() => createRoute(httpService, "my12", {}, ["my-role"])).not.toThrowError();
                        });
                    });

                    describe("Testing w/o 'roles, 'auth' and 'inputSchema'", () => {
                        it("Should not throw error", () => {
                            expect(() => createRoute(httpService, "my13", {})).not.toThrowError();
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

                        createRoute(httpService, "my16", rightResponse, [], true);
                        expect(() => createRoute(httpService, "my16", rightResponse, [], true)).toThrowError();
                        expect(() => createRoute(httpService, "my17", rightResponse, [], true)).not.toThrowError();
                    });
                });

                describe("Adding several handlers", () => {
                    test("Should not throw error", async () => {
                        const rightResponse = { first: true };

                        createRoute(httpService, "my18", rightResponse, [], true);
                        expect(() => createRoute(httpService, "my19", rightResponse, [], true)).not.toThrowError();
                    });
                });
            });
        });
    });
});
