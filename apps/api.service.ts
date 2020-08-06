import { HTTPService, HTTPServiceConfig } from "../libs/service/src";
import { IncomingMessage, ServerResponse } from 'http';
import { Request, Response, Protocol } from "restana";

import Cookies from "cookies";
import { cpz } from "../@types";

import MyBroker from "../utils/my-broker";

interface MyRequest extends Request<Protocol.HTTP>, IncomingMessage {
    body: any
}

interface MyResponse extends Response<Protocol.HTTP>, ServerResponse {

}

export interface ApiServiceConfig extends HTTPServiceConfig {
    broker: MyBroker;
}

export class ApiService extends HTTPService {
    private broker: MyBroker;

    constructor(config: ApiServiceConfig) {
        super(config);

        this.broker = config.broker;

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
    }

    async login(req: MyRequest, res: MyResponse) {
        const {
          accessToken,
          refreshToken,
          refreshTokenExpireAt
        } = await this.broker.call(`${cpz.Service.AUTH}.login`, req.body);
  
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

    async loginTg(req: MyRequest, res: MyResponse) {
        const {
            accessToken,
            refreshToken,
            refreshTokenExpireAt
        } = await this.broker.call(
            `${cpz.Service.AUTH}.loginTg`,
            req.body
        );

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

    async logout(req: MyRequest, res: MyResponse) {
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

    async register(req: MyRequest, res: MyResponse) {
        const userId = await this.broker.call(
            `${cpz.Service.AUTH}.register`,
            req.body
        );
        res.send({ success: true, userId });
        res.end();
    }

    async refreshToken(req: MyRequest, res: MyResponse) {
        const cookies = new Cookies(req, res);
        let oldRefreshToken = cookies.get("refresh_token");
        if (!oldRefreshToken) {
            oldRefreshToken = req.headers["x-refresh-token"] as string;
        }
        const {
            accessToken,
            refreshToken,
            refreshTokenExpireAt
        } = await this.broker.call(`${cpz.Service.AUTH}.refreshToken`, {
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

    async activateAccount(req: MyRequest, res: MyResponse) {
        const {
            accessToken,
            refreshToken,
            refreshTokenExpireAt
        } = await this.broker.call(
            `${cpz.Service.AUTH}.activateAccount`,
            req.body
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

    async passwordReset(req: MyRequest, res: MyResponse) {
        const userId = await this.broker.call(
            `${cpz.Service.AUTH}.passwordReset`,
            req.body
        );
        res.send({ success: true, userId });
        res.end();
    }

    async confirmPasswordReset(req: MyRequest, res: MyResponse) {
        const {
            accessToken,
            refreshToken,
            refreshTokenExpireAt
        } = await this.broker.call(
            `${cpz.Service.AUTH}.confirmPasswordReset`,
            req.body
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
}
