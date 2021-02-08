import { Subscription, UserPayment, UserSub, coinbaseCommerce, SubscriptionOption } from "@cryptuoso/billing";
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
                    inputSchema: UserSubSchema[UserSubEvents.CHECK_PAYMENT],
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager, UserRoles.admin],
                    handler: this._checkPaymentHttpHandler.bind(this, this.checkPayment.bind(this))
                }
            });

            this.events.subscribe({
                [UserSubEvents.CHECK_PAYMENT]: {
                    schema: UserSubSchema[UserSubEvents.CHECK_PAYMENT],
                    handler: this.checkPayment.bind(this)
                }
            });
        } catch (err) {
            this.log.error("Failed to initialize UserSubService", err);
        }
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
        SELECT id, user_id, user_sub_id, provider, status,
            expires_at, addresses, 
            code, pricing,
            price, info, created_at
        FROM user_payments where id = ${chargeId};
        `);
    }

    async _saveUserSub(userSub: UserSub) {
        await this.db.pg.query(sql`INSERT INTO user_subs (
            id,
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
        data = excluded.data;`);
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

    async _checkPaymentHttpHandler(
        handler: (user: User, params: GenericObject<any>) => Promise<GenericObject<any>>,
        req: RequestExtended,
        res: any
    ) {
        const result = await handler(req.body.input, req.meta?.user);

        res.send({ result: result || "OK" });
        res.end();
    }

    async createUserSub(user: User, { subscriptionId, subscriptionOption }: UserSubCreate) {
        try {
            const sameUserSubs = await this.db.pg.any<{
                status: UserSub["status"];
            }>(sql`SELECT status FROM user_subs 
            WHERE user_id = ${user.id} 
            AND subscription_id = ${subscriptionId}
            AND subscription_option = ${subscriptionOption};
            `);
            if (
                sameUserSubs &&
                sameUserSubs?.length &&
                sameUserSubs.filter(({ status }) => status !== "canceled" && status !== "expired").length
            )
                throw new BaseError("User subscription already exists");

            const subscription = await this.db.pg.maybeOne<{ code: string }>(sql`SELECT code 
            FROM subscription_options
            WHERE code = ${subscriptionOption} 
            AND subscription_id = ${subscriptionId}
            AND available >= ${user.access};
            `);
            if (!subscription) throw new BaseError("Subscription is not available");

            const trialSubscription = await this.db.pg.maybeOneFirst(sql`SELECT id FROM user_subs 
            WHERE user_id = ${user.id}
            AND trial_started IS NOT NULL;`);
            let status: UserSub["status"] = "trial";
            if (trialSubscription) status = "pending";

            const userSub: UserSub = {
                id: uuid(),
                userId: user.id,
                subscriptionId,
                subscriptionOption,
                status,
                trialStarted: status === "trial" ? dayjs.utc().toISOString() : null
            };
            await this._saveUserSub(userSub);
            return userSub.id;
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

            userSub.subscription = await this.db.pg.one<SubscriptionOption>(sql`
            SELECT s.name AS subscription_name, 
            s.description AS subscription_description, 
            so.name,
            so.price_total
            FROM subscription_options so, subscriptions s 
            WHERE so.code = ${userSub.subscriptionOption} 
            AND so.subscription_id = ${userSub.subscriptionId}
            AND so.subscription_id = s.id;
            `);

            const userPayment = await coinbaseCommerce.createCharge({
                userId: userSub.userId,
                userSubId: userSub.id,
                subscriptionId: userSub.subscriptionId,
                subscriptionOption: userSub.subscriptionOption,
                name: `${userSub.subscription.subscriptionName} (${userSub.subscription.name})`,
                description: userSub.subscription.subscriptionDescription,
                price: userSub.subscription.priceTotal
            });

            await this._saveUserPayment(userPayment);

            return userPayment;
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }

    async checkPayment({ chargeId, provider }: UserSubCheckPayment, user: User) {
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

                if (savedUserSub.status === "canceled" || savedUserSub.status === "expired") {
                    this.log.error(`New payment for ${savedUserSub.status} subscription`, userPayment);
                    //TODO: emit error event
                }

                const subscription = await this.db.pg.one<SubscriptionOption>(sql`
                SELECT 
                so.amount, so.unit, so.price_total
                FROM subscription_options so
                WHERE code = ${userSub.subscriptionOption} 
                AND subscription_id = ${userSub.subscriptionId};
                `);

                if (subscription.priceTotal > userPayment.price) {
                    this.log.error("Wrong payment price", userPayment);
                    //TODO: emit error event
                }
                const currentTime = dayjs.utc().toISOString();

                if (userSub.status === "trial") {
                    userSub.trialEnded = currentTime;
                }

                if (userSub.status === "trial" || userSub.status === "pending") userSub.activeFrom = currentTime;
                userSub.activeTo = dayjs.utc(currentTime).add(subscription.amount, subscription.unit).toISOString();
                userSub.status = "active";

                await this._saveUserSub(userSub);
            } else if (userPayment.status === "EXPIRED" || userPayment.status === "CANCELED") {
                this.log.info(`User payment ${userPayment.status}`, userPayment);
                //TODO: Send notification
                return;
            }
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }
}
