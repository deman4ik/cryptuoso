import bcrypt from "bcrypt";
import { UserState } from "@cryptuoso/user-state";
import { makeTgHash } from "../app/auth-helper";
import { Auth } from "../app/auth";

const UserSettings: UserState.UserSettings = {
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
}

process.env.REFRESH_TOKEN_EXPIRES = "1";
process.env.JWT_SECRET = "secret";
process.env.JWT_TOKEN_EXPIRES = "1";
process.env.BOT_TOKEN = "BOT_TOKEN";

describe("Test Auth class methods", () => {
    describe("login method", () => {
        describe("With right params provided", () => {
            describe("W/o refreshToken in DB", () => {
                test("Should return object with defined props", async () => {
                    const params = {
                        email: "example@inbox.com",
                        password: "password"
                    };
                    const dbUser: UserState.User = {
                        id: "123",
                        email: params.email,
                        status: UserState.UserStatus.enabled,
                        passwordHash: await bcrypt.hash(params.password, 10),
                        roles: {
                            defaultRole: UserState.UserRoles.user,
                            allowedRoles: [UserState.UserRoles.user]
                        },
                        settings: UserSettings
                    };
                    const auth = new Auth({
                        getUserByEmail: jest.fn(async () => dbUser),
                        updateUserRefreshToken: jest.fn()
                    } as any);
    
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
                const dbUser: UserState.User = {
                    id: "123",
                    email: params.email,
                    status: UserState.UserStatus.enabled,
                    passwordHash: await bcrypt.hash(params.password, 10),
                    refreshToken: '48e39a56-ba3a-4009-9d8a-9f23dd071ee2',
                    refreshTokenExpireAt: '2120-08-11T12:50:21.055Z',
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserByEmail: jest.fn(async () => dbUser),
                    updateUserRefreshToken: jest.fn()
                } as any);

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
                const dbUser: UserState.User = {
                    id: "123",
                    email: params.email,
                    status: UserState.UserStatus.enabled,
                    passwordHash: await bcrypt.hash(params.password, 10),
                    refreshToken: '48e39a56-ba3a-4009-9d8a-9f23dd071ee2',
                    refreshTokenExpireAt: '1970-08-11T12:50:21.055Z',
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserByEmail: jest.fn(async () => dbUser),
                    updateUserRefreshToken: jest.fn()
                } as any);

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
                    const dbUser: UserState.User = {
                        id: "123",
                        email: params.email,
                        status: UserState.UserStatus.enabled,
                        passwordHash: "wrong hash",
                        roles: {
                            defaultRole: UserState.UserRoles.user,
                            allowedRoles: [UserState.UserRoles.user]
                        },
                        settings: UserSettings
                    };
                    const auth = new Auth({
                        getUserByEmail: jest.fn(async () => dbUser),
                        updateUserRefreshToken: jest.fn()
                    } as any);

                    await expect(auth.login(params)).rejects.toThrow();
                });
            });
            
            describe("With user status != enabled", () => {
                test("Should to throw error", async () => {
                    const params = {
                        email: "example@inbox.com",
                        password: "password"
                    };
                    const dbUser: UserState.User = {
                        id: "123",
                        email: params.email,
                        status: UserState.UserStatus.new,
                        passwordHash: await bcrypt.hash(params.password, 10),
                        roles: {
                            defaultRole: UserState.UserRoles.user,
                            allowedRoles: [UserState.UserRoles.user]
                        },
                        settings: UserSettings
                    };
                    const auth = new Auth({
                        getUserByEmail: jest.fn(async () => dbUser),
                        updateUserRefreshToken: jest.fn()
                    } as any);

                    await expect(auth.login(params)).rejects.toThrow();
                });
            });
            
            describe("With not existing email provided", () => {
                test("Should to throw error", async () => {
                    const params = {
                        email: "example@inbox.com",
                        password: "password"
                    };
                    const auth = new Auth({
                        getUserByEmail: jest.fn(async () => null),
                        updateUserRefreshToken: jest.fn()
                    } as any);

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
                    params.hash = await makeTgHash(params, process.env.BOT_TOKEN);
                    const dbUser: UserState.User = {
                        id: "uuid",
                        telegramId: params.id,
                        status: UserState.UserStatus.enabled,
                        refreshToken: '48e39a56-ba3a-4009-9d8a-9f23dd071ee2',
                        refreshTokenExpireAt: '2120-08-11T12:50:21.055Z',
                        roles: {
                            defaultRole: UserState.UserRoles.user,
                            allowedRoles: [UserState.UserRoles.user]
                        },
                        settings: UserSettings
                    };
                    const auth = new Auth({
                        getUserTg: jest.fn(async () => dbUser),
                        registerUserTg: jest.fn(),
                        updateUserRefreshToken: jest.fn()
                    } as any);

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
                    params.hash = await makeTgHash(params, process.env.BOT_TOKEN);
                    const dbUser: UserState.User = {
                        id: "uuid",
                        telegramId: params.id,
                        status: UserState.UserStatus.enabled,
                        refreshToken: '48e39a56-ba3a-4009-9d8a-9f23dd071ee2',
                        refreshTokenExpireAt: '1970-08-11T12:50:21.055Z',
                        roles: {
                            defaultRole: UserState.UserRoles.user,
                            allowedRoles: [UserState.UserRoles.user]
                        },
                        settings: UserSettings
                    };
                    const auth = new Auth({
                        getUserTg: jest.fn(async () => dbUser),
                        registerUserTg: jest.fn(),
                        updateUserRefreshToken: jest.fn()
                    } as any);

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
                    params.hash = await makeTgHash(params, process.env.BOT_TOKEN);
                    const dbUser: UserState.User = {
                        id: "uuid",
                        telegramId: params.id,
                        status: UserState.UserStatus.enabled,
                        refreshToken: '48e39a56-ba3a-4009-9d8a-9f23dd071ee2',
                        refreshTokenExpireAt: '1970-08-11T12:50:21.055Z',
                        roles: {
                            defaultRole: UserState.UserRoles.user,
                            allowedRoles: [UserState.UserRoles.user]
                        },
                        settings: UserSettings
                    };
                    const auth = new Auth({
                        getUserTg: jest.fn(async () => dbUser),
                        registerUserTg: jest.fn(),
                        updateUserRefreshToken: jest.fn()
                    } as any);

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
                    params.hash = await makeTgHash(params, process.env.BOT_TOKEN);
                    const dbf = {
                        getUserTg: jest.fn(async () => null),
                        registerUserTg: jest.fn(),
                        updateUserRefreshToken: jest.fn()
                    };
                    const auth = new Auth(dbf as any);

                    const result = await auth.loginTg(params);

                    const newUser: UserState.User = dbf.registerUserTg.mock.calls.pop()[0];

                    expect(newUser.telegramId).toStrictEqual(params.id);
                    expect(newUser.telegramUsername).toStrictEqual(params.username);
                    expect(newUser.status).toStrictEqual(UserState.UserStatus.enabled);

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
                    //params.hash = await makeTgHash(params, process.env.BOT_TOKEN);
                    const dbUser: UserState.User = {
                        id: "uuid",
                        telegramId: params.id,
                        status: UserState.UserStatus.enabled,
                        refreshToken: '48e39a56-ba3a-4009-9d8a-9f23dd071ee2',
                        refreshTokenExpireAt: '2120-08-11T12:50:21.055Z',
                        roles: {
                            defaultRole: UserState.UserRoles.user,
                            allowedRoles: [UserState.UserRoles.user]
                        },
                        settings: UserSettings
                    };
                    const auth = new Auth({
                        getUserTg: jest.fn(async () => dbUser),
                        registerUserTg: jest.fn(),
                        updateUserRefreshToken: jest.fn()
                    } as any);
                    
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
                    params.hash = await makeTgHash(params, process.env.BOT_TOKEN);
                    const dbUser: UserState.User = {
                        id: "uuid",
                        telegramId: params.id,
                        status: UserState.UserStatus.blocked,
                        refreshToken: '48e39a56-ba3a-4009-9d8a-9f23dd071ee2',
                        refreshTokenExpireAt: '2120-08-11T12:50:21.055Z',
                        roles: {
                            defaultRole: UserState.UserRoles.user,
                            allowedRoles: [UserState.UserRoles.user]
                        },
                        settings: UserSettings
                    };
                    const auth = new Auth({
                        getUserTg: jest.fn(async () => dbUser),
                        registerUserTg: jest.fn(),
                        updateUserRefreshToken: jest.fn()
                    } as any);
                    
                    await expect(auth.loginTg(params)).rejects.toThrowError();
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
                const dbf = {
                    getUserByEmail: jest.fn(async () => null),
                    registerUser: jest.fn()
                };
                const auth = new Auth(dbf as any);

                await expect(auth.register(params)).resolves.toBeDefined();
                
                const newUser: UserState.User = dbf.registerUser.mock.calls.pop()[0];

                expect(params.email).toStrictEqual(newUser.email);
                expect(params.name).toStrictEqual(newUser.name);
                expect(
                    await bcrypt.compare(params.password, newUser.passwordHash)
                ).toBeTruthy();
            });
        });
        
        describe("With existing email", () => {
            test("Should to throw error", async () => {
                const params = {
                    email: "example@inbox.com",
                    password: "password",
                    name: "Name"
                };
                const dbUser: UserState.User = {
                    id: "123",
                    email: params.email,
                    status: UserState.UserStatus.new,
                    passwordHash: await bcrypt.hash(params.password, 10),
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserByEmail: jest.fn(async () => dbUser),
                    registerUser: jest.fn()
                } as any);

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
                const dbUser: UserState.User = {
                    id: "id",
                    email: "example@inbox.com",
                    status: UserState.UserStatus.enabled,
                    passwordHash: "pass",
                    refreshToken: "token",
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserByToken: jest.fn(async () => dbUser)
                } as any);

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
                const auth = new Auth({
                    getUserByToken: jest.fn(async () => null)
                } as any);

                await expect(auth.refreshToken(params)).rejects.toThrowError();
            });
        });
        
        describe("With status != enabled", () => {
            test("Should to throw error", async () => {
                const params = {
                    refreshToken: "token"
                };
                const dbUser: UserState.User = {
                    id: "id",
                    email: "example@inbox.com",
                    status: UserState.UserStatus.blocked,
                    passwordHash: "pass",
                    refreshToken: "token",
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserByToken: jest.fn(async () => dbUser)
                } as any);

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
                const dbUser: UserState.User = {
                    id: params.userId,
                    email: "example@inbox.com",
                    status: UserState.UserStatus.new,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: params.secretCode,
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserById: jest.fn(async () => dbUser),
                    activateUser: jest.fn()
                } as any);

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
                const dbUser: UserState.User = {
                    id: params.userId,
                    email: "example@inbox.com",
                    status: UserState.UserStatus.new,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: "OTHER",
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserById: jest.fn(async () => dbUser),
                    activateUser: jest.fn()
                } as any);

                await expect(auth.activateAccount(params)).rejects.toThrowError();
            });
        });

        describe("With status != new", () => {
            test("Should to throw error", async () => {
                const params = {
                    userId: "id",
                    secretCode: "code"
                };
                const dbUser: UserState.User = {
                    id: params.userId,
                    email: "example@inbox.com",
                    status: UserState.UserStatus.blocked,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: "code",
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserById: jest.fn(async () => dbUser),
                    activateUser: jest.fn()
                } as any);

                await expect(auth.activateAccount(params)).rejects.toThrowError();
            });
        });

        describe("With bad userId", () => {
            test("Should to throw error", async () => {
                const params = {
                    userId: "bad-id",
                    secretCode: "code"
                };
                const auth = new Auth({
                    getUserById: jest.fn(async () => null),
                    activateUser: jest.fn()
                } as any);

                await expect(auth.activateAccount(params)).rejects.toThrowError();
            });
        });
    });

    
    describe("passwordReset method", () => {
        describe("With existing email", () => {
            test("Should prepare DB data and return userId", async () => {
                const params = {
                    email: "example@inbox.com"
                };
                const dbUser: UserState.User = {
                    id: "id",
                    email: params.email,
                    status: UserState.UserStatus.new,
                    passwordHash: "hash",
                    refreshToken: "token",
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserByEmail: jest.fn(async () => dbUser)
                } as any);

                await expect(auth.passwordReset(params)).resolves.toStrictEqual(dbUser.id);
            });
        });

        describe("With existing email and blocked status", () => {
            test("Should to throw error", async () => {
                const params = {
                    email: "example@inbox.com"
                };
                const dbUser: UserState.User = {
                    id: "id",
                    email: params.email,
                    status: UserState.UserStatus.blocked,
                    passwordHash: "hash",
                    refreshToken: "token",
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserByEmail: jest.fn(async () => dbUser)
                } as any);

                await expect(auth.passwordReset(params)).rejects.toThrowError();
            });
        });

        describe("With not existing email", () => {
            test("Should to throw error", async () => {
                const params = {
                    email: "example@inbox.com"
                };
                const auth = new Auth({
                    getUserByEmail: jest.fn(async () => null)
                } as any);

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
                    password: "pass"
                };
                const dbUser: UserState.User = {
                    id: params.userId,
                    email: "example@inbox.com",
                    status: UserState.UserStatus.enabled,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: params.secretCode,
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserById: jest.fn(async () => dbUser),
                    updateUserPassword: jest.fn()
                } as any);

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
                    password: "pass"
                };
                const dbUser: UserState.User = {
                    id: "id",
                    email: "example@inbox.com",
                    status: UserState.UserStatus.blocked,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: "OTHER",
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserById: jest.fn(async () => dbUser),
                    updateUserPassword: jest.fn()
                } as any);

                await expect(auth.confirmPasswordReset(params)).rejects.toThrowError();
            });
        });

        describe("With not existing email", () => {
            test("Should to throw error", async () => {
                const auth = new Auth({
                    getUserById: jest.fn(async () => null),
                    updateUserPassword: jest.fn()
                } as any);
                const params = {
                    userId: "id",
                    secretCode: "code",
                    password: "pass"
                };

                expect(auth.confirmPasswordReset(params)).rejects.toThrowError();
            });
        });
    });

    
    describe("changeEmail method", () => {
        describe("With right data and unique email", () => {
            test("Should prepare DB data and return success object", async () => {
                const params = {
                    email: "new@inbox.com"
                };
                const session_variables = {
                    "x-hasura-user-id": "id"
                };
                const dbUser: UserState.User = {
                    id: session_variables["x-hasura-user-id"],
                    email: "example@inbox.com",
                    status: UserState.UserStatus.enabled,
                    passwordHash: "hash",
                    refreshToken: "token",
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserByEmail: jest.fn(async () => null),
                    getUserById: jest.fn(async () => dbUser),
                    changeUserEmail: jest.fn()
                } as any);

                await expect(auth.changeEmail(params, session_variables)).resolves
                    .toStrictEqual({ success: true });
            });
        });

        describe("With unique email and with invalid id", () => {
            test("Should to throw error", async () => {
                const params = {
                    email: "new@inbox.com"
                };
                const session_variables = {
                    "x-hasura-user-id": "id"
                };
                const auth = new Auth({
                    getUserByEmail: jest.fn(async () => null),
                    getUserById: jest.fn(async () => null),
                    changeUserEmail: jest.fn()
                } as any);

                await expect(auth.changeEmail(params, session_variables))
                    .rejects.toThrowError();
            });
        });

        describe("With non-unique email", () => {
            test("Should to throw error", async () => {
                const params = {
                    email: "new@inbox.com"
                };
                const session_variables = {
                    "x-hasura-user-id": "id"
                };
                const dbUser: UserState.User = {
                    id: session_variables["x-hasura-user-id"],
                    email: "example@inbox.com",
                    status: UserState.UserStatus.enabled,
                    passwordHash: "hash",
                    refreshToken: "token",
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserByEmail: jest.fn(async () => dbUser),
                    getUserById: jest.fn(async () => dbUser),
                    changeUserEmail: jest.fn()
                } as any);

                await expect(auth.changeEmail(params, session_variables))
                    .rejects.toThrowError();
            });
        });
        
        describe("With right data and wrong status", () => {
            test("Should prepare DB data and return success object", async () => {
                const params = {
                    email: "new@inbox.com"
                };
                const session_variables = {
                    "x-hasura-user-id": "id"
                };
                const dbUser: UserState.User = {
                    id: session_variables["x-hasura-user-id"],
                    email: "example@inbox.com",
                    status: UserState.UserStatus.blocked,
                    passwordHash: "hash",
                    refreshToken: "token",
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserByEmail: jest.fn(async () => null),
                    getUserById: jest.fn(async () => dbUser),
                    changeUserEmail: jest.fn()
                } as any);

                await expect(auth.changeEmail(params, session_variables))
                    .rejects.toThrowError();
            });
        });
    });

    
    describe("confirmChangeEmail method", () => {
        describe("With right data", () => {
            test("Should prepare DB data and return success object", async () => {
                const params = {
                    secretCode: "code"
                };
                const session_variables = {
                    "x-hasura-user-id": "id"
                };
                const dbUser: UserState.User = {
                    id: session_variables["x-hasura-user-id"],
                    email: "example@inbox.com",
                    emailNew: "new@inbox.com",
                    status: UserState.UserStatus.enabled,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: params.secretCode,
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserById: jest.fn(async () => dbUser),
                    confirmChangeUserEmail: jest.fn()
                } as any);

                const result = await auth.confirmChangeEmail(params, session_variables)

                expect(result).toHaveProperty("accessToken");
                expect(result).toHaveProperty("refreshToken");
                expect(result).toHaveProperty("refreshTokenExpireAt");
            });
        });

        describe("W/o changeMail calling (w/o emailNew)", () => {
            test("Should to throw error", async () => {
                const params = {
                    secretCode: "code"
                };
                const session_variables = {
                    "x-hasura-user-id": "id"
                };
                const dbUser: UserState.User = {
                    id: session_variables["x-hasura-user-id"],
                    email: "example@inbox.com",
                    /* emailNew: "new@inbox.com", */
                    status: UserState.UserStatus.enabled,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: params.secretCode,
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserById: jest.fn(async () => dbUser),
                    confirmChangeUserEmail: jest.fn()
                } as any);

                await expect(auth.confirmChangeEmail(params, session_variables))
                    .rejects.toThrowError();
            });
        });

        describe("With wrong secret code", () => {
            test("Should to throw error", async () => {
                const params = {
                    secretCode: "code"
                };
                const session_variables = {
                    "x-hasura-user-id": "id"
                };
                const dbUser: UserState.User = {
                    id: session_variables["x-hasura-user-id"],
                    email: "example@inbox.com",
                    emailNew: "new@inbox.com",
                    status: UserState.UserStatus.enabled,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: "OTHER",
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserById: jest.fn(async () => dbUser),
                    confirmChangeUserEmail: jest.fn()
                } as any);

                await expect(auth.confirmChangeEmail(params, session_variables))
                    .rejects.toThrowError();
            });
        });

        describe("With wrong status", () => {
            test("Should to throw error", async () => {
                const params = {
                    secretCode: "code"
                };
                const session_variables = {
                    "x-hasura-user-id": "id"
                };
                const dbUser: UserState.User = {
                    id: session_variables["x-hasura-user-id"],
                    email: "example@inbox.com",
                    emailNew: "new@inbox.com",
                    status: UserState.UserStatus.blocked,
                    passwordHash: "hash",
                    refreshToken: "token",
                    secretCode: params.secretCode,
                    roles: {
                        defaultRole: UserState.UserRoles.user,
                        allowedRoles: [UserState.UserRoles.user]
                    },
                    settings: UserSettings
                };
                const auth = new Auth({
                    getUserById: jest.fn(async () => dbUser),
                    confirmChangeUserEmail: jest.fn()
                } as any);

                await expect(auth.confirmChangeEmail(params, session_variables))
                    .rejects.toThrowError();
            });
        });
        
        describe("With right data and wrong status", () => {
            test("Should prepare DB data and return success object", async () => {
                const params = {
                    secretCode: "code"
                };
                const session_variables = {
                    "x-hasura-user-id": "id"
                };
                const auth = new Auth({
                    getUserById: jest.fn(async () => null),
                    confirmChangeUserEmail: jest.fn()
                } as any);

                await expect(auth.confirmChangeEmail(params, session_variables))
                    .rejects.toThrowError();
            });
        });
    });
});