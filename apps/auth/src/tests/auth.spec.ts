process.env.PGCS = "localhost:5349";
process.env.REFRESH_TOKEN_EXPIRES = "1";
process.env.JWT_SECRET = "secret";
process.env.JWT_TOKEN_EXPIRES = "1";
process.env.BOT_TOKEN = "BOT_TOKEN";

import bcrypt from "bcrypt";
import { User, UserStatus, UserRoles, UserSettings } from "@cryptuoso/user-state";
import { makeTgHash } from "./helpers";
import { Auth } from "../app/auth";
import { pg } from "@cryptuoso/postgres";
import dayjs from "@cryptuoso/dayjs";

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

/*const bcryptUtils = {
    compare: bcrypt.compare,
    hash: bcrypt.hash
};*/

const mockPG = {
    query: pg.query as jest.Mock
};

jest.mock("@cryptuoso/postgres", () => ({
    sql: Object.assign(jest.fn(), { json: jest.fn() }),
    pg: {
        query: jest.fn()
    }
}));
//jest.mock("@cryptuoso/mail");
const mockEvents: any = {
    emit: jest.fn()
};

describe("Test Auth class methods", () => {
    describe("login method", () => {
        describe("With right params provided", () => {
            describe("W/o refreshToken in DB", () => {
                test("Should return object with defined props", async () => {
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
                        settings: userSettings,
                        lastActiveAt: dayjs.utc().toISOString()
                    };
                    const auth = new Auth(mockEvents /* bcryptUtils */);

                    auth._dbGetUserByEmail = jest.fn(async () => dbUser);
                    auth._dbUpdateUserRefreshToken = jest.fn();

                    const result = await auth.login(params);

                    expect(result).toHaveProperty("accessToken");
                    expect(result).toHaveProperty("refreshToken");
                    expect(result).toHaveProperty("refreshTokenExpireAt");
                });
            });
        });

        describe("With valid refreshToken in DB", () => {
            test("Should return object with defined props", async () => {
                const params = {
                    email: "example@inbox.com",
                    password: "password"
                };
                const dbUser: User = {
                    id: "id",
                    email: params.email,
                    status: UserStatus.enabled,
                    passwordHash: await bcrypt.hash(params.password, 10),
                    refreshToken: "48e39a56-ba3a-4009-9d8a-9f23dd071ee2",
                    refreshTokenExpireAt: "2120-08-11T12:50:21.055Z",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserByEmail = jest.fn(async () => dbUser);
                auth._dbUpdateUserRefreshToken = jest.fn();

                const result = await auth.login(params);

                expect(result).toHaveProperty("accessToken");
                expect(result.refreshToken).toStrictEqual(dbUser.refreshToken);
                expect(result.refreshTokenExpireAt).toStrictEqual(dbUser.refreshTokenExpireAt);
            });
        });

        describe("With invalid refreshToken in DB", () => {
            test("Should return object with defined props", async () => {
                const params = {
                    email: "example@inbox.com",
                    password: "password"
                };
                const dbUser: User = {
                    id: "id",
                    email: params.email,
                    status: UserStatus.enabled,
                    passwordHash: await bcrypt.hash(params.password, 10),
                    refreshToken: "48e39a56-ba3a-4009-9d8a-9f23dd071ee2",
                    refreshTokenExpireAt: "1970-08-11T12:50:21.055Z",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserByEmail = jest.fn(async () => dbUser);
                auth._dbUpdateUserRefreshToken = jest.fn();

                const result = await auth.login(params);

                expect(result).toHaveProperty("accessToken");
                expect(result.refreshToken).not.toEqual(dbUser.refreshToken);
                expect(result.refreshTokenExpireAt).not.toEqual(dbUser.refreshTokenExpireAt);
            });
        });

        describe("With wrong params provided", () => {
            describe("With wrong password", () => {
                test("Should to throw error", async () => {
                    const params = {
                        email: "example@inbox.com",
                        password: "password"
                    };
                    const dbUser: User = {
                        id: "id",
                        email: params.email,
                        status: UserStatus.enabled,
                        passwordHash: "wrong hash",
                        access: 15,
                        roles: {
                            defaultRole: UserRoles.user,
                            allowedRoles: [UserRoles.user]
                        },
                        settings: userSettings,
                        lastActiveAt: dayjs.utc().toISOString()
                    };
                    const auth = new Auth(mockEvents /* bcryptUtils */);

                    auth._dbGetUserByEmail = jest.fn(async () => dbUser);
                    auth._dbUpdateUserRefreshToken = jest.fn();

                    await expect(auth.login(params)).rejects.toThrow();
                });
            });

            describe("With user status != enabled", () => {
                test("Should to throw error", async () => {
                    const params = {
                        email: "example@inbox.com",
                        password: "password"
                    };
                    const dbUser: User = {
                        id: "id",
                        email: params.email,
                        status: UserStatus.new,
                        passwordHash: await bcrypt.hash(params.password, 10),
                        access: 15,
                        roles: {
                            defaultRole: UserRoles.user,
                            allowedRoles: [UserRoles.user]
                        },
                        settings: userSettings,
                        lastActiveAt: dayjs.utc().toISOString()
                    };
                    const auth = new Auth(mockEvents /* bcryptUtils */);

                    auth._dbGetUserByEmail = jest.fn(async () => dbUser);
                    auth._dbUpdateUserRefreshToken = jest.fn();

                    await expect(auth.login(params)).rejects.toThrow();
                });
            });

            describe("With not existing email provided", () => {
                test("Should to throw error", async () => {
                    const params = {
                        email: "example@inbox.com",
                        password: "password"
                    };
                    const auth = new Auth(mockEvents /* bcryptUtils */);

                    auth._dbGetUserByEmail = jest.fn(async () => null);
                    auth._dbUpdateUserRefreshToken = jest.fn();

                    await expect(auth.login(params)).rejects.toThrow();
                });
            });
        });
    });

    describe("loginTg method", () => {
        describe("With right params provided", () => {
            describe("With active refreshToken in DB", () => {
                test("Should login and return new accessToken and refreshToken", async () => {
                    const params = {
                        id: 123,
                        username: "username",
                        auth_date: Date.now(),
                        hash: ""
                    };
                    params.hash = makeTgHash(params, process.env.BOT_TOKEN);
                    const dbUser: User = {
                        id: "id",
                        telegramId: params.id,
                        status: UserStatus.enabled,
                        refreshToken: "48e39a56-ba3a-4009-9d8a-9f23dd071ee2",
                        refreshTokenExpireAt: "2120-08-11T12:50:21.055Z",
                        access: 15,
                        roles: {
                            defaultRole: UserRoles.user,
                            allowedRoles: [UserRoles.user]
                        },
                        settings: userSettings,
                        lastActiveAt: dayjs.utc().toISOString()
                    };
                    const auth = new Auth(mockEvents /* bcryptUtils */);

                    auth._dbGetUserTg = jest.fn(async () => dbUser);
                    auth._dbRegisterUserTg = jest.fn();
                    auth._dbUpdateUserRefreshToken = jest.fn();

                    const result = await auth.loginTg(params);

                    expect(result).toHaveProperty("accessToken");
                    expect(result.refreshToken).toStrictEqual(dbUser.refreshToken);
                    expect(result.refreshTokenExpireAt).toStrictEqual(dbUser.refreshTokenExpireAt);
                });
            });

            describe("With inactive refreshToken in DB", () => {
                test("Should login and return new accessToken and old refreshToken", async () => {
                    const params = {
                        id: 123,
                        username: "username",

                        auth_date: Date.now(),
                        hash: ""
                    };
                    params.hash = makeTgHash(params, process.env.BOT_TOKEN);
                    const dbUser: User = {
                        id: "id",
                        telegramId: params.id,
                        status: UserStatus.enabled,
                        refreshToken: "48e39a56-ba3a-4009-9d8a-9f23dd071ee2",
                        refreshTokenExpireAt: "1970-08-11T12:50:21.055Z",
                        access: 15,
                        roles: {
                            defaultRole: UserRoles.user,
                            allowedRoles: [UserRoles.user]
                        },
                        settings: userSettings,
                        lastActiveAt: dayjs.utc().toISOString()
                    };
                    const auth = new Auth(mockEvents /* bcryptUtils */);

                    auth._dbGetUserTg = jest.fn(async () => dbUser);
                    auth._dbRegisterUserTg = jest.fn();
                    auth._dbUpdateUserRefreshToken = jest.fn();

                    const result = await auth.loginTg(params);

                    expect(result).toHaveProperty("accessToken");
                    expect(result.refreshToken).not.toEqual(dbUser.refreshToken);
                    expect(result.refreshTokenExpireAt).not.toEqual(dbUser.refreshTokenExpireAt);
                });
            });

            describe("With all possible parameters provided", () => {
                test("Should login and return new accessToken and old refreshToken", async () => {
                    const params = {
                        id: 123,
                        username: "username",

                        first_name: "first_name",

                        last_name: "last_name",

                        photo_url: "photo_url",

                        auth_date: Date.now(),
                        hash: ""
                    };
                    params.hash = makeTgHash(params, process.env.BOT_TOKEN);
                    const dbUser: User = {
                        id: "id",
                        telegramId: params.id,
                        status: UserStatus.enabled,
                        refreshToken: "48e39a56-ba3a-4009-9d8a-9f23dd071ee2",
                        refreshTokenExpireAt: "1970-08-11T12:50:21.055Z",
                        access: 15,
                        roles: {
                            defaultRole: UserRoles.user,
                            allowedRoles: [UserRoles.user]
                        },
                        settings: userSettings,
                        lastActiveAt: dayjs.utc().toISOString()
                    };
                    const auth = new Auth(mockEvents /* bcryptUtils */);

                    auth._dbGetUserTg = jest.fn(async () => dbUser);
                    auth._dbRegisterUserTg = jest.fn();
                    auth._dbUpdateUserRefreshToken = jest.fn();

                    const result = await auth.loginTg(params);

                    expect(result).toHaveProperty("accessToken");
                    expect(result.refreshToken).not.toEqual(dbUser.refreshToken);
                    expect(result.refreshTokenExpireAt).not.toEqual(dbUser.refreshTokenExpireAt);
                });
            });

            describe("With all possible parameters provided", () => {
                test("Should register and return new accessToken and old refreshToken", async () => {
                    const params = {
                        id: 123,
                        username: "username",

                        first_name: "first_name",

                        last_name: "last_name",

                        photo_url: "photo_url",

                        auth_date: Date.now(),
                        hash: ""
                    };
                    params.hash = makeTgHash(params, process.env.BOT_TOKEN);
                    const auth = new Auth(mockEvents /* bcryptUtils */);

                    auth._dbGetUserTg = jest.fn(async () => null);
                    auth._dbRegisterUserTg = jest.fn();
                    auth._dbUpdateUserRefreshToken = jest.fn();

                    const result = await auth.loginTg(params);

                    const newUser: User = (auth._dbRegisterUserTg as jest.Mock).mock.calls.pop()[0];

                    expect(newUser.telegramId).toStrictEqual(params.id);
                    expect(newUser.telegramUsername).toStrictEqual(params.username);
                    expect(newUser.status).toStrictEqual(UserStatus.enabled);

                    expect(result).toHaveProperty("accessToken");
                    expect(result).toHaveProperty("refreshToken");
                    expect(result).toHaveProperty("refreshTokenExpireAt");
                });
            });
        });

        describe("With wrong params provided", () => {
            describe("With wrong hash", () => {
                test("Should to throw error", async () => {
                    const params = {
                        id: 123,
                        username: "username",

                        auth_date: Date.now(),
                        hash: ""
                    };
                    //params.hash = makeTgHash(params, process.env.BOT_TOKEN);
                    const dbUser: User = {
                        id: "id",
                        telegramId: params.id,
                        status: UserStatus.enabled,
                        refreshToken: "48e39a56-ba3a-4009-9d8a-9f23dd071ee2",
                        refreshTokenExpireAt: "2120-08-11T12:50:21.055Z",
                        access: 15,
                        roles: {
                            defaultRole: UserRoles.user,
                            allowedRoles: [UserRoles.user]
                        },
                        settings: userSettings,
                        lastActiveAt: dayjs.utc().toISOString()
                    };
                    const auth = new Auth(mockEvents /* bcryptUtils */);

                    auth._dbGetUserTg = jest.fn(async () => dbUser);
                    auth._dbRegisterUserTg = jest.fn();
                    auth._dbUpdateUserRefreshToken = jest.fn();

                    await expect(auth.loginTg(params)).rejects.toThrowError();
                });
            });

            describe("With wrong status", () => {
                test("Should to throw error", async () => {
                    const params = {
                        id: 123,
                        username: "username",

                        auth_date: Date.now(),
                        hash: ""
                    };
                    params.hash = makeTgHash(params, process.env.BOT_TOKEN);
                    const dbUser: User = {
                        id: "id",
                        telegramId: params.id,
                        status: UserStatus.blocked,
                        refreshToken: "48e39a56-ba3a-4009-9d8a-9f23dd071ee2",
                        refreshTokenExpireAt: "2120-08-11T12:50:21.055Z",
                        access: 15,
                        roles: {
                            defaultRole: UserRoles.user,
                            allowedRoles: [UserRoles.user]
                        },
                        settings: userSettings,
                        lastActiveAt: dayjs.utc().toISOString()
                    };
                    const auth = new Auth(mockEvents /* bcryptUtils */);

                    auth._dbGetUserTg = jest.fn(async () => dbUser);
                    auth._dbRegisterUserTg = jest.fn();
                    auth._dbUpdateUserRefreshToken = jest.fn();

                    await expect(auth.loginTg(params)).rejects.toThrowError();
                });
            });
        });
    });

    describe("setTelegram method", () => {
        describe("With right params provided", () => {
            describe("W/o same telegramId and right status", () => {
                test("Should update user in DB", async () => {
                    const params = {
                        id: 123,
                        username: "username",

                        auth_date: Date.now(),
                        hash: ""
                    };
                    params.hash = makeTgHash(params, process.env.BOT_TOKEN);
                    const dbUser: User = {
                        id: "id",
                        telegramId: params.id,
                        status: UserStatus.enabled,
                        refreshToken: "48e39a56-ba3a-4009-9d8a-9f23dd071ee2",
                        refreshTokenExpireAt: "2120-08-11T12:50:21.055Z",
                        access: 15,
                        roles: {
                            defaultRole: UserRoles.user,
                            allowedRoles: [UserRoles.user]
                        },
                        settings: userSettings,
                        lastActiveAt: dayjs.utc().toISOString()
                    };
                    const auth = new Auth(mockEvents /* bcryptUtils */);

                    auth._dbGetUserTg = jest.fn(async () => null);
                    auth._dbGetUserById = jest.fn(async () => dbUser);

                    mockPG.query.mockClear();

                    await expect(auth.setTelegram(dbUser, params)).resolves.not.toThrow();

                    expect(mockPG.query).toBeCalled();
                });
            });
        });

        describe("With wrong params provided", () => {
            describe("With wrong hash", () => {
                test("Should to throw error", async () => {
                    const params = {
                        id: 123,
                        username: "username",

                        auth_date: Date.now(),
                        hash: ""
                    };
                    //params.hash = makeTgHash(params, process.env.BOT_TOKEN);
                    const dbUser: User = {
                        id: "id",
                        telegramId: params.id,
                        status: UserStatus.enabled,
                        refreshToken: "48e39a56-ba3a-4009-9d8a-9f23dd071ee2",
                        refreshTokenExpireAt: "2120-08-11T12:50:21.055Z",
                        access: 15,
                        roles: {
                            defaultRole: UserRoles.user,
                            allowedRoles: [UserRoles.user]
                        },
                        settings: userSettings,
                        lastActiveAt: dayjs.utc().toISOString()
                    };
                    const auth = new Auth(mockEvents /* bcryptUtils */);

                    auth._dbGetUserTg = jest.fn(async () => null);
                    auth._dbGetUserById = jest.fn(async () => dbUser);

                    await expect(auth.setTelegram(dbUser, params)).rejects.toThrowError();
                });
            });

            describe("With existing telegramId", () => {
                test("Should to throw error", async () => {
                    const params = {
                        id: 123,
                        username: "username",

                        auth_date: Date.now(),
                        hash: ""
                    };
                    params.hash = makeTgHash(params, process.env.BOT_TOKEN);
                    const dbUser: User = {
                        id: "id",
                        telegramId: params.id,
                        status: UserStatus.blocked,
                        refreshToken: "48e39a56-ba3a-4009-9d8a-9f23dd071ee2",
                        refreshTokenExpireAt: "2120-08-11T12:50:21.055Z",
                        access: 15,
                        roles: {
                            defaultRole: UserRoles.user,
                            allowedRoles: [UserRoles.user]
                        },
                        settings: userSettings,
                        lastActiveAt: dayjs.utc().toISOString()
                    };
                    const auth = new Auth(mockEvents /* bcryptUtils */);

                    auth._dbGetUserTg = jest.fn(async () => dbUser);
                    auth._dbGetUserById = jest.fn(async () => dbUser);

                    await expect(auth.setTelegram(dbUser, params)).rejects.toThrowError();
                });
            });

            describe("With wrong status", () => {
                test("Should to throw error", async () => {
                    const params = {
                        id: 123,
                        username: "username",

                        auth_date: Date.now(),
                        hash: ""
                    };
                    params.hash = makeTgHash(params, process.env.BOT_TOKEN);
                    const dbUser: User = {
                        id: "id",
                        telegramId: params.id,
                        status: UserStatus.blocked,
                        refreshToken: "48e39a56-ba3a-4009-9d8a-9f23dd071ee2",
                        refreshTokenExpireAt: "2120-08-11T12:50:21.055Z",
                        access: 15,
                        roles: {
                            defaultRole: UserRoles.user,
                            allowedRoles: [UserRoles.user]
                        },
                        settings: userSettings,
                        lastActiveAt: dayjs.utc().toISOString()
                    };
                    const auth = new Auth(mockEvents /* bcryptUtils */);

                    auth._dbGetUserTg = jest.fn(async () => null);
                    auth._dbGetUserById = jest.fn(async () => dbUser);

                    await expect(auth.setTelegram(dbUser, params)).rejects.toThrowError();
                });
            });
        });
    });

    describe("register method", () => {
        describe("With non-existing email", () => {
            test("Should create new account", async () => {
                const params = {
                    email: "example@inbox.com",
                    password: "password",
                    name: "Name"
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserByEmail = jest.fn(async () => null);
                auth._dbRegisterUser = jest.fn();

                await expect(auth.register(params)).resolves.toBeDefined();

                const newUser: User = (auth._dbRegisterUser as jest.Mock).mock.calls.pop()[0];

                expect(params.email).toStrictEqual(newUser.email);
                expect(params.name).toStrictEqual(newUser.name);
                expect(await bcrypt.compare(params.password, newUser.passwordHash)).toBeTruthy();
            });
        });

        describe("With existing email", () => {
            test("Should to throw error", async () => {
                const params = {
                    email: "example@inbox.com",
                    password: "password",
                    name: "Name"
                };
                const dbUser: User = {
                    id: "id",
                    email: params.email,
                    status: UserStatus.new,
                    passwordHash: await bcrypt.hash(params.password, 10),
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserByEmail = jest.fn(async () => dbUser);
                auth._dbRegisterUser = jest.fn();

                await expect(auth.register(params)).rejects.toThrowError();
            });
        });
    });

    describe("refreshToken method", () => {
        describe("With active token", () => {
            test("Should create new access token", async () => {
                const params = {
                    refreshToken: "token"
                };
                const dbUser: User = {
                    id: "id",
                    email: "example@inbox.com",
                    status: UserStatus.enabled,
                    passwordHash: "password",
                    refreshToken: "token",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserByToken = jest.fn(async () => dbUser);

                const result = await auth.refreshToken(params);

                expect(result).toHaveProperty("accessToken");
                expect(result.refreshToken).toStrictEqual(dbUser.refreshToken);
                expect(result.refreshTokenExpireAt).toStrictEqual(dbUser.refreshTokenExpireAt);
            });
        });

        describe("With inactive token", () => {
            test("Should to throw error", async () => {
                const params = {
                    refreshToken: "token"
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserByToken = jest.fn(async () => null);

                await expect(auth.refreshToken(params)).rejects.toThrowError();
            });
        });

        describe("With status != enabled", () => {
            test("Should to throw error", async () => {
                const params = {
                    refreshToken: "token"
                };
                const dbUser: User = {
                    id: "id",
                    email: "example@inbox.com",
                    status: UserStatus.blocked,
                    passwordHash: "password",
                    refreshToken: "token",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserByToken = jest.fn(async () => dbUser);

                await expect(auth.refreshToken(params)).rejects.toThrowError();
            });
        });
    });

    describe("activateAccount method", () => {
        describe("With existing id and right secretCode", () => {
            test("Should create new access token", async () => {
                const params = {
                    userId: "id",
                    secretCode: "code"
                };
                const dbUser: User = {
                    id: params.userId,
                    email: "example@inbox.com",
                    status: UserStatus.new,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: params.secretCode,
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserById = jest.fn(async () => dbUser);
                auth._dbActivateUser = jest.fn();

                const result = await auth.activateAccount(params);

                expect(result).toHaveProperty("accessToken");
                expect(result).toHaveProperty("refreshToken");
                expect(result).toHaveProperty("refreshTokenExpireAt");
            });
        });

        describe("With existing id and wrong secretCode", () => {
            test("Should to throw error", async () => {
                const params = {
                    userId: "id",
                    secretCode: "code"
                };
                const dbUser: User = {
                    id: params.userId,
                    email: "example@inbox.com",
                    status: UserStatus.new,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: "OTHER",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserById = jest.fn(async () => dbUser);
                auth._dbActivateUser = jest.fn();

                await expect(auth.activateAccount(params)).rejects.toThrowError();
            });
        });

        describe("With status != new", () => {
            test("Should to throw error", async () => {
                const params = {
                    userId: "id",
                    secretCode: "code"
                };
                const dbUser: User = {
                    id: params.userId,
                    email: "example@inbox.com",
                    status: UserStatus.blocked,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: "code",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserById = jest.fn(async () => dbUser);
                auth._dbActivateUser = jest.fn();

                await expect(auth.activateAccount(params)).rejects.toThrowError();
            });
        });

        describe("With bad userId", () => {
            test("Should to throw error", async () => {
                const params = {
                    userId: "bad-id",
                    secretCode: "code"
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserById = jest.fn(async () => null);
                auth._dbActivateUser = jest.fn();

                await expect(auth.activateAccount(params)).rejects.toThrowError();
            });
        });
    });

    describe("changePassword method", () => {
        describe("W/o user passwordHash and oldPassword parameter", () => {
            test("Should change password hash in DB", async () => {
                const params = {
                    password: "pass"
                };

                const dbUser: User = {
                    id: "id",
                    status: UserStatus.new,
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserById = jest.fn(async () => dbUser);
                auth._dbChangeUserPassword = jest.fn();

                await expect(auth.changePassword(dbUser, params)).resolves.not.toThrow();
                expect(auth._dbChangeUserPassword).toBeCalled();

                const args = (auth._dbChangeUserPassword as jest.Mock).mock.calls[0][0];

                expect(args.userId).toBe(dbUser.id);
                expect(await bcrypt.compare(params.password, args.passwordHash)).toBeTruthy();
            });
        });

        describe("With passwordHash but w/o oldPassword parameter", () => {
            test("Should to throw error", async () => {
                const params = {
                    password: "pass"
                };

                const dbUser: User = {
                    id: "id",
                    status: UserStatus.enabled,
                    passwordHash: "hash",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserById = jest.fn(async () => dbUser);
                auth._dbChangeUserPassword = jest.fn();

                await expect(auth.changePassword(dbUser, params)).rejects.toThrow();
            });
        });

        describe("With right passwordHash", () => {
            test("Should change password hash in DB", async () => {
                const params = {
                    password: "pass",
                    oldPassword: "oldPass"
                };

                const dbUser: User = {
                    id: "id",
                    status: UserStatus.enabled,
                    passwordHash: await bcrypt.hash(params.oldPassword, 10),
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserById = jest.fn(async () => dbUser);
                auth._dbChangeUserPassword = jest.fn();

                await expect(auth.changePassword(dbUser, params)).resolves.not.toThrow();
                expect(auth._dbChangeUserPassword).toBeCalled();

                const args = (auth._dbChangeUserPassword as jest.Mock).mock.calls[0][0];

                expect(args.userId).toBe(dbUser.id);
                expect(await bcrypt.compare(params.password, args.passwordHash)).toBeTruthy();
            });
        });

        describe("With wrong passwordHash", () => {
            test("Should to throw error", async () => {
                const params = {
                    password: "pass",
                    oldPassword: "oldPass"
                };

                const dbUser: User = {
                    id: "id",
                    status: UserStatus.enabled,
                    passwordHash: "wrong",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserById = jest.fn(async () => dbUser);
                auth._dbChangeUserPassword = jest.fn();

                await expect(auth.changePassword(dbUser, params)).rejects.toThrow();
            });
        });
    });

    describe("passwordReset method", () => {
        describe("With existing email", () => {
            test("Should prepare DB data and return userId", async () => {
                const params = {
                    email: "example@inbox.com"
                };
                const dbUser: User = {
                    id: "id",
                    email: params.email,
                    status: UserStatus.new,
                    passwordHash: "hash",
                    refreshToken: "token",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserByEmail = jest.fn(async () => dbUser);

                await expect(auth.passwordReset(params)).resolves.toStrictEqual(dbUser.id);
            });
        });

        describe("With existing email and blocked status", () => {
            test("Should to throw error", async () => {
                const params = {
                    email: "example@inbox.com"
                };
                const dbUser: User = {
                    id: "id",
                    email: params.email,
                    status: UserStatus.blocked,
                    passwordHash: "hash",
                    refreshToken: "token",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserByEmail = jest.fn(async () => dbUser);

                await expect(auth.passwordReset(params)).rejects.toThrowError();
            });
        });

        describe("With not existing email", () => {
            test("Should to throw error", async () => {
                const params = {
                    email: "example@inbox.com"
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserByEmail = jest.fn(async () => null);

                await expect(auth.passwordReset(params)).rejects.toThrowError();
            });
        });
    });

    describe("confirmPasswordReset method", () => {
        describe("With right data", () => {
            test("Should update DB data and return new access token", async () => {
                const params = {
                    userId: "id",
                    secretCode: "code",
                    password: "password"
                };
                const dbUser: User = {
                    id: params.userId,
                    email: "example@inbox.com",
                    status: UserStatus.enabled,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: params.secretCode,
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserById = jest.fn(async () => dbUser);
                auth._dbUpdateUserPassword = jest.fn();

                const result = await auth.confirmPasswordReset(params);

                expect(result).toHaveProperty("accessToken");
                expect(result).toHaveProperty("refreshToken");
                expect(result).toHaveProperty("refreshTokenExpireAt");
            });
        });

        describe("With existing email and wrong secret code", () => {
            test("Should to throw error", async () => {
                const params = {
                    userId: "id",
                    secretCode: "code",
                    password: "password"
                };
                const dbUser: User = {
                    id: "id",
                    email: "example@inbox.com",
                    status: UserStatus.blocked,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: "OTHER",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserById = jest.fn(async () => dbUser);
                auth._dbUpdateUserPassword = jest.fn();

                await expect(auth.confirmPasswordReset(params)).rejects.toThrowError();
            });
        });

        describe("With not existing email", () => {
            test("Should to throw error", async () => {
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserById = jest.fn(async () => null);
                auth._dbUpdateUserPassword = jest.fn();

                const params = {
                    userId: "id",
                    secretCode: "code",
                    password: "password"
                };

                expect(auth.confirmPasswordReset(params)).rejects.toThrowError();
            });
        });
    });

    describe("changeEmail method", () => {
        describe("With right data and unique email", () => {
            test("Should prepare DB data and return success object", async () => {
                const params = {
                    email: "new@inbox.com",
                    userId: "id"
                };
                const dbUser: User = {
                    id: params.userId,
                    email: "example@inbox.com",
                    status: UserStatus.enabled,
                    passwordHash: "hash",
                    refreshToken: "token",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserByEmail = jest.fn(async () => null);
                auth._dbGetUserById = jest.fn(async () => dbUser);
                auth._dbChangeUserEmail = jest.fn();

                await expect(auth.changeEmail(params)).resolves.not.toThrowError();
            });
        });

        describe("With unique email and with invalid id", () => {
            test("Should to throw error", async () => {
                const params = {
                    email: "new@inbox.com",
                    userId: "id"
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserByEmail = jest.fn(async () => null);
                auth._dbGetUserById = jest.fn(async () => null);
                auth._dbChangeUserEmail = jest.fn();

                await expect(auth.changeEmail(params)).rejects.toThrowError();
            });
        });

        describe("With non-unique email", () => {
            test("Should to throw error", async () => {
                const params = {
                    email: "new@inbox.com",
                    userId: "id"
                };
                const dbUser: User = {
                    id: params.userId,
                    email: "example@inbox.com",
                    status: UserStatus.enabled,
                    passwordHash: "hash",
                    refreshToken: "token",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserByEmail = jest.fn(async () => dbUser);
                auth._dbGetUserById = jest.fn(async () => dbUser);
                auth._dbChangeUserEmail = jest.fn();

                await expect(auth.changeEmail(params)).rejects.toThrowError();
            });
        });

        describe("With right data and wrong status", () => {
            test("Should prepare DB data and return success object", async () => {
                const params = {
                    email: "new@inbox.com",
                    userId: "id"
                };
                const dbUser: User = {
                    id: params.userId,
                    email: "example@inbox.com",
                    status: UserStatus.blocked,
                    passwordHash: "hash",
                    refreshToken: "token",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserByEmail = jest.fn(async () => null);
                auth._dbGetUserById = jest.fn(async () => dbUser);
                auth._dbChangeUserEmail = jest.fn();

                await expect(auth.changeEmail(params)).rejects.toThrowError();
            });
        });
    });

    describe("confirmChangeEmail method", () => {
        describe("With right data", () => {
            test("Should prepare DB data and return success object", async () => {
                const params = {
                    secretCode: "code",
                    userId: "id"
                };
                const dbUser: User = {
                    id: params.userId,
                    email: "example@inbox.com",
                    emailNew: "new@inbox.com",
                    status: UserStatus.enabled,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: params.secretCode,
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserById = jest.fn(async () => dbUser);
                auth._dbConfirmChangeUserEmail = jest.fn();

                const result = await auth.confirmChangeEmail(params);

                expect(result).toHaveProperty("accessToken");
                expect(result).toHaveProperty("refreshToken");
                expect(result).toHaveProperty("refreshTokenExpireAt");
            });
        });

        describe("W/o changeMail calling (w/o emailNew)", () => {
            test("Should to throw error", async () => {
                const params = {
                    secretCode: "code",
                    userId: "id"
                };
                const dbUser: User = {
                    id: params.userId,
                    email: "example@inbox.com",
                    /* emailNew: "new@inbox.com", */
                    status: UserStatus.enabled,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: params.secretCode,
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserById = jest.fn(async () => dbUser);
                auth._dbConfirmChangeUserEmail = jest.fn();

                await expect(auth.confirmChangeEmail(params)).rejects.toThrowError();
            });
        });

        describe("With wrong secret code", () => {
            test("Should to throw error", async () => {
                const params = {
                    secretCode: "code",
                    userId: "id"
                };
                const dbUser: User = {
                    id: params.userId,
                    email: "example@inbox.com",
                    emailNew: "new@inbox.com",
                    status: UserStatus.enabled,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: "OTHER",
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserById = jest.fn(async () => dbUser);
                auth._dbConfirmChangeUserEmail = jest.fn();

                await expect(auth.confirmChangeEmail(params)).rejects.toThrowError();
            });
        });

        describe("With wrong status", () => {
            test("Should to throw error", async () => {
                const params = {
                    secretCode: "code",
                    userId: "id"
                };
                const dbUser: User = {
                    id: params.userId,
                    email: "example@inbox.com",
                    emailNew: "new@inbox.com",
                    status: UserStatus.blocked,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: params.secretCode,
                    access: 15,
                    roles: {
                        defaultRole: UserRoles.user,
                        allowedRoles: [UserRoles.user]
                    },
                    settings: userSettings,
                    lastActiveAt: dayjs.utc().toISOString()
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserById = jest.fn(async () => dbUser);
                auth._dbConfirmChangeUserEmail = jest.fn();

                await expect(auth.confirmChangeEmail(params)).rejects.toThrowError();
            });
        });

        describe("With right data and wrong status", () => {
            test("Should prepare DB data and return success object", async () => {
                const params = {
                    secretCode: "code",
                    userId: "id"
                };
                const auth = new Auth(mockEvents /* bcryptUtils */);

                auth._dbGetUserById = jest.fn(async () => null);
                auth._dbConfirmChangeUserEmail = jest.fn();

                await expect(auth.confirmChangeEmail(params)).rejects.toThrowError();
            });
        });
    });
});
