import { Subscription, UserPayment } from "@cryptuoso/billing";
import dayjs from "@cryptuoso/dayjs";
import { GenericObject } from "@cryptuoso/helpers";
import { sql } from "@cryptuoso/postgres";
import { HTTPService, HTTPServiceConfig, RequestExtended } from "@cryptuoso/service";
import { User, UserRoles } from "@cryptuoso/user-state";
import {
    UserSubCancel,
    UserSubCheckout,
    UserSubCheckPayment,
    UserSubCreate,
    UserSubEvents,
    UserSubSchema
} from "@cryptuoso/user-sub-events";
import { BaseError } from "ccxt";

export type UserSubServiceConfig = HTTPServiceConfig;

export default class UserSubService extends HTTPService {
    constructor(config?: UserSubServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                createSubscription: {
                    inputSchema: {
                        name: "string",
                        description: { type: "string", optional: true },
                        available: { type: "number", integer: true },
                        options: { type: "object" },
                        limits: {
                            type: "object",
                            props: {
                                trialNetProfit: { type: "number", optional: true },
                                maxRobots: { type: "number", optional: true }
                            },
                            optional: true
                        }
                    },
                    roles: [UserRoles.admin],
                    handler: this._httpHandler.bind(this, this.createSubscription.bind(this))
                },
                createUserSub: {
                    inputSchema: UserSubSchema[UserSubEvents.CREATE],
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    handler: this._httpHandler.bind(this, this.createUserSub.bind(this))
                },
                cancelUserSub: {
                    inputSchema: UserSubSchema[UserSubEvents.CANCEL],
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    handler: this._httpHandler.bind(this, this.cancelUserSub.bind(this))
                },
                checkoutUserSub: {
                    inputSchema: UserSubSchema[UserSubEvents.CHECKOUT],
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    handler: this._httpHandler.bind(this, this.checkoutUserSub.bind(this))
                },
                checkPayment: {
                    inputSchema: UserSubSchema[UserSubEvents.CHECKOUT],
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    handler: this._httpHandler.bind(this, this.checkPayment.bind(this))
                }
            });
        } catch (err) {
            this.log.error("Failed to initialize UserSubService", err);
        }
    }

    async _httpHandler(
        handler: (user: User, params: GenericObject<any>) => Promise<GenericObject<any>>,
        req: RequestExtended,
        res: any
    ) {
        const result = await handler(req.meta?.user, req.body.input);

        res.send({ result: result || "OK" });
        res.end();
    }

    async createSubscription(user: User, { name, description, available, options, limits }: Subscription) {
        try {
            await this.db.pg.query(sql`INSERT INTO subscriptions 
        (name, 
        description, 
        available,
        options, 
        limits) 
        VALUES (
        ${name},
        ${description || null},
        ${available || null},
        ${JSON.stringify(options) || null},
        ${JSON.stringify(limits) || null}
            ) `);
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }
    async createUserSub(user: User, { subsciptionId, subscriptionOption }: UserSubCreate) {
        try {
            const sameSubscription = await this.db.pg.maybeOneFirst(sql`SELECT id FROM user_subs 
            WHERE user_id = ${user.id} 
            AND subcription_id = ${subsciptionId};
            `);
            if (sameSubscription) throw new BaseError("User subscription already exists");

            const subscription = await this.db.pg.maybeOne<Subscription>(sql`SELECT id, options 
            FROM subscriptions
            WHERE id = ${subsciptionId}
            AND available >= ${user.access};
            `);
            if (!subscription) throw new BaseError("Subscription is not available");
            if (!subscription.options[subscriptionOption]) throw new BaseError("Subscription option doesn't exists");

            const trialSubscription = await this.db.pg.maybeOneFirst(sql`SELECT id FROM user_subs 
            WHERE user_id = ${user.id}
            AND trial_started IS NOT NULL;`);
            let status = "trial";
            if (trialSubscription) status = "pending";

            //TODO: cancel other subscriptions /
            await this.db.pg.query(sql`INSERT INTO user_subs (
               user_id,
               subscription_id,
               subscription_option,
               status,
               trial_started
            ) 
            VALUES (
            ${user.id},
            ${subsciptionId},
            ${subscriptionOption},
            ${status}
            ${status === "trial" ? dayjs.utc().toISOString() : null}
                );`);
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }

    async cancelUserSub(user: User, { subsciptionId }: UserSubCancel) {
        try {
            await this.db.pg.query(sql`UPDATE user_subs
           SET status = ${"canceled"} 
           WHERE id = ${subsciptionId} 
           AND user_id = ${user.id};
           `);
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }

    async checkoutUserSub(user: User, { subsciptionId }: UserSubCheckout): Promise<UserPayment | null> {
        return null;
    }

    async checkPayment(user: User, { code, provider }: UserSubCheckPayment) {
        return { userSubId: "12345" };
    }
}
