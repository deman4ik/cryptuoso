process.env.PGCS = "localhost:5349";
process.env.SERVICE = "my_service";
process.env.API_KEY = "my_api_key";

process.env.REFRESH_TOKEN_EXPIRES = "1";
process.env.JWT_SECRET = "secret";
process.env.JWT_TOKEN_EXPIRES = "1";
process.env.BOT_TOKEN = "BOT_TOKEN";

import bcrypt from "bcrypt";
import AuthService, { AuthServiceConfig } from "../app/service";
import { User, UserStatus, UserRoles, UserSettings } from "@cryptuoso/user-state";
import { pg } from "@cryptuoso/postgres";
import { ajax, setProperty, makeTgHash } from "./helpers";

const userSettings: UserSettings = {
    notifications: {
        signals: {
            telegram: true,
            email: true
        },
        trading: {
            telegram: true,
            email: true
        }
    }
};

const mockPG = {
    maybeOne: pg.maybeOne as jest.Mock,
    query: pg.query as jest.Mock
};

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
//setProperty(console, "error", jest.fn());
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
jest.mock("@cryptuoso/mail");

describe("Test 'AuthService' class methods", () => {
    const CONFIG: AuthServiceConfig = { port: 4000 };

    describe("Test constructor", () => {
        test("Should not to throw", async () => {
            expect(() => new AuthService(CONFIG)).not.toThrowError();
        });
    });

    describe("login method", () => {
        describe("With right email and password", () => {
            test("Should return accessToken and set cookie refreshToken", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    email: "example@inbox.com",
                    password: "password"
                };
                const dbUser: User = {
                    id: "id",
                    email: params.email,
                    status: UserStatus.enabled,
                    passwordHash: await bcrypt.hash(params.password, 10),
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/login`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "login" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("success", true);
                expect(res.parsedBody).toHaveProperty("accessToken");
                expect(res.headers.get("set-cookie").includes("refresh_token")).toBeTruthy();

                await shutdownHandler();
            });
        });

        describe("With wrong email", () => {
            test("Should return error", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    email: "example@inbox.com",
                    password: "password"
                };

                mockPG.maybeOne.mockImplementation(async () => null);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/login`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "login" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": "id",
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(404);
                expect(res.parsedBody).not.toHaveProperty("success");

                await shutdownHandler();
            });
        });

        describe("With wrong password", () => {
            test("Should return error", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    email: "example@inbox.com",
                    password: "password"
                };
                const dbUser: User = {
                    id: "id",
                    email: params.email,
                    status: UserStatus.enabled,
                    passwordHash: "OTHER",
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/login`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "login" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(403);
                expect(res.parsedBody).not.toHaveProperty("success");

                await shutdownHandler();
            });
        });
    });

    describe("loginTg method", () => {
        describe("With right telegramId and hash", () => {
            test("Should return accessToken and set cookie refreshToken", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    id: 123,
                    // eslint-disable-next-line @typescript-eslint/camelcase
                    auth_date: Date.now(),
                    hash: ""
                };
                params.hash = await makeTgHash(params, process.env.BOT_TOKEN);
                const dbUser: User = {
                    id: "id",
                    telegramId: params.id,
                    status: UserStatus.enabled,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/login-tg`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "login-tg" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("success", true);
                expect(res.parsedBody).toHaveProperty("accessToken");
                expect(res.headers.get("set-cookie").includes("refresh_token")).toBeTruthy();

                await shutdownHandler();
            });
        });

        describe("With new user", () => {
            test("Should create new account and return new tokens", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    id: 123,
                    username: "username",
                    // eslint-disable-next-line @typescript-eslint/camelcase
                    auth_date: Date.now(),
                    hash: ""
                };
                params.hash = await makeTgHash(params, process.env.BOT_TOKEN);

                mockPG.maybeOne.mockImplementation(async () => null);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/login-tg`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "login-tg" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": "id",
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("success", true);
                expect(res.parsedBody).toHaveProperty("accessToken");
                expect(res.headers.get("set-cookie").includes("refresh_token")).toBeTruthy();

                await shutdownHandler();
            });
        });

        describe("With wrong hash", () => {
            test("Should return error", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    id: 123,
                    username: "username",
                    // eslint-disable-next-line @typescript-eslint/camelcase
                    auth_date: Date.now(),
                    hash: "WRONG_HASH"
                };
                //params.hash = await makeTgHash(params, process.env.BOT_TOKEN);

                const dbUser: User = {
                    id: "id",
                    telegramId: params.id,
                    status: UserStatus.enabled,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/login-tg`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "login-tg" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": "id",
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(403);
                expect(res.parsedBody).not.toHaveProperty("success");

                await shutdownHandler();
            });
        });
    });

    describe("logout method", () => {
        describe("With any params", () => {
            test("Should clear refreshToken", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {};

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/logout`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "logout" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": "id",
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("success", true);
                expect(res.headers.get("set-cookie").includes("refresh_token=;")).toBeTruthy();

                await shutdownHandler();
            });
        });
    });

    describe("register method", () => {
        describe("With unique email", () => {
            test("Should return userId", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    email: "example@inbox.com",
                    password: "password",
                    name: "Name"
                };

                mockPG.maybeOne.mockImplementation(async () => null);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/register`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "register" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": "id",
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("success", true);
                expect(res.parsedBody).toHaveProperty("userId");

                await shutdownHandler();
            });
        });

        describe("With non-unique email", () => {
            test("Should return error", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    email: "example@inbox.com",
                    password: "password",
                    name: "Name"
                };

                const dbUser: User = {
                    id: "id",
                    status: UserStatus.enabled,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/register`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "register" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": "id",
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(409);
                expect(res.parsedBody).not.toHaveProperty("success");

                await shutdownHandler();
            });
        });
    });

    describe("refreshToken method", () => {
        describe("With right refreshToken", () => {
            test("Should return accessToken and set cookie refreshToken", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    refreshToken: "1"
                };
                const dbUser: User = {
                    id: "id",
                    status: UserStatus.enabled,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/refresh-token`,
                    {
                        "x-api-key": process.env.API_KEY,
                        "x-refresh-token": params["refreshToken"]
                    },
                    {
                        action: { name: "refresh-token" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("success", true);
                expect(res.parsedBody).toHaveProperty("accessToken");
                expect(res.headers.get("set-cookie").includes("refresh_token")).toBeTruthy();

                await shutdownHandler();
            });
        });

        describe("With bad refreshToken", () => {
            test("Should return error", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {};

                mockPG.maybeOne.mockImplementation(async () => null);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/refresh-token`,
                    {
                        "x-api-key": process.env.API_KEY,
                        "x-refresh-token": "token"
                    },
                    {
                        action: { name: "refresh-token" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": "id",
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(404);
                expect(res.parsedBody).not.toHaveProperty("success");

                await shutdownHandler();
            });
        });
    });

    describe("activateAccount method", () => {
        describe("With right userId and secretCode", () => {
            test("Should return accessToken and set cookie refreshToken", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    userId: "id",
                    secretCode: "secret"
                };
                const dbUser: User = {
                    id: params.userId,
                    status: UserStatus.new,
                    secretCode: params.secretCode,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/activate-account`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "activate-account" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("success", true);
                expect(res.parsedBody).toHaveProperty("accessToken");
                expect(res.headers.get("set-cookie").includes("refresh_token")).toBeTruthy();

                await shutdownHandler();
            });
        });

        describe("With wrong userId", () => {
            test("Should return error", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    userId: "id",
                    secretCode: "secret"
                };

                mockPG.maybeOne.mockImplementation(async () => null);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/activate-account`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "activate-account" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": "id",
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(404);
                expect(res.parsedBody).not.toHaveProperty("success");

                await shutdownHandler();
            });
        });

        describe("With wrong secretCode", () => {
            test("Should return error", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    userId: "id",
                    secretCode: "secret"
                };
                const dbUser: User = {
                    id: params.userId,
                    status: UserStatus.new,
                    secretCode: "OTHER",
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/activate-account`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "activate-account" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(403);
                expect(res.parsedBody).not.toHaveProperty("success");

                await shutdownHandler();
            });
        });
    });

    describe("passwordReset method", () => {
        describe("With right email", () => {
            test("Should return userId", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    email: "example@inbox.com"
                };
                const dbUser: User = {
                    id: "id",
                    email: params.email,
                    status: UserStatus.enabled,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/password-reset`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "password-reset" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("success", true);
                expect(res.parsedBody).toHaveProperty("userId", dbUser.id);

                await shutdownHandler();
            });
        });

        describe("With bad refreshToken", () => {
            test("Should return error", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    email: "example@inbox.com"
                };

                mockPG.maybeOne.mockImplementation(async () => null);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/password-reset`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "password-reset" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": "id",
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(404);
                expect(res.parsedBody).not.toHaveProperty("success");

                await shutdownHandler();
            });
        });
    });

    describe("confirmPasswordReset method", () => {
        describe("With right userId, secretCode and password", () => {
            test("Should return accessToken and set cookie refreshToken", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    userId: "id",
                    secretCode: "secret",
                    password: "password"
                };
                const dbUser: User = {
                    id: params.userId,
                    status: UserStatus.enabled,
                    secretCode: params.secretCode,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/confirm-password-reset`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "confirm-password-reset" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("success", true);
                expect(res.parsedBody).toHaveProperty("accessToken");
                expect(res.headers.get("set-cookie").includes("refresh_token")).toBeTruthy();

                await shutdownHandler();
            });
        });

        describe("With wrong userId", () => {
            test("Should return error", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    userId: "id",
                    secretCode: "secret",
                    password: "password"
                };

                mockPG.maybeOne.mockImplementation(async () => null);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/confirm-password-reset`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "confirm-password-reset" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": "id",
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(404);
                expect(res.parsedBody).not.toHaveProperty("success");

                await shutdownHandler();
            });
        });

        describe("With wrong secretCode", () => {
            test("Should return error", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    userId: "id",
                    secretCode: "secret",
                    password: "password"
                };
                const dbUser: User = {
                    id: params.userId,
                    status: UserStatus.enabled,
                    secretCode: "OTHER",
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/confirm-password-reset`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "confirm-password-reset" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(403);
                expect(res.parsedBody).not.toHaveProperty("success");

                await shutdownHandler();
            });
        });

        describe("With wrong password", () => {
            test("Should return error", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    userId: "id",
                    secretCode: "secret",
                    password: ""
                };
                const dbUser: User = {
                    id: params.userId,
                    status: UserStatus.enabled,
                    secretCode: "OTHER",
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/confirm-password-reset`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "confirm-password-reset" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                // from HttpService._checkValidation
                expect(res.status).toStrictEqual(400);
                expect(res.parsedBody).not.toHaveProperty("success");

                await shutdownHandler();
            });
        });
    });

    describe("changeEmail method", () => {
        describe("With right email", () => {
            test("Should return userId", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    email: "example@inbox.com"
                };
                const dbUser: User = {
                    id: "id",
                    email: params.email,
                    status: UserStatus.enabled,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);
                mockPG.maybeOne.mockImplementationOnce(async () => null);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/change-email`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "change-email" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("success", true);

                await shutdownHandler();
            });
        });

        describe("With wrong email", () => {
            test("Should return error", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    email: "example@inbox.com"
                };
                const dbUser: User = {
                    id: "id",
                    email: params.email,
                    status: UserStatus.enabled,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);
                //mockPG.maybeOne.mockImplementationOnce(async () => null);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/change-email`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "change-email" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(409);
                expect(res.parsedBody).not.toHaveProperty("success");

                await shutdownHandler();
            });
        });

        describe("With wrong x-hasura-user-id", () => {
            test("Should return userId", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    email: "example@inbox.com"
                };

                mockPG.maybeOne.mockImplementation(async () => null);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/change-email`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "change-email" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": "WRONG",
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(404);
                expect(res.parsedBody).not.toHaveProperty("success");

                await shutdownHandler();
            });
        });
    });

    describe("confirmChangeEmail method", () => {
        describe("With right x-hasura-user-id and secretCode", () => {
            test("Should return accessToken and set cookie refreshToken", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    secretCode: "secret"
                };
                const dbUser: User = {
                    id: "id",
                    emailNew: "example@inbox.com",
                    status: UserStatus.enabled,
                    secretCode: params.secretCode,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/confirm-change-email`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "confirm-change-email" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("success", true);
                expect(res.parsedBody).toHaveProperty("accessToken");
                expect(res.headers.get("set-cookie").includes("refresh_token")).toBeTruthy();

                await shutdownHandler();
            });
        });

        describe("With wrong userId", () => {
            test("Should return error", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    userId: "id",
                    secretCode: "secret"
                };

                mockPG.maybeOne.mockImplementation(async () => null);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/confirm-change-email`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "confirm-change-email" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": "id",
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(404);
                expect(res.parsedBody).not.toHaveProperty("success");

                await shutdownHandler();
            });
        });

        describe("With wrong secretCode", () => {
            test("Should return error", async () => {
                const authService = new AuthService(CONFIG);
                const shutdownHandler = getLastRegisterShutdownHandler();

                await authService.startService();

                const params = {
                    userId: "id",
                    secretCode: "secret"
                };
                const dbUser: User = {
                    id: params.userId,
                    status: UserStatus.enabled,
                    secretCode: "OTHER",
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/confirm-change-email`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "confirm-change-email" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(403);
                expect(res.parsedBody).not.toHaveProperty("success");

                await shutdownHandler();
            });
        });
    });
});
