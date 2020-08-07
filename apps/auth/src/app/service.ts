import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
/* import { IncomingMessage, ServerResponse } from 'http'; */
import { Request, Response, Protocol } from "restana";

import Cookies from "cookies";
import { cpz } from "../../../../@types";
import { Auth } from "./auth";

import { sql } from "@cryptuoso/postgres";

import dayjs from "@cryptuoso/dayjs";

interface HttpRequest extends Request<Protocol.HTTP>/* , IncomingMessage */ {
    body: any
}

interface HttpResponse extends Response<Protocol.HTTP>/* , ServerResponse */ {

}

export interface DBFunctions {
    getUserByEmail: { (params: { email: string }): Promise<cpz.User> };
    getUserById: { (params: { userId: string }): Promise<cpz.User> };
    getUserTg: { (params: { telegramId: string }): Promise<cpz.User> };
    getUserByToken: { (params: { refreshToken: string }): Promise<cpz.User> };
    registerUser: { (newUser: cpz.User): Promise<any> };
    registerUserTg: { (newUser: cpz.User): Promise<any> };
    updateUserRefreshToken: {
        (params: {
            userId: string,
            refreshToken: string,
            refreshTokenExpireAt: string
        }): Promise<any>
    };
    updateUserSecretCode: {
        (params: {
            userId: string
            secretCode: string,
            secretCodeExpireAt: string
        }): Promise<any>
    };
    updateUserPassword: {
        (params: {
            userId: string,
            passwordHash: string,
            newSecretCode: string,
            newSecretCodeExpireAt: string,
        }): Promise<any>
    };
    activateUser: {
        (params: {
            refreshToken: string,
            refreshTokenExpireAt: string,
            userId: string
        }): Promise<any>
    };
}

export default class AuthService extends HTTPService {
    #auth: Auth;
    #dbFunctions: DBFunctions = {
        getUserByEmail: this._dbGetUserByEmail.bind(this),
        getUserById: this._dbGetUserById.bind(this),
        getUserTg: this._dbGetUserTg.bind(this),
        getUserByToken: this._dbGetUserByToken.bind(this),
        registerUser: this._dbRegisterUser.bind(this),
        registerUserTg: this._dbRegisterUserTg.bind(this),
        updateUserRefreshToken: this._dbUpdateUserRefreshToken.bind(this),
        updateUserSecretCode: this._dbUpdateUserSecretCode.bind(this),
        updateUserPassword: this._dbUpdateUserPassword.bind(this),
        activateUser: this._dbActivateUser.bind(this)
    };

    constructor(config?: HTTPServiceConfig) {
        super(config);
        try {
            this.#auth = new Auth();

            this.createRoutes({
                "login": {
                    handler: this.login.bind(this),
                    roles: [cpz.UserRoles.anonymous],
                    inputSchema: {
                        email: { type: "email", normalize: true },
                        password: { type: "string", empty: false, trim: true }
                    }
                },
                "loginTg": {
                    handler: this.loginTg.bind(this),
                    roles: [cpz.UserRoles.anonymous],
                    inputSchema: {
                        id: "number",
                        first_name: { type: "string", optional: true },
                        last_name: { type: "string", optional: true },
                        username: { type: "string", optional: true },
                        photo_url: { type: "string", optional: true },
                        auth_date: "number",
                        hash: "string"
                    }
                },
                "logout": {
                    handler: this.logout.bind(this),
                    roles: [cpz.UserRoles.user],
                    auth: true
                },
                "register": {
                    handler: this.register.bind(this),
                    roles: [cpz.UserRoles.anonymous],
                    inputSchema: {
                        email: { type: "email", normalize: true },
                        password: {
                            type: "string",
                            min: 6,
                            max: 100,
                            alphanum: true,
                            trim: true
                        },
                        name: { type: "string", optional: true, empty: false, trim: true }
                    }
                },
                "refreshToken": {
                    handler: this.refreshToken.bind(this),
                    roles: [cpz.UserRoles.user],
                    auth: true,
                    inputSchema: {
                        refreshToken: "string"
                    }
                },
                "activateAccount": {
                    handler: this.activateAccount.bind(this),
                    roles: [cpz.UserRoles.anonymous],
                    inputSchema: {
                        userId: "string",
                        secretCode: { type: "string", empty: false, trim: true }
                    }
                },
                "passwordReset": {
                    handler: this.passwordReset.bind(this),
                    roles: [cpz.UserRoles.anonymous],
                    inputSchema: {
                        email: { type: "email", normalize: true }
                    }
                },
                "confirmPasswordReset": {
                    handler: this.confirmPasswordReset.bind(this),
                    roles: [cpz.UserRoles.anonymous],
                    inputSchema: {
                        userId: "string",
                        secretCode: { type: "string", empty: false, trim: true },
                        password: {
                            type: "string",
                            min: 6,
                            max: 100,
                            alphanum: true,
                            trim: true
                        }
                    }
                }
            });
        } catch (err) {
            this.log.error(err, "While consctructing ImporterRunnerService");
        }
    }

    async login(req: HttpRequest, res: HttpResponse) {
        const { email } = req.body;

        const user: cpz.User = await this.db.pg.maybeOne(sql`
            SELECT * FROM users
            WHERE email = ${email}
        `);
        const {
            accessToken,
            refreshToken,
            refreshTokenExpireAt
        } = await this.#auth.login(req.body, this.#dbFunctions);

        const cookies = new Cookies(req, res);

        cookies.set("refresh_token", refreshToken, {
            expires: new Date(refreshTokenExpireAt),
            httpOnly: true,
            sameSite: "lax",
            domain: ".cryptuoso.com",
            overwrite: true
        });
        res.end(
            JSON.stringify({
                success: true,
                accessToken
            })
        );
    }

    async loginTg(req: HttpRequest, res: HttpResponse) {
        const {
            accessToken,
            refreshToken,
            refreshTokenExpireAt
        } = await this.#auth.loginTg(req.body, this.#dbFunctions);

        const cookies = new Cookies(req, res);

        cookies.set("refresh_token", refreshToken, {
            expires: new Date(refreshTokenExpireAt),
            httpOnly: true,
            sameSite: "lax",
            domain: ".cryptuoso.com",
            overwrite: true
        });
        res.end(
            JSON.stringify({
                success: true,
                accessToken
            })
        );
    }

    async logout(req: HttpRequest, res: HttpResponse) {
        const cookies = new Cookies(req, res);

        cookies.set("refresh_token", "", {
            expires: new Date(0),
            httpOnly: true,
            sameSite: "lax",
            domain: ".cryptuoso.com",
            overwrite: true
        });
        res.send({ success: true });
        res.end();
    }

    async register(req: HttpRequest, res: HttpResponse) {
        const userId = await this.#auth.register(req.body, this.#dbFunctions);
        res.send({ success: true, userId });
        res.end();
    }

    async refreshToken(req: HttpRequest, res: HttpResponse) {
        const cookies = new Cookies(req, res);
        let oldRefreshToken = cookies.get("refresh_token");
        if (!oldRefreshToken) {
            oldRefreshToken = req.headers["x-refresh-token"] as string;
        }
        const {
            accessToken,
            refreshToken,
            refreshTokenExpireAt
        } = await this.#auth.refreshToken(req.body, this.#dbFunctions);

        cookies.set("refresh_token", refreshToken, {
            expires: new Date(refreshTokenExpireAt),
            httpOnly: true,
            sameSite: "lax",
            domain: ".cryptuoso.com",
            overwrite: true
        });
        res.send({
            success: true,
            accessToken,
            refreshToken,
            refreshTokenExpireAt
        });
        res.end();
    }

    async activateAccount(req: HttpRequest, res: HttpResponse) {
        const {
            accessToken,
            refreshToken,
            refreshTokenExpireAt
        } = await this.#auth.activateAccount(req.body, this.#dbFunctions);

        const cookies = new Cookies(req, res);

        cookies.set("refresh_token", refreshToken, {
            expires: new Date(refreshTokenExpireAt),
            httpOnly: true,
            sameSite: "lax",
            domain: ".cryptuoso.com",
            overwrite: true
        });
        res.send({
            success: true,
            accessToken
        });
        res.end();
    }

    async passwordReset(req: HttpRequest, res: HttpResponse) {
        const userId = await this.#auth.passwordReset(req.body, this.#dbFunctions);
        res.send({ success: true, userId });
        res.end();
    }

    async confirmPasswordReset(req: HttpRequest, res: HttpResponse) {
        const {
            accessToken
        } = await this.#auth.confirmPasswordReset(req.body, this.#dbFunctions);

        const cookies = new Cookies(req, res);

        cookies.set("refresh_token", "", {
            expires: new Date(0),
            httpOnly: true,
            sameSite: "lax",
            domain: ".cryptuoso.com",
            overwrite: true
        });
        res.send({
            success: true,
            accessToken
        });
        res.end();
    }


    

    private async _dbGetUserByEmail(params: any): Promise<cpz.User> {
        const { email } = params;

        return await this.db.pg.maybeOne(sql`
            SELECT * FROM users
            WHERE email = ${email}
        `);
    }

    private async _dbGetUserById(params: any): Promise<cpz.User> {
        const { userId } = params;

        return await this.db.pg.maybeOne(sql`
            SELECT * FROM users
            WHERE id = ${userId}
        `);
    }

    private async _dbUpdateUserRefreshToken(params: any): Promise<any> {
        const { refreshToken, refreshTokenExpireAt, userId } = params;

        return await this.db.pg.query(sql`
            UPDATE users
            SET refreshToken = ${refreshToken}, refreshTokenExpireAt = ${refreshTokenExpireAt}
            WHERE id = ${userId}
        `);
    }

    private async _dbGetUserTg(params: any): Promise<cpz.User> {
        const { telegramId } = params;

        return await this.db.pg.maybeOne(this.db.sql`
            SELECT * FROM users
            WHERE telegramId = ${telegramId};
        `);
    }

    private async _dbRegisterUserTg(newUser: cpz.User) {
        return await this.db.pg.query(sql`
            INSERT INTO users
                (id, telegramId, telegramUsername, name, status, roles, settings)
                VALUES(
                    ${newUser.id},
                    ${newUser.telegramId},
                    ${newUser.telegramUsername},
                    ${newUser.name},
                    ${newUser.status},
                    ${sql.json(newUser.roles)},
                    ${sql.json(newUser.settings)}
                );
        `);
    }

    private async _dbRegisterUser(newUser: cpz.User): Promise<any> {
        return await this.db.pg.query(sql`
            INSERT INTO users
                (id, name, email, status, passwordHash, secretCode, roles, settings)
                VALUES(
                    ${newUser.id},
                    ${newUser.name},
                    ${newUser.email},
                    ${newUser.status},
                    ${newUser.passwordHash},
                    ${newUser.secretCode},
                    ${sql.json(newUser.roles)},
                    ${sql.json(newUser.settings)}
                );
        `);
    }

    private async _dbGetUserByToken(params: any): Promise<cpz.User> {
        const { refreshToken } = params;

        return await this.db.pg.maybeOne(sql`
            SELECT * FROM users
            WHERE refreshToken = ${refreshToken} AND refreshTokenExpireAt > ${dayjs.utc().toISOString()};
        `);
    }

    private async _dbActivateUser(params: any): Promise<any> {
        const { refreshToken, refreshTokenExpireAt, userId } = params;

        return await await this.db.pg.query(sql`
            UPDATE users
            SET secretCode = ${null},
                secretCodeExpireAt = ${null},
                status = ${cpz.UserStatus.enabled},
                refreshToken = ${refreshToken},
                refreshTokenExpireAt = ${refreshTokenExpireAt}
            WHERE id = ${userId};
        `);
    }

    private async _dbUpdateUserSecretCode(params: any): Promise<any> {
        const { secretCode, secretCodeExpireAt, userId } = params;

        return await this.db.pg.query(sql`
            UPDATE users
            SET secretCode = ${secretCode}, secretCodeExpireAt = ${secretCodeExpireAt}
            WHERE id = ${userId}
        `);
    }

    private async _dbUpdateUserPassword(params: any): Promise<any> {
        const { passwordHash, newSecretCode, newSecretCodeExpireAt, userId } = params;

        return await this.db.pg.query(sql`
            UPDATE users
            SET passwordHash = ${passwordHash},
                secretCode = ${newSecretCode},
                secretCodeExpireAt = ${newSecretCodeExpireAt}
            WHERE id = ${userId};
        `);
    }
}
