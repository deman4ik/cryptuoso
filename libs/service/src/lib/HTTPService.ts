import restana, { Service, Protocol, Request, Response, RequestHandler } from "restana";
import ifunless from "middleware-if-unless";
import bodyParser from "body-parser";
import helmet from "helmet";
import Validator, { ValidationSchema, ValidationError } from "fastest-validator";
import { BaseService, BaseServiceConfig } from "./BaseService";
import { ActionsHandlerError } from "@cryptuoso/errors";

//TODO: req/res typings
export interface ActionPayload {
    action: {
        name: string;
    };
    input: { [key: string]: any };
    session_variables: { [key: string]: string };
}

export interface HTTPServiceConfig extends BaseServiceConfig {
    port?: number;
}

export class HTTPService extends BaseService {
    private _iu: any;
    private _v: Validator;
    private _port: number;
    private _server: Service<Protocol.HTTP>;
    private _routes: {
        [key: string]: {
            validate: (value: any) => true | ValidationError[];
            auth: boolean;
            roles: string[];
        };
    } = {};
    constructor(config?: HTTPServiceConfig) {
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
                    (req: any) => this._routes[req.url] && this._routes[req.url].auth
                )
            );
            this._server.use(async (req, res, next) => {
                try {
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
            this.log.error(err, "While consctructing HTTPService");
            process.exit(1);
        }
    }

    private async _startServer() {
        this._server.start(this._port, "0.0.0.0");
        this.log.info(`HTTP listening on ${this._port}`);
        if (this._server.routes().length > 0) {
            this.log.info(`with routes \n${this._server.routes().join("\n")}`);
        }
    }

    private async _stopServer() {
        this._server.close();
    }

    private _checkApiKey(req: Request<Protocol>, res: Response<Protocol>, next: (err?: Error) => void) {
        if (!req.headers["x-api-key"] || req.headers["x-api-key"] !== process.env.API_KEY) {
            throw new ActionsHandlerError("Forbidden: Invalid API Key", null, "FORBIDDEN", 403);
        }
        return next();
    }

    private _checkValidation(req: Request<Protocol>, res: Response<Protocol>, next: (err?: Error) => void) {
        const body = req.body;
        const validationErrors = this._routes[req.url].validate(body);
        if (validationErrors === true) {
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

    private _checkAuth(req: any, res: Response<Protocol>, next: (err?: Error) => void) {
        try {
            this.log.debug(req.body);
            const userId = req.body.session_variables["x-hasura-user-id"];
            if (!userId)
                throw new ActionsHandlerError("Unauthorized: Invalid session variables", null, "UNAUTHORIZED", 401);

            const role = req.body.session_variables["x-hasura-role"];

            if (!this._routes[req.url].roles || !this._routes[req.url].roles.includes(role))
                throw new ActionsHandlerError("Forbidden: Invalid role", null, "FORBIDDEN", 403);

            //TODO: check user in DB and cache in Redis
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
            const { handler } = route;
            let { auth, roles, inputSchema } = route;
            if (!name) throw new Error("Route name is required");
            if (!handler && typeof handler !== "function") throw new Error("Route handler must be a function");
            auth = auth || false;
            roles = roles || [];
            inputSchema = inputSchema || undefined;
            const schema: ValidationSchema = {
                action: {
                    type: "object",
                    props: {
                        name: { type: "equal", value: name }
                    }
                },
                input: { type: "object", props: inputSchema },
                // eslint-disable-next-line @typescript-eslint/camelcase
                session_variables: {
                    type: "object",
                    props: {
                        "x-hasura-user-id": { type: "string", optional: !auth },
                        "x-hasura-role": { type: "string", optional: roles.length === 0 }
                    }
                }
            };
            this._routes[`/actions/${name}`] = {
                validate: this._v.compile(schema),
                auth,
                roles
            };
            this._server.post(`/actions/${name}`, handler.bind(this));
        }
    }

    get createRoutes() {
        return this._createRoutes;
    }
}
