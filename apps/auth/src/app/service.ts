import { HTTPService, HTTPServiceConfig, RequestExtended } from "@cryptuoso/service";
import { Response, Protocol } from "restana";
import Cookie, { CookieSerializeOptions } from "cookie";
import { UserRoles } from "@cryptuoso/user-state";
import { Auth } from "./auth";
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
                setTelegram: {
                    handler: this.setTelegram.bind(this),
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        data: {
                            type: "object",
                            props: {
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
                        }
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
}
