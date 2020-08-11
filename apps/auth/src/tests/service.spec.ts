process.env.PGCS = "localhost:5349";
process.env.SERVICE = "my_service";
process.env.API_KEY = "my_api_key";

process.env.REFRESH_TOKEN_EXPIRES = "1";
process.env.JWT_SECRET = "secret";
process.env.JWT_TOKEN_EXPIRES = "1";
process.env.BOT_TOKEN = "BOT_TOKEN";

import AuthService, { AuthServiceConfig } from "../app/service";
import { ActionsHandlerError } from "@cryptuoso/errors";

import { ajax, setProperty, getServerFromService } from "./AuthService.spec.helpers";

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
    const CONFIG: AuthServiceConfig = { port: 4000 };

    describe("Testing constructor", () => {
        describe("Test with valid input", () => {
            describe("Test with right config provided", () => {
                test("Should initialize correctly and doesn't call process.exit", async () => {
                    new AuthService(CONFIG);

                    expect(mockExit).toHaveBeenCalledTimes(0);
                });
            });
        });

        describe("Test with valid input", () => {
            describe("Test with right config provided", () => {
                test("Should initialize correctly and doesn't call process.exit", async () => {
                    const authService = new AuthService(CONFIG);
                    const shutdownHandler = getLastRegisterShutdownHandler();
                    const app = getServerFromService(authService);

                    await authService.startService();

                    expect(mockExit).toHaveBeenCalledTimes(0);
                    expect(app.getServer().address().port).toEqual(CONFIG.port);

                    await shutdownHandler();
                });
            });

            describe("Test with w/o config", () => {
                test("Should initialize correctly and doesn't call process.exit", async () => {
                    const authService = new AuthService();
                    const shutdownHandler = getLastRegisterShutdownHandler();
                    const app = getServerFromService(authService);

                    await authService.startService();

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
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();
                const app = getServerFromService(authService);

                await shutdownHandler();

                expect(app.getServer().listening).toStrictEqual(false);
            });
        });

        describe("Testing _checkApiKey method", () => {
            describe("Testing with right requests", () => {
                describe("Should return right response", () => {
                    test("", async () => {
                        const authService = new AuthService(CONFIG);
                        const shutdownHandler = getLastRegisterShutdownHandler();
                        const app = getServerFromService(authService);

                        await authService.startService();

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
                        const authService = new AuthService(CONFIG);
                        const shutdownHandler = getLastRegisterShutdownHandler();

                        await authService.startService();

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
                        const authService = new AuthService(CONFIG);
                        const shutdownHandler = getLastRegisterShutdownHandler();

                        await authService.startService();

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
                        const authService = new AuthService(CONFIG);
                        const shutdownHandler = getLastRegisterShutdownHandler();
                        const rightResponse = { success: true };

                        createRoute(authService, "my", rightResponse);

                        await authService.startService();

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
                        const authService = new AuthService(CONFIG);
                        const shutdownHandler = getLastRegisterShutdownHandler();
                        const rightResponse = { success: true };

                        createRoute(authService, "my", rightResponse);

                        await authService.startService();

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
                        const authService = new AuthService(CONFIG);
                        const shutdownHandler = getLastRegisterShutdownHandler();
                        const rightResponse = { success: true };

                        createRoute(authService, "my", rightResponse);

                        await authService.startService();

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
                            const authService = new AuthService(CONFIG);
                            const shutdownHandler = getLastRegisterShutdownHandler();
                            const rightResponse = { success: true };

                            createRoute(authService, "my", rightResponse, ["my-role"], true);

                            await authService.startService();

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
                            const authService = new AuthService(CONFIG);
                            const shutdownHandler = getLastRegisterShutdownHandler();
                            const rightResponse = { success: true };

                            createRoute(authService, "my", rightResponse, [], true);

                            await authService.startService();

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
                            const authService = new AuthService(CONFIG);
                            const shutdownHandler = getLastRegisterShutdownHandler();
                            const rightResponse = { success: true };
                            const errorResponse = new ActionsHandlerError(
                                "Unauthorized: Invalid session variables",
                                null,
                                "UNAUTHORIZED",
                                401
                            ).response;

                            createRoute(authService, "my", rightResponse, ["my-role"], true);

                            await authService.startService();

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
                            const authService = new AuthService(CONFIG);
                            const shutdownHandler = getLastRegisterShutdownHandler();
                            const rightResponse = { success: true };
                            const errorResponse = new ActionsHandlerError(
                                "Forbidden: Invalid role",
                                null,
                                "FORBIDDEN",
                                403
                            ).response;

                            createRoute(authService, "my", rightResponse, ["my-role"], true);

                            await authService.startService();

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
                            const authService = new AuthService(CONFIG);
                            const shutdownHandler = getLastRegisterShutdownHandler();
                            const rightResponse = { success: true };
                            const errorResponse = new ActionsHandlerError(
                                "Forbidden: Invalid role",
                                null,
                                "FORBIDDEN",
                                403
                            ).response;

                            createRoute(authService, "my", rightResponse, ["my-role"], true);

                            await authService.startService();

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
        });
    });
});
