import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
/* import { IncomingMessage, ServerResponse } from 'http'; */
import { Request, Response, Protocol } from "restana";

import Cookies from "cookies";
import { cpz } from "../../../../@types";
import { AuthService } from "./auth.service";

interface HttpRequest extends Request<Protocol.HTTP>/* , IncomingMessage */ {
    /* body: any */
}

interface HttpResponse extends Response<Protocol.HTTP>/* , ServerResponse */ {

}

export default class ApiService extends HTTPService {
    #authService: AuthService;

    constructor(config?: HTTPServiceConfig) {
        super(config);
        try {
            this.#authService = new AuthService(this.db);

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
        const {
          accessToken,
          refreshToken,
          refreshTokenExpireAt
        } = await this.#authService.login(req.body);
  
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
        } = await this.#authService.loginTg(req.body);

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
        const userId = await this.#authService.register(req.body);
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
        } = await this.#authService.refreshToken(req.body);
        
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
        } = await this.#authService.activateAccount(req.body);

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
        const userId = await this.#authService.passwordReset(req.body);
        res.send({ success: true, userId });
        res.end();
    }

    async confirmPasswordReset(req: HttpRequest, res: HttpResponse) {
        const {
            accessToken,
            refreshToken,
            refreshTokenExpireAt
        } = await this.#authService.confirmPasswordReset(req.body);

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
}
