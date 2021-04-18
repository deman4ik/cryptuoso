import restana, { Service, Protocol, Request, Response, RequestHandler } from "restana";
import ifunless from "middleware-if-unless";
import bodyParser from "body-parser";
import helmet from "helmet";
import Validator, { ValidationSchema, ValidationError } from "fastest-validator";
import { BaseService, BaseServiceConfig } from "./BaseService";
import { ActionsHandlerError } from "@cryptuoso/errors";
import { BaseUser, User, UserRoles, UserStatus } from "@cryptuoso/user-state";
import { JSONParse } from "@cryptuoso/helpers";
import { sql } from "@cryptuoso/postgres";

//TODO: req/res typings

export interface ActionPayload {
    action: {
        name: string;
    };
    input: { [key: string]: any } | any;
    session_variables: {
        [key: string]: string;
        "x-hasura-user-id"?: string;
        "x-hasura-role"?: UserRoles;
    };
}

export type RequestExtended<P extends Protocol = any> = Request<P> & {
    body?: ActionPayload;
    meta?: {
        [key: string]: any;
        user: User;
    };
};

export interface HTTPServiceConfig extends BaseServiceConfig {
    port?: number;
    enableActions?: boolean; // default: true
    enableWebhooks?: boolean; // default: false
}

export class HTTPService extends BaseService {
    private _iu: any;
    private _v: Validator;
    private _port: number;
    private _server: Service<Protocol.HTTP>;
    private _routes: {
        [key: string]: {
            validate?: (value: any) => true | ValidationError[];
            auth?: boolean;
            roles?: string[];
        };
    } = {};
    constructor(config: HTTPServiceConfig = { enableActions: true, enableWebhooks: false }) {
        super(config);
        try {
            this._iu = ifunless();
            this._v = new Validator();
            this._port = config?.port || +process.env.PORT || +process.env.NODE_PORT || 3000;
            this._server = restana({
                errorHandler: this._errorHandler.bind(this)
            });
            this._server.use(helmet() as RequestHandler<Protocol.HTTP>);
            this._server.use(bodyParser.json());

            if (config?.enableActions) {
                this._server.use(this._checkApiKey.bind(this));
                this._server.use(
                    "/actions",
                    this._iu(this._checkValidation.bind(this)).iff(
                        (req: any) => this._routes[req.url] && this._routes[req.url].validate
                    )
                );
                this._server.use(
                    "/actions",
                    this._iu(this._checkAuth.bind(this)).iff(
                        (req: any) =>
                            this._routes[req.url] &&
                            (this._routes[req.url].auth || this._routes[req.url].roles.length > 0)
                    )
                );
            }

            if (config?.enableWebhooks) {
                this._server.use(
                    "/webhooks",
                    this._iu(this._checkValidation.bind(this)).iff(
                        (req: any) => this._routes[req.url] && this._routes[req.url].validate
                    )
                );
            }

            this._server.use(async (req, res, next) => {
                try {
                    this.log.info({ method: req.method, url: req.url, headers: req.headers, body: req.body });
                    await next();
                } catch (err) {
                    return next(err);
                }
            });
            this._server.get("/", (req, res) => {
                res.send({ service: process.env.SERVICE, routes: this._server.routes() });
                res.end();
            });
            this.addOnStartHandler(this._startServer);
            this.addOnStopHandler(this._stopServer);
        } catch (err) {
            this.log.error("Error while constructing HTTPService", err);
            process.exit(1);
        }
    }

    private async _startServer() {
        await this._server.start(this._port, "0.0.0.0");
        this.log.info(`HTTP listening on ${this._port}`);
        if (this._server.routes().length > 0) {
            this.log.info(`with routes \n${this._server.routes().join("\n")}`);
        }
    }

    private async _stopServer() {
        await this._server.close();
    }

    private _checkApiKey(req: Request<Protocol>, res: Response<Protocol>, next: (err?: Error) => void) {
        if (!req.headers["x-api-key"] || req.headers["x-api-key"] !== process.env.API_KEY) {
            throw new ActionsHandlerError("Invalid API Key", null, "FORBIDDEN", 403);
        }
        return next();
    }

    private _checkValidation(req: Request<Protocol>, res: Response<Protocol>, next: (err?: Error) => void) {
        const route = this._routes[req.url];
        const body: any = req.body;
        const validationErrors = route.validate(body);

        if (validationErrors === true) {
            if (!route.auth && route.roles.length > 0 && !route.roles.includes(body.session_variables["x-hasura-role"]))
                throw new ActionsHandlerError("Invalid role", null, "FORBIDDEN", 403);
            req.body = body;
            return next();
        } else
            throw new ActionsHandlerError(
                validationErrors.map((e) => e.message).join(" "),
                { validationErrors },
                "VALIDATION",
                400
            );
    }

    private async _checkAuth(req: RequestExtended<Protocol>, res: Response<Protocol>, next: (err?: Error) => void) {
        try {
            if (!this._routes[req.url].auth) {
                if (this._routes[req.url].roles.length > 0) {
                    const role = req.body.session_variables["x-hasura-role"];

                    if (!this._routes[req.url].roles.includes(role))
                        throw new ActionsHandlerError("Invalid role", null, "FORBIDDEN", 403);
                }

                return next();
            }

            const userId = req.body.session_variables["x-hasura-user-id"];
            if (!userId) throw new ActionsHandlerError("Invalid session variables", null, "UNAUTHORIZED", 401);

            const cachedUserKey = `cpz:users:${userId}`;
            let user: BaseUser;

            const cachedUserJSON = await this.redis.get(cachedUserKey);

            if (cachedUserJSON) {
                const parsed = JSONParse(cachedUserJSON);

                if (parsed != cachedUserJSON) {
                    user = parsed;
                    // Can be used when cached user data will be expiring by (un)blocking
                    //await this.redis.expire(cachedUserKey, 15);
                }
            }

            if (!user) {
                user = await this.db.pg.maybeOne<BaseUser>(sql`
                    SELECT id, status, roles, access, settings, last_active_at
                    FROM users
                    WHERE id = ${userId};
                `);

                if (!user) throw new ActionsHandlerError("User account is not found", null, "NOT_FOUND", 404);

                await this.redis.setex(cachedUserKey, 60, JSON.stringify(user));
            }

            if (user.status == UserStatus.blocked)
                throw new ActionsHandlerError("User blocked", null, "FORBIDDEN", 403);

            if (
                this._routes[req.url].roles.length > 0 &&
                !user.roles?.allowedRoles?.some((userRole) => this._routes[req.url].roles.includes(userRole))
            )
                throw new ActionsHandlerError("Invalid role", null, "FORBIDDEN", 403);

            await this.db.pg.query(this.db.sql`
                UPDATE users
                SET last_active_at = now()
                WHERE id = ${user.id};
            `);

            req.meta = { ...req.meta, user };
            return next();
        } catch (err) {
            return next(err);
        }
    }

    private _errorHandler(err: Error, req: any, res: Response<Protocol>) {
        this.log.warn(err);
        if (err instanceof ActionsHandlerError) {
            res.send(err.response, err.statusCode);
        } else {
            res.send(
                {
                    message: err.message,
                    code: err.name
                },
                400
            );
        }
    }

    private _createRoutes(routes: {
        [key: string]: {
            handler: (req: any, res: any) => Promise<any>;
            auth?: boolean;
            roles?: string[];
            inputSchema?: ValidationSchema;
        };
    }) {
        for (const [name, route] of Object.entries(routes)) {
            const { handler, inputSchema } = route;
            let { auth, roles } = route;
            if (!name) throw new Error("Route name is required");
            if (this._routes[`/actions/${name}`]) throw new Error("This route name is occupied");
            if (!handler && typeof handler !== "function") throw new Error("Route handler must be a function");
            auth = auth || false;
            if (roles && (!Array.isArray(roles) || roles.length === 0))
                throw new Error("Roles must be an array or undefined");
            roles = roles || [];
            let schema: ValidationSchema;

            if (inputSchema !== null || inputSchema === undefined) {
                schema = {
                    action: {
                        type: "object",
                        props: {
                            name: { type: "equal", value: name }
                        }
                    },
                    input: { type: "object", props: inputSchema },

                    session_variables: {
                        type: "object",
                        props: {
                            "x-hasura-user-id": { type: "string", optional: !auth },
                            "x-hasura-role": { type: "string", optional: roles.length === 0 }
                        }
                    }
                };
            }

            this._routes[`/actions/${name}`] = {
                validate: schema && this._v.compile(schema),
                auth,
                roles
            };
            this._server.post(`/actions/${name}`, handler.bind(this));
        }
    }

    get createRoutes() {
        return this._createRoutes;
    }

    private _createWebhooks(routes: {
        [key: string]: {
            handler: (req: any, res: any) => Promise<any>;
            inputSchema?: ValidationSchema;
        };
    }) {
        for (const [name, route] of Object.entries(routes)) {
            const { handler, inputSchema } = route;
            if (!name) throw new Error("Route name is required");
            if (this._routes[`/webhooks/${name}`]) throw new Error("This route name is occupied");
            if (!handler && typeof handler !== "function") throw new Error("Route handler must be a function");

            this._routes[`/webhooks/${name}`] = {
                validate: inputSchema && this._v.compile(inputSchema)
            };
            this._server.post(`/webhooks/${name}`, handler.bind(this));
        }
    }

    get createWebhooks() {
        return this._createWebhooks;
    }

    async HTTPHandler<T>(
        handler: {
            (params: T): Promise<any>;
        },
        req: {
            body: {
                input: T;
            };
        },
        res: any
    ) {
        const result = await handler(req.body.input);

        res.send(result || { result: "OK" });

        res.end();
    }
}
