import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import restana, { Service, Protocol, Request, Response, RequestHandler } from "restana";
import bodyParser from "body-parser";
import helmet from "helmet";
import ifunless from "middleware-if-unless";
import Validator, { ValidationSchema, ValidationError } from "fastest-validator";
import { makeMailgunWebhookValidator, MailGunEventTypes, MailGunEventData, NEWS_LIST } from "@cryptuoso/mail";
import { MailTags } from "@cryptuoso/mail-publisher-events";
import { ActionsHandlerError } from "@cryptuoso/errors";
import { UserSettings } from "@cryptuoso/user-state";

//import fetch from "node-fetch";

/* async function putWebhook(name: string = "opened") {
    // TODO: if this feature need replace node-fetch with other library
    // because this one doesn't supports credentials
    await fetch(
        `https://api:${process.env.MAILGUN_API_KEY}@api.eu.mailgun.net/v3/domains/${process.env.MAILGUN_DOMAIN}/${name}?url=${process.env.DOMAIN}`,
        {
            method: "PUT"
        }
    );
} */

const enum ServiceNames {
    mailgun = "mailgun"
}

export interface WebhooksServiceConfig extends BaseServiceConfig {
    port?: number;
    routes?: {
        [key in ServiceNames]?: string;
    };
}

export default class WebhooksService extends BaseService {
    private _iu: any;
    private _v: Validator;
    private _port: number;
    private _server: Service<Protocol.HTTP>;
    private _servicesRoutes: {
        [key in ServiceNames]: string;
    };
    private _routesValidators: {
        [key: string]: (body: any) => boolean | ValidationError[];
    } = {};

    constructor(config?: WebhooksServiceConfig) {
        super(config);

        try {
            this._iu = ifunless();
            this._v = new Validator();

            this._servicesRoutes = {
                mailgun: config?.routes?.mailgun || process.env.MAILGUN_WEBHOOKS_ROUTE || ServiceNames.mailgun
            };

            this._port = config?.port || +process.env.PORT || 3000;

            this._server = restana({
                errorHandler: this._errorHandler.bind(this)
            });
            this._server.use(helmet() as RequestHandler<Protocol>);
            this._server.use(bodyParser.json());
            this._server.use(
                "/webhooks",
                this._iu(this._checkValidation.bind(this)).iff((req: any) => this._routesValidators[req.url])
            );

            this._createRoutes({
                [this._servicesRoutes.mailgun]: {
                    handler: this.mailgunHandler,
                    validator: makeMailgunWebhookValidator(),
                    schema: {
                        signature: {
                            type: "object",
                            props: {
                                timestamp: "string",
                                token: {
                                    type: "string",
                                    length: 50
                                },
                                signature: "string"
                            }
                        },
                        "event-data": {
                            type: "object",
                            props: {
                                event: "string"
                            }
                        }
                    }
                }
            });

            this.addOnStartHandler(this._startServer);
            this.addOnStopHandler(this._stopServer);
        } catch (err) {
            this.log.error(err, "While consctructing WebhooksService");
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

    private _checkValidation(req: Request<Protocol>, res: Response<Protocol>, next: (err?: Error) => void) {
        const validate = this._routesValidators[req.url];
        const body: any = req.body;
        const validationErrors = validate(body);

        if (validationErrors === true) {
            // fastest validator may change source object
            //req.body = body;
            return next();
        } else throw new ActionsHandlerError("", null, "VALIDATION", 400);
    }

    async mailgunHandler(req: any, res: any) {
        const body = req.body;

        try {
            const data: MailGunEventData = body["event-data"];

            // TODO: validation

            //if (!data) throw new ActionsHandlerError("Unknown event provided", null, "VALIDATION", 400);

            const eventType = data.event?.toUpperCase();

            if (eventType === MailGunEventTypes.OPENED) await this.mailgunOpenedHandler(data);
            else if (eventType === MailGunEventTypes.UNSUBSCRIBED) await this.mailgunUnsubscribedHandler(data);
            else throw new ActionsHandlerError("Unknown event provided", null, "VALIDATION", 400);

            res.end();
        } catch (err) {
            this.log.error(err, `While processing http request (body: ${JSON.stringify(body)})`);
            throw err;
        }
    }

    async mailgunUnsubscribedHandler(data: MailGunEventData) {
        // TODO: check list
        const user = await this.db.pg.maybeOne<{
            id: string;
            settings: UserSettings;
        }>(this.db.sql`
            SELECT id, settings
            FROM users
            WHERE email = ${data.recipient};
        `);

        if (!user) throw new ActionsHandlerError("", null, "NOT_FOUND", 404);

        const oldNotifications = user.settings?.notifications;

        const newSettings: UserSettings = {
            ...user.settings,
            notifications: {
                ...oldNotifications,
                signals: {
                    ...oldNotifications?.signals
                },
                trading: {
                    ...oldNotifications?.trading
                },
                news: {
                    ...oldNotifications?.news
                }
            }
        };

        let updated = false;

        if (data["mailing-list"]?.address === NEWS_LIST && oldNotifications.news.email !== false) {
            updated = true;
            newSettings.notifications.news.email = false;
        }
        if (data.tags.includes(MailTags.SIGNALS) && oldNotifications.signals.email !== false) {
            updated = true;
            newSettings.notifications.signals.email = true;
        }
        if (data.tags.includes(MailTags.TRADING) && oldNotifications.trading.email !== false) {
            updated = true;
            newSettings.notifications.trading.email = true;
        }

        if (updated) {
            await this.db.pg.query(this.db.sql`
                UPDATE users
                SET settings = ${JSON.stringify(newSettings)}
                WHERE id = ${user.id};
            `);
        }
    }

    async mailgunOpenedHandler(data: MailGunEventData) {
        await this.db.pg.query(this.db.sql`
            UPDATE notifications
            SET readed = true
            WHERE mailgun_id = ${data.message.headers["message-id"]};
        `);
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
            schema?: ValidationSchema;
            validator?: (body: any) => boolean;
        };
    }) {
        for (const name of Object.keys(routes)) {
            if (!name) throw new Error("Route name is required");
            if (this._routesValidators[`/webhooks/${name}`]) {
                throw new Error(`This route ${name} is occupied`);
            }
        }

        for (const [name, route] of Object.entries(routes)) {
            const { handler, schema, validator } = route;
            if (!handler && typeof handler !== "function") throw new Error("Route handler must be a function");
            if (validator && typeof validator !== "function") throw new Error("Route validator must be a function");

            let validate: (body: any) => boolean | ValidationError[];
            const schemaValidator = schema && this._v.compile(schema);

            if (validator && schemaValidator) validate = (body: any) => validator(body) && schemaValidator(body);
            else if (validator) validate = validator;
            else if (schemaValidator) validate = schemaValidator;

            if (validate) this._routesValidators[`/webhooks/${name}`] = validate;
            this._server.post(`/webhooks/${name}`, handler.bind(this));
        }
    }
}
