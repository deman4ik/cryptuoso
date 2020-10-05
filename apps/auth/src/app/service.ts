import { HTTPService, HTTPServiceConfig, RequestExtended } from "@cryptuoso/service";
import { Response, Protocol } from "restana";
import Cookie, { CookieSerializeOptions } from "cookie";
import { User, UserStatus, UserRoles } from "@cryptuoso/user-state";
import { DBFunctions } from "./types";
import { Auth } from "./auth";
import { sql } from "slonik";
import dayjs from "@cryptuoso/dayjs";
import { ActionsHandlerError } from "@cryptuoso/errors";

type HttpResponse = Response<Protocol.HTTP>;

export type AuthServiceConfig = HTTPServiceConfig;

export default class AuthService extends HTTPService {
    auth: Auth;
    dbFunctions: DBFunctions = {
        getUserByEmail: this._dbGetUserByEmail.bind(this),
        getUserById: this._dbGetUserById.bind(this),
        getUserTg: this._dbGetUserTg.bind(this),
        getUserByToken: this._dbGetUserByToken.bind(this),
        registerUser: this._dbRegisterUser.bind(this),
        registerUserTg: this._dbRegisterUserTg.bind(this),
        updateUserRefreshToken: this._dbUpdateUserRefreshToken.bind(this),
        updateUserSecretCode: this._dbUpdateUserSecretCode.bind(this),
        updateUserPassword: this._dbUpdateUserPassword.bind(this),
        changeUserPassword: this._dbChangeUserPassword.bind(this),
        changeUserEmail: this._dbChangeUserEmail.bind(this),
        confirmChangeUserEmail: this._dbConfirmChangeUserEmail.bind(this),
        activateUser: this._dbActivateUser.bind(this)
    };

    constructor(config?: AuthServiceConfig) {
        super(config);
        try {
            this.auth = new Auth(this.dbFunctions);
            this.createRoutes({
                login: {
                    handler: this.login.bind(this),
                    roles: [UserRoles.anonymous],
                    inputSchema: {
                        email: { type: "email", normalize: true },
                        password: { type: "string", empty: false, trim: true }
                    }
                },
                loginTg: {
                    handler: this.loginTg.bind(this),
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
                    auth: true
                },
                register: {
                    handler: this.register.bind(this),
                    roles: [UserRoles.anonymous],
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
                refreshToken: {
                    handler: this.refreshToken.bind(this),
                    auth: false,
                    inputSchema: null
                },
                activateAccount: {
                    handler: this.activateAccount.bind(this),
                    roles: [UserRoles.anonymous, UserRoles.manager, UserRoles.admin],
                    inputSchema: {
                        userId: "string",
                        secretCode: { type: "string", empty: false, trim: true }
                    }
                },
                changePassword: {
                    handler: this.changePassword.bind(this),
                    roles: [UserRoles.user],
                    inputSchema: {
                        password: {
                            type: "string",
                            min: 6,
                            max: 100,
                            alphanum: true,
                            trim: true
                        },
                        oldPassword: { type: "string", optional: true, trim: true }
                    }
                },
                passwordReset: {
                    handler: this.passwordReset.bind(this),
                    inputSchema: {
                        email: { type: "email", normalize: true }
                    }
                },
                confirmPasswordReset: {
                    handler: this.confirmPasswordReset.bind(this),
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
                changeEmail: {
                    handler: this.changeEmail.bind(this),
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    auth: true,
                    inputSchema: {
                        email: { type: "email", normalize: true }
                    }
                },
                confirmChangeEmail: {
                    handler: this.confirmChangeEmail.bind(this),
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
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

    _makeCookieProps(expires: string | number): CookieSerializeOptions {
        return {
            expires: new Date(expires),
            httpOnly: true,
            sameSite: this.isDev ? "none" : "lax",
            domain: ".cryptuoso.com",
            secure: true
        };
    }

    async login(req: RequestExtended, res: HttpResponse) {
        try {
            const { accessToken, refreshToken, refreshTokenExpireAt } = await this.auth.login(req.body.input);

            res.setHeader(
                "Set-Cookie",
                Cookie.serialize("refresh_token", refreshToken, this._makeCookieProps(refreshTokenExpireAt))
            );
            res.send({
                accessToken
            });
            res.end();
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }

    async loginTg(req: RequestExtended, res: HttpResponse) {
        const { accessToken, refreshToken, refreshTokenExpireAt } = await this.auth.loginTg(req.body.input);

        res.setHeader(
            "Set-Cookie",
            Cookie.serialize("refresh_token", refreshToken, this._makeCookieProps(refreshTokenExpireAt))
        );
        res.send({
            accessToken
        });
        res.end();
    }

    async logout(req: RequestExtended, res: HttpResponse) {
        res.setHeader("Set-Cookie", Cookie.serialize("refresh_token", "", this._makeCookieProps(0)));
        res.send({ result: "OK" });
        res.end();
    }

    async register(req: RequestExtended, res: HttpResponse) {
        const userId = await this.auth.register(req.body.input);
        res.send({ userId });
        res.end();
    }

    async refreshToken(req: RequestExtended, res: HttpResponse) {
        const cookies = Cookie.parse((req.headers["cookie"] as string) || "");
        let oldRefreshToken = cookies["refresh_token"];
        this.log.info("cookie ", req.headers["cookie"], cookies, oldRefreshToken);
        if (!oldRefreshToken) {
            oldRefreshToken = req.headers["x-refresh-token"] as string;
        }
        if (!oldRefreshToken) throw new ActionsHandlerError("No refresh token", null, "FORBIDDEN", 403);
        const { accessToken, refreshToken, refreshTokenExpireAt, userId } = await this.auth.refreshToken({
            refreshToken: oldRefreshToken
        });

        await this.db.pg.query(this.db.sql`
            UPDATE users
            SET last_active_at = now()
            WHERE id = ${userId};
        `);

        res.setHeader(
            "Set-Cookie",
            Cookie.serialize("refresh_token", refreshToken, this._makeCookieProps(refreshTokenExpireAt))
        );
        res.send({
            accessToken
        });
        res.end();
    }

    async activateAccount(req: RequestExtended, res: HttpResponse) {
        const { accessToken, refreshToken, refreshTokenExpireAt } = await this.auth.activateAccount(req.body.input);

        res.setHeader(
            "Set-Cookie",
            Cookie.serialize("refresh_token", refreshToken, this._makeCookieProps(refreshTokenExpireAt))
        );
        res.send({
            accessToken
        });
        res.end();
    }

    async changePassword(req: RequestExtended, res: HttpResponse) {
        await this.auth.changePassword(req.meta.user, req.body.input);
        res.send({ result: "OK" });
        res.end();
    }

    async passwordReset(req: RequestExtended, res: HttpResponse) {
        const userId = await this.auth.passwordReset(req.body.input);
        res.send({ userId });
        res.end();
    }

    async confirmPasswordReset(req: RequestExtended, res: HttpResponse) {
        const { accessToken, refreshToken, refreshTokenExpireAt } = await this.auth.confirmPasswordReset(
            req.body.input
        );

        res.setHeader(
            "Set-Cookie",
            Cookie.serialize("refresh_token", refreshToken, this._makeCookieProps(refreshTokenExpireAt))
        );
        res.send({
            accessToken
        });
        res.end();
    }

    async changeEmail(req: RequestExtended, res: HttpResponse) {
        await this.auth.changeEmail({
            userId: req.body.session_variables["x-hasura-user-id"],
            email: req.body.input.email
        });
        res.send({ result: "OK" });
        res.end();
    }

    async confirmChangeEmail(req: RequestExtended, res: HttpResponse) {
        const { accessToken, refreshToken, refreshTokenExpireAt } = await this.auth.confirmChangeEmail({
            userId: req.body.session_variables["x-hasura-user-id"],
            secretCode: req.body.input.secretCode
        });

        res.setHeader(
            "Set-Cookie",
            Cookie.serialize("refresh_token", refreshToken, this._makeCookieProps(refreshTokenExpireAt))
        );
        res.send({
            accessToken
        });
        res.end();
    }

    private async _dbGetUserByEmail(params: { email: string }): Promise<User> {
        const { email } = params;

        return await this.db.pg.maybeOne(sql`
            SELECT * FROM users
            WHERE email = ${email}
        `);
    }

    private async _dbGetUserById(params: { userId: string }): Promise<User> {
        const { userId } = params;

        return await this.db.pg.maybeOne(sql`
            SELECT * FROM users
            WHERE id = ${userId}
        `);
    }

    private async _dbGetUserTg(params: { telegramId: number }): Promise<User> {
        const { telegramId } = params;

        return await this.db.pg.maybeOne(sql`
            SELECT * FROM users
            WHERE telegram_id = ${telegramId};
        `);
    }

    private async _dbGetUserByToken(params: { refreshToken: string }): Promise<User> {
        const { refreshToken } = params;

        return await this.db.pg.maybeOne(sql`
            SELECT * FROM users
            WHERE refresh_token = ${refreshToken} AND refresh_token_expire_at > ${dayjs.utc().toISOString()};
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
            SET refresh_token = ${refreshToken}, refresh_token_expire_at = ${refreshTokenExpireAt}
            WHERE id = ${userId}
        `);
    }

    private async _dbRegisterUserTg(newUser: User): Promise<any> {
        await this.db.pg.query(sql`
            INSERT INTO users
                (id, telegram_id, telegram_username, name, status, roles, access, settings)
                VALUES(
                    ${newUser.id},
                    ${newUser.telegramId},
                    ${newUser.telegramUsername},
                    ${newUser.name},
                    ${newUser.status},
                    ${sql.json(newUser.roles)},
                    ${newUser.access},
                    ${sql.json(newUser.settings)}
                );
        `);
    }

    private async _dbRegisterUser(newUser: User): Promise<any> {
        await this.db.pg.query(sql`
            INSERT INTO users
                (id, name, email, status, password_hash, secret_code, roles, access, settings)
                VALUES(
                    ${newUser.id},
                    ${newUser.name},
                    ${newUser.email},
                    ${newUser.status},
                    ${newUser.passwordHash},
                    ${newUser.secretCode},
                    ${sql.json(newUser.roles)},
                    ${newUser.access},
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
            SET secret_code = ${null},
                secret_code_expire_at = ${null},
                status = ${UserStatus.enabled},
                refresh_token = ${refreshToken},
                refresh_token_expire_at = ${refreshTokenExpireAt}
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
            SET secret_code = ${secretCode}, secret_code_expire_at = ${secretCodeExpireAt}
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
            SET email_new = ${emailNew},
                secret_code = ${secretCode},
                secret_code_expire_at = ${secretCodeExpireAt}
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
        status: UserStatus;
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
                email_new = ${emailNew},
                secret_code = ${secretCode},
                secret_code_expire_at = ${secretCodeExpireAt},
                refresh_token = ${refreshToken},
                refresh_token_expire_at = ${refreshTokenExpireAt},
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
            SET password_hash = ${passwordHash},
                secret_code = ${newSecretCode},
                secret_code_expire_at = ${newSecretCodeExpireAt},
                refresh_token = ${refreshToken},
                refresh_token_expireAt = ${refreshTokenExpireAt}
            WHERE id = ${userId};
        `);
    }

    private async _dbChangeUserPassword(params: { userId: string; passwordHash: string }): Promise<any> {
        const { userId, passwordHash } = params;

        await this.db.pg.query(sql`
            UPDATE users
            SET password_hash = ${passwordHash}
            WHERE id = ${userId};
        `);
    }
}
