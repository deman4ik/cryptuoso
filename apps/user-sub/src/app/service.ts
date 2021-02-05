import { Subscription, UserPayment, UserSub, coinbaseCommerce } from "@cryptuoso/billing";
import dayjs from "@cryptuoso/dayjs";
import { ActionsHandlerError } from "@cryptuoso/errors";
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
import { v4 as uuid } from "uuid";

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
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager, UserRoles.admin],
                    handler: this._httpHandler.bind(this, this.checkPayment.bind(this))
                }
            });
        } catch (err) {
            this.log.error("Failed to initialize UserSubService", err);
        }
    }

    async _getSubscriptionById(subscriptionId: string): Promise<Subscription> {
        return this.db.pg.one<Subscription>(sql`
        SELECT id, name, description, options, limits 
        FROM subscriptions where id = ${subscriptionId};
        `);
    }

    async _getUserSubById(userSubId: string): Promise<UserSub> {
        return this.db.pg.one<UserSub>(sql`
        SELECT us.id, us.user_id, us.subscription_id, us.subscription_option, 
        us.status, us.active_from, us.active_to, us.trial_started, us.trial_ended
        FROM user_subs us
        WHERE us.id = ${userSubId};
        `);
    }

    async _getUserPaymentById(chargeId: string): Promise<UserPayment> {
        return this.db.pg.one<UserPayment>(sql`
        SELECT  id, user_id, user_sub_id, provider, status,
            expires_at, addresses, 
            code, pricing,
            price, info, created_at
        FROM user_payments where id = ${chargeId};
        `);
    }

    async _saveUserSub(userSub: UserSub) {
        await this.db.pg.query(sql`INSERT INTO user_subs (
            id
            user_id,
            subscription_id,
            subscription_option,
            status,
            active_from,
            active_to,
            trial_started,
            trial_ended,
            data
         ) 
         VALUES (
          ${userSub.id},
         ${userSub.userId},
         ${userSub.subscriptionId},
         ${userSub.subscriptionOption},
         ${userSub.status},
         ${userSub.activeFrom || null},
         ${userSub.activeTo || null},
         ${userSub.trialStarted || null},
         ${userSub.trialEnded || null},
         ${JSON.stringify(userSub.data) || null}
             )
             ON CONFLICT ON CONSTRAINT user_subs_pkey
        DO UPDATE SET status = excluded.status,
        active_from = excluded.active_from,
        active_to = excluded.active_to,
        trial_started = excluded.trial_started,
        trial_ended = excluded.trial_ended,
        data = excluded.data,
             ;`);
    }

    async _saveUserPayment(charge: UserPayment) {
        await this.db.pg.query(sql`
        INSERT INTO user_payments
        (
            id, user_id, user_sub_id, provider, status,
            expires_at, addresses, 
            code, pricing,
            price, info, created_at
        ) VALUES (
            ${charge.id},
            ${charge.userId},
            ${charge.userSubId},
            ${charge.provider},
            ${charge.status},
            ${charge.expiresAt || null},
            ${JSON.stringify(charge.addresses) || null},
            ${charge.code},
            ${JSON.stringify(charge.pricing) || null},
            ${charge.price},
            ${JSON.stringify(charge.info) || null},
            ${charge.createdAt || null}
        )  ON CONFLICT ON CONSTRAINT user_payments_pkey
        DO UPDATE SET status = excluded.status,
        info = excluded.info;
        `);
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

    async createUserSub(user: User, { subscriptionId, subscriptionOption }: UserSubCreate) {
        try {
            const sameSubscription = await this.db.pg.maybeOneFirst(sql`SELECT id FROM user_subs 
            WHERE user_id = ${user.id} 
            AND subcription_id = ${subscriptionId};
            `);
            if (sameSubscription) throw new BaseError("User subscription already exists");

            const subscription = await this.db.pg.maybeOne<Subscription>(sql`SELECT id, options 
            FROM subscriptions
            WHERE id = ${subscriptionId}
            AND available >= ${user.access};
            `);
            if (!subscription) throw new BaseError("Subscription is not available");
            if (!subscription.options[subscriptionOption]) throw new BaseError("Subscription option doesn't exists");

            const trialSubscription = await this.db.pg.maybeOneFirst(sql`SELECT id FROM user_subs 
            WHERE user_id = ${user.id}
            AND trial_started IS NOT NULL;`);
            let status: UserSub["status"] = "trial";
            if (trialSubscription) status = "pending";

            //TODO: cancel other subscriptions /
            const userSub: UserSub = {
                id: uuid(),
                userId: user.id,
                subscriptionId,
                subscriptionOption,
                status,
                trialStarted: status === "trial" ? dayjs.utc().toISOString() : null
            };
            await this._saveUserSub(userSub);
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }

    async cancelUserSub(user: User, { userSubId }: UserSubCancel) {
        try {
            await this.db.pg.query(sql`UPDATE user_subs
           SET status = ${"canceled"} 
           WHERE id = ${userSubId} 
           AND user_id = ${user.id};
           `);
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }

    async checkoutUserSub(user: User, { userSubId }: UserSubCheckout): Promise<UserPayment> {
        try {
            const userSub: UserSub = await this._getUserSubById(userSubId);

            if (!user.roles.allowedRoles.includes(UserRoles.admin) && userSub.userId != user.id)
                throw new ActionsHandlerError("Wrong user subscription", null, "FORBIDDEN", 403);

            userSub.subscription = await this._getSubscriptionById(userSub.subscriptionId);

            const userPayment = await coinbaseCommerce.createCharge({
                userId: userSub.userId,
                userSubId: userSub.id,
                name: userSub.subscription.name, //TODO add option to name
                description: userSub.subscription.description,
                price: userSub.subscription.options[userSub.subscriptionOption].price
            });

            await this._saveUserPayment(userPayment);

            return userPayment;
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }

    async checkPayment(user: User, { chargeId, provider }: UserSubCheckPayment) {
        try {
            if (provider != "coinbase.commerce") throw new BaseError("Unknown provider");

            const savedUserPayment: UserPayment = await this._getUserPaymentById(chargeId);

            if (user && !user?.roles?.allowedRoles?.includes(UserRoles.admin) && savedUserPayment?.userId != user?.id)
                throw new ActionsHandlerError("Wrong user payment", null, "FORBIDDEN", 403);

            if (["COMPLETED", "RESOLVED", "EXPIRED", "CANCELED"].includes(savedUserPayment.status)) return;

            const charge = await coinbaseCommerce.getCharge(chargeId);

            const userPayment = {
                ...savedUserPayment,
                status: charge.timeline[charge.timeline.length - 1].status,
                info: charge
            };

            await this._saveUserPayment(userPayment);

            if (userPayment.status === "COMPLETED" || userPayment.status === "RESOLVED") {
                const savedUserSub = await this._getUserSubById(savedUserPayment.userSubId);

                const userSub = { ...savedUserSub };

                if (savedUserSub.status === "canceled" || savedUserSub.status === "active") return;

                const currentTime = dayjs.utc().toISOString();
                userSub.activeFrom = currentTime;
                if (savedUserSub.status === "trial" && savedUserSub.trialStarted) userSub.trialEnded = currentTime;

                userSub.status = "active";

                await this._saveUserSub(userSub);
            } else if (userPayment.status === "EXPIRED" || userPayment.status === "CANCELED") {
                //TODO: Send notification
                return;
            }
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }
}
