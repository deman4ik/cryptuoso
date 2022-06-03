import { HTTPService, HTTPServiceConfig, RequestExtended } from "@cryptuoso/service";
import { Response, Protocol } from "restana";
import Cookie, { CookieSerializeOptions } from "cookie";
import { UserRoles } from "@cryptuoso/user-state";
import { Auth } from "@cryptuoso/auth-utils";
import { ActionsHandlerError } from "@cryptuoso/errors";

type HttpResponse = Response<Protocol.HTTP>;

export type AuthServiceConfig = HTTPServiceConfig;

export default class AuthService extends HTTPService {
    auth: Auth;

    constructor(config?: AuthServiceConfig) {
        super(config);
        try {
            this.auth = new Auth();
            this.createRoutes({
                authLogin: {
                    handler: this.login.bind(this),
                    roles: [UserRoles.anonymous],
                    inputSchema: {
                        email: { type: "email", normalize: true },
                        password: { type: "string", empty: false, trim: true }
                    }
                },
                authLoginTelegram: {
                    handler: this.loginTelegram.bind(this),
                    roles: [UserRoles.anonymous],
                    inputSchema: {
                        data: {
                            type: "object",
                            props: {
                                id: "number",
                                first_name: { type: "string", optional: true },
                                last_name: { type: "string", optional: true },
                                username: { type: "string", optional: true },
                                photo_url: { type: "string", optional: true },
                                auth_date: "number",
                                hash: "string"
                            }
                        }
                    }
                },
                authSetTelegram: {
                    handler: this.setTelegram.bind(this),
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        data: {
                            type: "object",
                            props: {
                                id: "number",
                                first_name: { type: "string", optional: true },
                                last_name: { type: "string", optional: true },
                                username: { type: "string", optional: true },
                                photo_url: { type: "string", optional: true },
                                auth_date: "number",
                                hash: "string"
                            }
                        }
                    }
                },
                authLogout: {
                    handler: this.logout.bind(this),
                    auth: true
                },
                authRegister: {
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
                authRefreshToken: {
                    handler: this.refreshToken.bind(this),
                    auth: false,
                    inputSchema: null
                },
                authActivateAccount: {
                    handler: this.activateAccount.bind(this),
                    roles: [UserRoles.anonymous, UserRoles.manager, UserRoles.admin],
                    inputSchema: {
                        email: { type: "email", normalize: true },
                        secretCode: { type: "string", empty: false, trim: true }
                    }
                },
                authChangePassword: {
                    handler: this.changePassword.bind(this),
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
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
                authResetPassword: {
                    handler: this.resetPassword.bind(this),
                    roles: [UserRoles.anonymous, UserRoles.manager, UserRoles.admin],
                    inputSchema: {
                        email: { type: "email", normalize: true }
                    }
                },
                authConfirmPasswordReset: {
                    handler: this.confirmPasswordReset.bind(this),
                    inputSchema: {
                        email: { type: "email", normalize: true },
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
                authChangeEmail: {
                    handler: this.changeEmail.bind(this),
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    auth: true,
                    inputSchema: {
                        email: { type: "email", normalize: true }
                    }
                },
                authConfirmEmailChange: {
                    handler: this.confirmEmailChange.bind(this),
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    auth: true,
                    inputSchema: {
                        secretCode: { type: "string", empty: false, trim: true }
                    }
                }
            });
        } catch (err) {
            this.log.error("Error while constructing AuthService", err);
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

    async loginTelegram(req: RequestExtended, res: HttpResponse) {
        const { accessToken, refreshToken, refreshTokenExpireAt } = await this.auth.loginTg(req.body.input.data);

        res.setHeader(
            "Set-Cookie",
            Cookie.serialize("refresh_token", refreshToken, this._makeCookieProps(refreshTokenExpireAt))
        );
        res.send({
            accessToken
        });
        res.end();
    }

    async setTelegram(req: RequestExtended, res: HttpResponse) {
        await this.auth.setTelegram(req.meta.user, req.body.input.data);
        res.send({ result: "OK" });
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

    async resetPassword(req: RequestExtended, res: HttpResponse) {
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

    async confirmEmailChange(req: RequestExtended, res: HttpResponse) {
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
}
