import bcrypt from "bcrypt";
import { UserState } from "@cryptuoso/user-state";
import { DBFunctions } from "../app/types";
import { Auth } from "../app/auth";

const DBF = {
    getUserByEmail: jest.fn(),
    getUserById: jest.fn(),
    getUserTg: jest.fn(),
    getUserByToken: jest.fn(),
    registerUser: jest.fn(),
    registerUserTg: jest.fn(),
    updateUserRefreshToken: jest.fn(),
    updateUserSecretCode: jest.fn(),
    updateUserPassword: jest.fn(),
    changeUserEmail: jest.fn(),
    confirmChangeUserEmail: jest.fn(),
    activateUser: jest.fn()
};

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

describe("Test Auth class", () => {
    process.env.REFRESH_TOKEN_EXPIRES = "1";
    process.env.JWT_SECRET = "secret";
    process.env.JWT_TOKEN_EXPIRES = "1";

    describe("Testing constructor", () => {
        it("Should not to throw error", () => {
            expect(() => new Auth(DBF)).not.toThrowError();
        });
    });
    
    describe("Test methods", () => {
        describe("login method", () => {
            describe("With right params provided", () => {
                describe("W/o refreshToken in DB", () => {
                    test("Should return object with defined props", async () => {
                        const auth = new Auth(DBF);
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
                        DBF.getUserByEmail.mockImplementationOnce(async () => dbUser);
        
                        const result = await auth.login(params);
        
                        expect(result).toHaveProperty("accessToken");
                        expect(result).toHaveProperty("refreshToken");
                        expect(result).toHaveProperty("refreshTokenExpireAt");
                    });
                });
            });
        
            describe("With valid refreshToken in DB", () => {
                test("Should return object with defined props", async () => {
                    const auth = new Auth(DBF);
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
                    DBF.getUserByEmail.mockImplementationOnce(async () => dbUser);
    
                    const result = await auth.login(params);
    
                    //console.log(result);
    
                    expect(result).toHaveProperty("accessToken");
                    expect(result.refreshToken).toStrictEqual(dbUser.refreshToken);
                    expect(result.refreshTokenExpireAt).toStrictEqual(dbUser.refreshTokenExpireAt);
                });
            });
            
            describe("With invalid refreshToken in DB", () => {
                test("Should return object with defined props", async () => {
                    const auth = new Auth(DBF);
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
                    DBF.getUserByEmail.mockImplementationOnce(async () => dbUser);
    
                    const result = await auth.login(params);
    
                    //console.log(result);
    
                    expect(result).toHaveProperty("accessToken");
                    expect(result.refreshToken).not.toEqual(dbUser.refreshToken);
                    expect(result.refreshTokenExpireAt).not.toEqual(dbUser.refreshTokenExpireAt);
                });
            });
        
            describe("With wrong params provided", () => {
                describe("With wrong password", () => {
                    test("Should to throw error", async () => {
                        const auth = new Auth(DBF);
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
    
                        DBF.getUserByEmail.mockImplementationOnce(async () => dbUser);
                        expect(async () => auth.login(params)).rejects.toThrow();
                    });
                });
                
                describe("With user status != enabled", () => {
                    test("Should to throw error", async () => {
                        const auth = new Auth(DBF);
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
    
                        DBF.getUserByEmail.mockImplementationOnce(async () => dbUser);
                        expect(async () => auth.login(params)).rejects.toThrow();
                    });
                });
                
                describe("With not existing email provided", () => {
                    test("Should to throw error", async () => {
                        const auth = new Auth(DBF);
                        const params = {
                            email: "example@inbox.com",
                            password: "password"
                        };
    
                        DBF.getUserByEmail.mockImplementationOnce(async () => null);
                        await expect(auth.login(params)).rejects.toThrow();
                    });
                });
            });
        });

        
        describe("loginTg method", () => {
            describe("With right params provided", () => {
                describe("W/o refreshToken in DB", () => {

                });
            });
        });

        
        describe("register method", () => {
            describe("With non-existing email", () => {
                test("Should create new account", async () => {
                    const auth = new Auth(DBF);
                    const params = {
                        email: "example@inbox.com",
                        password: "password",
                        name: "Name"
                    };

                    DBF.getUserByEmail.mockImplementationOnce(async () => null);

                    await expect(auth.register(params)).resolves.toBeDefined();
                    
                    const newUser: UserState.User = DBF.registerUser.mock.calls.pop()[0];

                    expect(params.email).toStrictEqual(newUser.email);
                    expect(params.name).toStrictEqual(newUser.name);
                    expect(
                        await bcrypt.compare(params.password, newUser.passwordHash)
                    ).toBeTruthy();
                });
            });
            
            describe("With existing email", () => {
                test("Should to throw error", async () => {
                    const auth = new Auth(DBF);
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

                    DBF.getUserByEmail.mockImplementationOnce(async () => dbUser);

                    await expect(auth.register(params)).rejects.toThrowError();
                });
            });
        });

        
        describe("refreshToken method", () => {
            describe("With active token", () => {
                test("Should create new access token", async () => {
                    const auth = new Auth(DBF);
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

                    DBF.getUserByToken.mockImplementationOnce(async () => dbUser);

                    const result = await auth.refreshToken(params);
                    
                    expect(result).toHaveProperty("accessToken");
                    expect(result.refreshToken).toStrictEqual(dbUser.refreshToken);
                    expect(result.refreshTokenExpireAt).toStrictEqual(dbUser.refreshTokenExpireAt);
                });
            });
            
            describe("With inactive token", () => {
                test("Should to throw error", async () => {
                    const auth = new Auth(DBF);
                    const params = {
                        refreshToken: "token"
                    };

                    DBF.getUserByEmail.mockImplementationOnce(async () => null);

                    await expect(auth.refreshToken(params)).rejects.toThrowError();
                });
            });
            
            describe("With status != enabled", () => {
                test("Should to throw error", async () => {
                    const auth = new Auth(DBF);
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

                    DBF.getUserByToken.mockImplementationOnce(async () => dbUser);

                    await expect(auth.refreshToken(params)).rejects.toThrowError();
                });
            });
        });

        
        describe("activateAccount method", () => {
            describe("With existing id and right secretCode", () => {
                test("Should create new access token", async () => {
                    const auth = new Auth(DBF);
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

                    DBF.getUserById.mockImplementationOnce(async () => dbUser);

                    const result = await auth.activateAccount(params);
                    
                    expect(result).toHaveProperty("accessToken");
                    expect(result).toHaveProperty("refreshToken");
                    expect(result).toHaveProperty("refreshTokenExpireAt");
                });
            });

            describe("With existing id and wrong secretCode", () => {
                test("Should to throw error", async () => {
                    const auth = new Auth(DBF);
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

                    DBF.getUserById.mockImplementationOnce(async () => dbUser);

                    expect(auth.activateAccount(params)).rejects.toThrowError();
                });
            });

            describe("With status != new", () => {
                test("Should to throw error", async () => {
                    const auth = new Auth(DBF);
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

                    DBF.getUserById.mockImplementationOnce(async () => dbUser);

                    expect(auth.activateAccount(params)).rejects.toThrowError();
                });
            });

            describe("With bad userId", () => {
                test("Should to throw error", async () => {
                    const auth = new Auth(DBF);
                    const params = {
                        userId: "bad-id",
                        secretCode: "code"
                    };

                    DBF.getUserById.mockImplementationOnce(async () => null);

                    expect(auth.activateAccount(params)).rejects.toThrowError();
                });
            });
        });

        
        describe("passwordReset method", () => {
            describe("With existing email", () => {
                test("Should prepare DB data and return userId", async () => {
                    const auth = new Auth(DBF);
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

                    DBF.getUserByEmail.mockImplementationOnce(async () => dbUser);

                    expect(auth.passwordReset(params)).resolves.toStrictEqual(dbUser.id);
                });
            });

            describe("With existing email and blocked status", () => {
                test("Should to throw error", async () => {
                    const auth = new Auth(DBF);
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

                    DBF.getUserByEmail.mockImplementationOnce(async () => dbUser);

                    expect(auth.passwordReset(params)).resolves.toThrowError();
                });
            });

            describe("With not existing email", () => {
                test("Should to throw error", async () => {
                    const auth = new Auth(DBF);
                    const params = {
                        email: "example@inbox.com"
                    };

                    DBF.getUserByEmail.mockImplementationOnce(async () => null);

                    expect(auth.passwordReset(params)).rejects.toThrowError();
                });
            });
        });

        
        describe("confirmPasswordReset method", () => {
            describe("With right data", () => {
                test("Should update DB data and return new access token", async () => {
                    const auth = new Auth(DBF);
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

                    DBF.getUserById.mockImplementationOnce(async () => dbUser);

                    const result = await auth.confirmPasswordReset(params);

                    expect(result).toHaveProperty("accessToken");
                    expect(result).toHaveProperty("refreshToken");
                    expect(result).toHaveProperty("refreshTokenExpireAt");
                });
            });

            describe("With existing email and blocked status", () => {
                test("Should to throw error", async () => {
                    const auth = new Auth(DBF);
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

                    DBF.getUserByEmail.mockImplementationOnce(async () => dbUser);

                    expect(auth.passwordReset(params)).rejects.toThrowError();
                });
            });

            describe("With not existing email", () => {
                test("Should to throw error", async () => {
                    const auth = new Auth(DBF);
                    const params = {
                        email: "example@inbox.com"
                    };

                    DBF.getUserByEmail.mockImplementationOnce(async () => null);

                    expect(auth.passwordReset(params)).rejects.toThrowError();
                });
            });
        });
    });
});