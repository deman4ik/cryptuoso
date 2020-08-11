import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
/* import { IncomingMessage, ServerResponse } from 'http'; */
import { Request, Response, Protocol } from "restana";
import Cookies from "cookies";
import { UserState } from "@cryptuoso/user-state";
import { DBFunctions } from "./types";
import { Auth } from "./auth";
import { sql } from "slonik";
import dayjs from "@cryptuoso/dayjs";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface HttpRequest extends Request<Protocol.HTTP> /* , IncomingMessage */ {
    body: any;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface HttpResponse extends Response<Protocol.HTTP> /* , ServerResponse */ {}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface AuthServiceConfig extends HTTPServiceConfig {}

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
        changeUserEmail: this._dbChangeUserEmail.bind(this),
        confirmChangeUserEmail: this._dbConfirmChangeUserEmail.bind(this),
        activateUser: this._dbActivateUser.bind(this)
    };

    constructor(config?: AuthServiceConfig) {
        super(config);
        try {
            this.#auth = new Auth(this.#dbFunctions);

            this.createRoutes({
                login: {
                    handler: this.login.bind(this),
                    roles: [UserState.UserRoles.anonymous],
                    inputSchema: {
                        email: { type: "email", normalize: true },
                        password: { type: "string", empty: false, trim: true }
                    }
                },
                "login-tg": {
                    handler: this.loginTg.bind(this),
                    roles: [UserState.UserRoles.anonymous],
                    inputSchema: {
                        id: "number",
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        first_name: { type: "string", optional: true },
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        last_name: { type: "string", optional: true },
                        username: { type: "string", optional: true },
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        photo_url: { type: "string", optional: true },
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        auth_date: "number",
                        hash: "string"
                    }
                },
                logout: {
                    handler: this.logout.bind(this),
                    roles: [UserState.UserRoles.user],
                    auth: true
                },
                register: {
                    handler: this.register.bind(this),
                    roles: [UserState.UserRoles.anonymous],
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
                "refresh-token": {
                    handler: this.refreshToken.bind(this),
                    roles: [UserState.UserRoles.user],
                    auth: true,
                    inputSchema: {}
                },
                "activate-account": {
                    handler: this.activateAccount.bind(this),
                    roles: [UserState.UserRoles.anonymous],
                    inputSchema: {
                        userId: "string",
                        secretCode: { type: "string", empty: false, trim: true }
                    }
                },
                "password-reset": {
                    handler: this.passwordReset.bind(this),
                    roles: [UserState.UserRoles.anonymous],
                    inputSchema: {
                        email: { type: "email", normalize: true }
                    }
                },
                "confirm-password-reset": {
                    handler: this.confirmPasswordReset.bind(this),
                    roles: [UserState.UserRoles.anonymous],
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
                },
                "change-email": {
                    handler: this.changeEmail.bind(this),
                    roles: [UserState.UserRoles.user],
                    auth: true,
                    inputSchema: {
                        email: { type: "email", normalize: true }
                    }
                },
                "confirm-change-email": {
                    handler: this.confirmChangeEmail.bind(this),
                    roles: [UserState.UserRoles.user],
                    auth: true,
                    inputSchema: {
                        secretCode: { type: "string", empty: false, trim: true }
                    }
                }
            });
        } catch (err) {
            this.log.error(err, "While consctructing AuthService");
        }
    }

    async login(req: HttpRequest, res: HttpResponse) {
        const { accessToken, refreshToken, refreshTokenExpireAt } = await this.#auth.login(req.body.input);

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

    async loginTg(req: HttpRequest, res: HttpResponse) {
        const { accessToken, refreshToken, refreshTokenExpireAt } = await this.#auth.loginTg(req.body.input);

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
        const userId = await this.#auth.register(req.body.input);
        res.send({ success: true, userId });
        res.end();
    }

    async refreshToken(req: HttpRequest, res: HttpResponse) {
        const cookies = new Cookies(req, res);
        let oldRefreshToken = cookies.get("refresh_token");
        if (!oldRefreshToken) {
            oldRefreshToken = req.headers["x-refresh-token"] as string;
        }
        const { accessToken, refreshToken, refreshTokenExpireAt } = await this.#auth.refreshToken({
            refreshToken: oldRefreshToken
        });

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
        const { accessToken, refreshToken, refreshTokenExpireAt } = await this.#auth.activateAccount(req.body.input);

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
        const userId = await this.#auth.passwordReset(req.body.input);
        res.send({ success: true, userId });
        res.end();
    }

    async confirmPasswordReset(req: HttpRequest, res: HttpResponse) {
        const { accessToken, refreshToken, refreshTokenExpireAt } = await this.#auth.confirmPasswordReset(
            req.body.input
        );

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

    async changeEmail(req: HttpRequest, res: HttpResponse) {
        /* const response =  */ await this.#auth.changeEmail({
            userId: req.body.session_variables["x-hasura-user-id"],
            email: req.body.input.email
        });
        res.send({ success: true });
        res.end();
    }

    async confirmChangeEmail(req: HttpRequest, res: HttpResponse) {
        const { accessToken, refreshToken, refreshTokenExpireAt } = await this.#auth.confirmChangeEmail({
            userId: req.body.session_variables["x-hasura-user-id"],
            secretCode: req.body.input.secretCode
        });

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

    private async _dbGetUserByEmail(params: { email: string }): Promise<UserState.User> {
        const { email } = params;

        return await this.db.pg.maybeOne(sql`
            SELECT * FROM users
            WHERE email = ${email}
        `);
    }

    private async _dbGetUserById(params: { userId: string }): Promise<UserState.User> {
        const { userId } = params;

        return await this.db.pg.maybeOne(sql`
            SELECT * FROM users
            WHERE id = ${userId}
        `);
    }

    private async _dbGetUserTg(params: { telegramId: number }): Promise<UserState.User> {
        const { telegramId } = params;

        return await this.db.pg.maybeOne(this.db.sql`
            SELECT * FROM users
            WHERE telegramId = ${telegramId};
        `);
    }

    private async _dbGetUserByToken(params: { refreshToken: string }): Promise<UserState.User> {
        const { refreshToken } = params;

        return await this.db.pg.maybeOne(sql`
            SELECT * FROM users
            WHERE refreshToken = ${refreshToken} AND refreshTokenExpireAt > ${dayjs.utc().toISOString()};
        `);
    }

    private async _dbUpdateUserRefreshToken(params: {
        refreshToken: string;
        refreshTokenExpireAt: string;
        userId: string;
    }): Promise<any> {
        const { refreshToken, refreshTokenExpireAt, userId } = params;

        await this.db.pg.query(sql`
            UPDATE users
            SET refreshToken = ${refreshToken}, refreshTokenExpireAt = ${refreshTokenExpireAt}
            WHERE id = ${userId}
        `);
    }

    private async _dbRegisterUserTg(newUser: UserState.User): Promise<any> {
        await this.db.pg.query(sql`
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

    private async _dbRegisterUser(newUser: UserState.User): Promise<any> {
        await this.db.pg.query(sql`
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

    private async _dbActivateUser(params: {
        refreshToken: string;
        refreshTokenExpireAt: string;
        userId: string;
    }): Promise<any> {
        const { refreshToken, refreshTokenExpireAt, userId } = params;

        await await this.db.pg.query(sql`
            UPDATE users
            SET secretCode = ${null},
                secretCodeExpireAt = ${null},
                status = ${UserState.UserStatus.enabled},
                refreshToken = ${refreshToken},
                refreshTokenExpireAt = ${refreshTokenExpireAt}
            WHERE id = ${userId};
        `);
    }

    private async _dbUpdateUserSecretCode(params: {
        userId: string;
        secretCode: string;
        secretCodeExpireAt: string;
    }): Promise<any> {
        const { userId, secretCode, secretCodeExpireAt } = params;

        await this.db.pg.query(sql`
            UPDATE users
            SET secretCode = ${secretCode}, secretCodeExpireAt = ${secretCodeExpireAt}
            WHERE id = ${userId}
        `);
    }

    private async _dbChangeUserEmail(params: {
        userId: string;
        emailNew: string;
        secretCode: string;
        secretCodeExpireAt: string;
    }): Promise<any> {
        const { secretCode, secretCodeExpireAt, userId, emailNew } = params;

        await this.db.pg.query(sql`
            UPDATE users
            SET emailNew = ${emailNew},
                secretCode = ${secretCode},
                secretCodeExpireAt = ${secretCodeExpireAt}
            WHERE id = ${userId}
        `);
    }

    private async _dbConfirmChangeUserEmail(params: {
        userId: string;
        email: string;
        emailNew: string;
        secretCode: string;
        secretCodeExpireAt: string;
        refreshToken: string;
        refreshTokenExpireAt: string;
        status: UserState.UserStatus;
    }): Promise<any> {
        const {
            userId,
            email,
            emailNew,
            secretCode,
            secretCodeExpireAt,
            refreshToken,
            refreshTokenExpireAt,
            status
        } = params;

        await this.db.pg.query(sql`
            UPDATE users
            SET email = ${email},
                emailNew = ${emailNew},
                secretCode = ${secretCode},
                secretCodeExpireAt = ${secretCodeExpireAt}
                refreshToken = ${refreshToken},
                refreshTokenExpireAt = ${refreshTokenExpireAt},
                status = ${status}
            WHERE id = ${userId}
        `);
    }

    private async _dbUpdateUserPassword(params: {
        userId: string;
        passwordHash: string;
        newSecretCode: string;
        newSecretCodeExpireAt: string;
        refreshToken: string;
        refreshTokenExpireAt: string;
    }): Promise<any> {
        const {
            userId,
            passwordHash,
            newSecretCode,
            newSecretCodeExpireAt,
            refreshToken,
            refreshTokenExpireAt
        } = params;

        await this.db.pg.query(sql`
            UPDATE users
            SET passwordHash = ${passwordHash},
                secretCode = ${newSecretCode},
                secretCodeExpireAt = ${newSecretCodeExpireAt},
                refreshToken = ${refreshToken},
                refreshTokenExpireAt = ${refreshTokenExpireAt}
            WHERE id = ${userId};
        `);
    }
}
