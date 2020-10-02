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
import { makeTgHash } from "./helpers";
import { ajax, setProperty } from "@cryptuoso/test-helpers";

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
    let authService: AuthService;
    let shutdownHandler: { (): Promise<any> };

    afterAll(async () => {
        await shutdownHandler();
    });

    describe("Test constructor", () => {
        test("Should not to throw", async () => {
            expect(() => {
                authService = new AuthService(CONFIG);
                shutdownHandler = getLastRegisterShutdownHandler();
            }).not.toThrowError();

            await expect(authService.startService()).resolves.not.toThrowError();
        });
    });

    describe("login method", () => {
        describe("With right email and password", () => {
            test("Should return accessToken and set cookie refreshToken", async () => {
                const params = {
                    email: "example@inbox.com",
                    password: "password"
                };
                const dbUser: User = {
                    id: "id",
                    email: params.email,
                    status: UserStatus.enabled,
                    passwordHash: await bcrypt.hash(params.password, 10),
                    access: 15,
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
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );
                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("accessToken");
                expect(res.headers.get("set-cookie").includes("refresh_token")).toBeTruthy();
            });
        });

        describe("With wrong email", () => {
            test("Should return error", async () => {
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
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );

                expect(res.status).toStrictEqual(404);
            });
        });

        describe("With wrong password", () => {
            test("Should return error", async () => {
                const params = {
                    email: "example@inbox.com",
                    password: "password"
                };
                const dbUser: User = {
                    id: "id",
                    email: params.email,
                    status: UserStatus.enabled,
                    passwordHash: "OTHER",
                    access: 15,
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
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );

                expect(res.status).toStrictEqual(403);
            });
        });
    });

    describe("loginTg method", () => {
        describe("With right telegramId and hash", () => {
            test("Should return accessToken and set cookie refreshToken", async () => {
                const params = {
                    id: 123,
                    // eslint-disable-next-line @typescript-eslint/camelcase
                    auth_date: Date.now(),
                    hash: ""
                };
                params.hash = makeTgHash(params, process.env.BOT_TOKEN);
                const dbUser: User = {
                    id: "id",
                    telegramId: params.id,
                    status: UserStatus.enabled,
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/loginTg`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "loginTg" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("accessToken");
                expect(res.headers.get("set-cookie").includes("refresh_token")).toBeTruthy();
            });
        });

        describe("With new user", () => {
            test("Should create new account and return new tokens", async () => {
                const params = {
                    id: 123,
                    username: "username",
                    // eslint-disable-next-line @typescript-eslint/camelcase
                    auth_date: Date.now(),
                    hash: ""
                };
                params.hash = makeTgHash(params, process.env.BOT_TOKEN);

                mockPG.maybeOne.mockImplementation(async () => null);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/loginTg`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "loginTg" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": "id",
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("accessToken");
                expect(res.headers.get("set-cookie").includes("refresh_token")).toBeTruthy();
            });
        });

        describe("With wrong hash", () => {
            test("Should return error", async () => {
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
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/loginTg`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "loginTg" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": "id",
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(403);
            });
        });
    });

    describe("logout method", () => {
        describe("With any params", () => {
            test("Should clear refreshToken", async () => {
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
                expect(res.headers.get("set-cookie").includes("refresh_token=;")).toBeTruthy();
            });
        });
    });

    describe("register method", () => {
        describe("With unique email", () => {
            test("Should return userId", async () => {
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
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("userId");
            });
        });

        describe("With non-unique email", () => {
            test("Should return error", async () => {
                const params = {
                    email: "example@inbox.com",
                    password: "password",
                    name: "Name"
                };

                const dbUser: User = {
                    id: "id",
                    status: UserStatus.enabled,
                    access: 15,
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
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );

                expect(res.status).toStrictEqual(409);
            });
        });
    });

    describe("refreshToken method", () => {
        describe("With right refreshToken", () => {
            test("Should return accessToken and set cookie refreshToken", async () => {
                const params = {
                    refreshToken: "1"
                };
                const dbUser: User = {
                    id: "id",
                    status: UserStatus.enabled,
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/refreshToken`,
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
                expect(res.parsedBody).toHaveProperty("accessToken");
                expect(res.headers.get("set-cookie").includes("refresh_token")).toBeTruthy();
            });
        });

        describe("With bad refreshToken", () => {
            test("Should return error", async () => {
                const params = {};

                mockPG.maybeOne.mockImplementation(async () => null);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/refreshToken`,
                    {
                        "x-api-key": process.env.API_KEY,
                        "x-refresh-token": "token"
                    },
                    {
                        action: { name: "refreshToken" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": "id",
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(404);
            });
        });
    });

    describe("activateAccount method", () => {
        describe("With right userId and secretCode", () => {
            test("Should return accessToken and set cookie refreshToken", async () => {
                const params = {
                    userId: "id",
                    secretCode: "secret"
                };
                const dbUser: User = {
                    id: params.userId,
                    status: UserStatus.new,
                    secretCode: params.secretCode,
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/activateAccount`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "activateAccount" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("accessToken");
                expect(res.headers.get("set-cookie").includes("refresh_token")).toBeTruthy();
            });
        });

        describe("With wrong userId", () => {
            test("Should return error", async () => {
                const params = {
                    userId: "id",
                    secretCode: "secret"
                };

                mockPG.maybeOne.mockImplementation(async () => null);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/activateAccount`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "activateAccount" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );

                expect(res.status).toStrictEqual(404);
            });
        });

        describe("With wrong secretCode", () => {
            test("Should return error", async () => {
                const params = {
                    userId: "id",
                    secretCode: "secret"
                };
                const dbUser: User = {
                    id: params.userId,
                    status: UserStatus.new,
                    secretCode: "OTHER",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/activateAccount`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "activateAccount" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );

                expect(res.status).toStrictEqual(403);
            });
        });
    });

    describe("passwordReset method", () => {
        describe("With right email", () => {
            test("Should return userId", async () => {
                const params = {
                    email: "example@inbox.com"
                };
                const dbUser: User = {
                    id: "id",
                    email: params.email,
                    status: UserStatus.enabled,
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/passwordReset`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "passwordReset" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("userId", dbUser.id);
            });
        });

        describe("With bad refreshToken", () => {
            test("Should return error", async () => {
                const params = {
                    email: "example@inbox.com"
                };

                mockPG.maybeOne.mockImplementation(async () => null);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/passwordReset`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "passwordReset" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );

                expect(res.status).toStrictEqual(404);
            });
        });
    });

    describe("confirmPasswordReset method", () => {
        describe("With right userId, secretCode and password", () => {
            test("Should return accessToken and set cookie refreshToken", async () => {
                const params = {
                    userId: "id",
                    secretCode: "secret",
                    password: "password"
                };
                const dbUser: User = {
                    id: params.userId,
                    status: UserStatus.enabled,
                    secretCode: params.secretCode,
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/confirmPasswordReset`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "confirmPasswordReset" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("accessToken");
                expect(res.headers.get("set-cookie").includes("refresh_token")).toBeTruthy();
            });
        });

        describe("With wrong userId", () => {
            test("Should return error", async () => {
                const params = {
                    userId: "id",
                    secretCode: "secret",
                    password: "password"
                };

                mockPG.maybeOne.mockImplementation(async () => null);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/confirmPasswordReset`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "confirmPasswordReset" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );

                expect(res.status).toStrictEqual(404);
            });
        });

        describe("With wrong secretCode", () => {
            test("Should return error", async () => {
                const params = {
                    userId: "id",
                    secretCode: "secret",
                    password: "password"
                };
                const dbUser: User = {
                    id: params.userId,
                    status: UserStatus.enabled,
                    secretCode: "OTHER",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/confirmPasswordReset`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "confirmPasswordReset" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );

                expect(res.status).toStrictEqual(403);
            });
        });

        describe("With wrong password", () => {
            test("Should return error", async () => {
                const params = {
                    userId: "id",
                    secretCode: "secret",
                    password: ""
                };
                const dbUser: User = {
                    id: params.userId,
                    status: UserStatus.enabled,
                    secretCode: "OTHER",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/confirmPasswordReset`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "confirmPasswordReset" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-role": UserRoles.anonymous
                        }
                    }
                );

                // from HttpService._checkValidation
                expect(res.status).toStrictEqual(400);
            });
        });
    });

    describe("changeEmail method", () => {
        describe("With right email", () => {
            test("Should return userId", async () => {
                const params = {
                    email: "example@inbox.com"
                };
                const dbUser: User = {
                    id: "id",
                    email: params.email,
                    status: UserStatus.enabled,
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementationOnce(async () => dbUser);
                mockPG.maybeOne.mockImplementationOnce(async () => null);
                mockPG.maybeOne.mockImplementationOnce(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/changeEmail`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "changeEmail" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
            });
        });

        describe("With wrong email", () => {
            test("Should return error", async () => {
                const params = {
                    email: "example@inbox.com"
                };
                const dbUser: User = {
                    id: "id",
                    email: params.email,
                    status: UserStatus.enabled,
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);
                //mockPG.maybeOne.mockImplementationOnce(async () => null);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/changeEmail`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "changeEmail" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(409);
            });
        });

        describe("With wrong x-hasura-user-id", () => {
            test("Should return error response", async () => {
                const userId = "user-id";
                const params = {
                    email: "example@inbox.com"
                };

                mockPG.maybeOne.mockImplementation(async () => null);
                mockPG.maybeOne.mockImplementationOnce(async () => ({
                    id: userId,
                    access: 15,
                    roles: { allowedRoles: [UserRoles.user] }
                }));

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/changeEmail`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "changeEmail" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": "WRONG",
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(404);
            });
        });
    });

    describe("confirmChangeEmail method", () => {
        describe("With right x-hasura-user-id and secretCode", () => {
            test("Should return accessToken and set cookie refreshToken", async () => {
                const params = {
                    secretCode: "secret"
                };
                const dbUser: User = {
                    id: "id",
                    emailNew: "example@inbox.com",
                    status: UserStatus.enabled,
                    secretCode: params.secretCode,
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/confirmChangeEmail`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "confirmChangeEmail" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(200);
                expect(res.parsedBody).toHaveProperty("accessToken");
                expect(res.headers.get("set-cookie").includes("refresh_token")).toBeTruthy();
            });
        });

        describe("With wrong userId", () => {
            test("Should return error", async () => {
                const userId = "user-id";
                const params = {
                    userId: "id",
                    secretCode: "secret"
                };

                mockPG.maybeOne.mockImplementation(async () => null);
                mockPG.maybeOne.mockImplementationOnce(async () => ({
                    id: userId,
                    access: 15,
                    roles: { allowedRoles: [UserRoles.user] }
                }));

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/confirmChangeEmail`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "confirmChangeEmail" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": userId,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(404);
            });
        });

        describe("With wrong secretCode", () => {
            test("Should return error", async () => {
                const params = {
                    userId: "id",
                    secretCode: "secret"
                };
                const dbUser: User = {
                    id: params.userId,
                    status: UserStatus.enabled,
                    secretCode: "OTHER",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings
                };

                mockPG.maybeOne.mockImplementation(async () => dbUser);

                const res = await ajax.post(
                    `http://localhost:${CONFIG.port}/actions/confirmChangeEmail`,
                    { "x-api-key": process.env.API_KEY },
                    {
                        action: { name: "confirmChangeEmail" },
                        input: params,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        session_variables: {
                            "x-hasura-user-id": dbUser.id,
                            "x-hasura-role": UserRoles.user
                        }
                    }
                );

                expect(res.status).toStrictEqual(403);
            });
        });
    });
});
