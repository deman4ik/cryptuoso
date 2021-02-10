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
import { UserRobotRunnerEvents, UserRobotRunnerStop } from "@cryptuoso/user-robot-events";
import { Job } from "bullmq";
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
            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error("Failed to initialize UserSubService", err);
        }
    }

    async onServiceStart() {
        this.createQueue("user-sub");

        this.createWorker("user-sub", this.process);
        await this.addJob("user-sub", "checkExpiration", null, {
            jobId: "checkExpiration",
            repeat: {
                cron: "0 0 1 * * *"
            },
            attempts: 5,
            backoff: { type: "exponential", delay: 60000 * 10 },
            removeOnComplete: 1,
            removeOnFail: 5
        });
    }

    async process(job: Job) {
        switch (job.name) {
            case "checkExpiration":
                await this.checkSubscriptions();
                break;
            default:
                this.log.error(`Unknow job ${job.name}`);
        }
        return { result: "ok" };
    }

    async checkSubscriptions() {
        try {
            await this.checkExpiration();
            await this.checkTrial();
        } catch (error) {
            this.log.error(`Failed to check subscriptions ${error.message}`, error);
            throw error;
        }
    }

    async checkExpiration() {
        try {
            const currentDate = dayjs.utc().toISOString();
            const expiredSubscriptions = await this.db.pg.any<{ id: string; userId: string }>(sql`
                        SELECT id, user_id
                        FROM user_subs
                        WHERE (status = 'active'
                        AND active_to < ${currentDate})
                        OR (status = 'trial'
                        AND trial_ended  < ${currentDate});`);

            for (const sub of expiredSubscriptions) {
                const userRobots = await this.db.pg.any<{ id: string }>(sql`
                            SELECT id 
                            FROM user_robots 
                            WHERE user_id = ${sub.userId} 
                            AND status = 'started';`);
                if (userRobots && userRobots.length) {
                    for (const { id } of userRobots) {
                        await this.events.emit<UserRobotRunnerStop>({
                            type: UserRobotRunnerEvents.STOP,
                            data: {
                                id,
                                message: "Subscription expired"
                            }
                        });
                    }
                }
                await this.db.pg.query(sql`
                            UPDATE user_subs 
                            SET status = 'expired'
                            WHERE id = ${sub.id};`);
                //TODO: send notification
            }

            const expirationDate = dayjs.utc(currentDate).startOf("day").add(5, "day").toISOString();
            const expiringSubscriptions = await this.db.pg.any<{
                id: string;
                userId: string;
                status: UserSub["status"];
            }>(sql`
            SELECT id, user_id, status
            FROM user_subs
            WHERE  (status = 'active'
                        AND active_to < ${expirationDate})
                        OR (status = 'trial'
                        AND trial_ended  < ${expirationDate});`);
            for (const sub of expiringSubscriptions) {
                if (sub.status === "active") {
                    //TODO: send notification
                } else if (sub.status === "trial") {
                    //TODO: send notification
                }
            }
        } catch (error) {
            this.log.error(`Failed to check expired subscriptions ${error.message}`, error);
            throw error;
        }
    }

    async checkTrial() {
        try {
            const trialSubscriptions = await this.db.pg.any<{ id: string; trialEnded: string; userId: string }>(sql`
            SELECT id, trial_ended, user_id
            FROM user_subs where status = 'trial';`);

            for (const sub of trialSubscriptions) {
                if (!sub.trialEnded) {
                    const userStats = await this.db.pg.maybeOne<{ id: string }>(sql`
                    SELECT id 
                      FROM v_user_aggr_stats
                    WHERE user_id = ${sub.userId}
                      AND type = 'userRobot'
                      AND exchange is null
                      AND asset is null
                      AND net_profit > 15;
                    `);

                    if (userStats) {
                        await this.db.pg.query(sql`
                        UPDATE user_subs
                          SET trial_ended = ${dayjs.utc().startOf("day").add(5, "day").toISOString()}
                        WHERE id = ${sub.id};
                        `);
                        //TODO: send notification
                    }
                } else {
                    //TODO: send notification
                }
            }
        } catch (error) {
            this.log.error(`Failed to check trial subscriptions ${error.message}`, error);
            throw error;
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
        SELECT id, user_id, user_sub_id, provider, code, status,
               price, created_at, 
               subscription_from, subscription_to, subscription_option,
               url, expires_at, 
               addresses, 
               pricing,
               info   
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
            id, user_id, user_sub_id, provider, code,
            status, price,  created_at,
            subscription_from, subscription_to,
            subscription_option,
            url,
            expires_at, addresses, 
            pricing,
            info
        ) VALUES (
            ${charge.id},
            ${charge.userId},
            ${charge.userSubId},
            ${charge.provider},
            ${charge.code},
            ${charge.status},
            ${charge.price},
            ${charge.createdAt || null},
            ${charge.subscriptionFrom || null},
            ${charge.subscriptionTo || null},
            ${charge.subscriptionOption},
            ${charge.url || null},
            ${charge.expiresAt || null},
            ${JSON.stringify(charge.addresses) || null},
            ${JSON.stringify(charge.pricing) || null},
            ${JSON.stringify(charge.info) || null}
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

        res.send(result || { result: "OK" });
        res.end();
    }

    async _checkPaymentHttpHandler(
        handler: (user: User, params: GenericObject<any>) => Promise<GenericObject<any>>,
        req: RequestExtended,
        res: any
    ) {
        const result = await handler(req.body.input, req.meta?.user);

        res.send(result || { result: "OK" });
        res.end();
    }

    async createUserSub(user: User, { subscriptionId, subscriptionOption }: UserSubCreate) {
        try {
            // Есть ли подписка и опция
            const subscription = await this.db.pg.maybeOne<{ code: string }>(sql`SELECT code 
            FROM subscription_options
            WHERE code = ${subscriptionOption} 
            AND subscription_id = ${subscriptionId}
            AND available >= ${user.access};
            `);
            if (!subscription) throw new BaseError("Subscription is not available");

            // Есть ли такая же не отмененная подписка пользователя
            const sameUserSubs = await this.db.pg.any<{
                status: UserSub["status"];
            }>(sql`SELECT status FROM user_subs 
            WHERE user_id = ${user.id} 
            AND subscription_id = ${subscriptionId}
            AND subscription_option = ${subscriptionOption}
            AND status not in (${"canceled"},${"expired"});
            `);
            if (sameUserSubs && sameUserSubs?.length) throw new BaseError("User subscription already exists");

            // Есть ли такая же подписка пользователя с другой опцией
            const sameActiveUserSub = await this.db.pg.maybeOneFirst<{ id: string }>(sql`
            SELECT id 
            FROM user_subs
            WHERE user_id = ${user.id}
            AND subscription_id = ${subscriptionId}
            AND subscription_option != ${subscriptionOption}
            AND status in (${"active"},${"trial"},${"pending"})
            ORDER BY created_at DESC;
            `);
            // Если есть, просто меняем опцию
            if (sameActiveUserSub) {
                await this.db.pg.query(sql`
            UPDATE user_subs SET subscription_option = ${subscriptionOption}
            WHERE id = ${sameActiveUserSub.id};
            `);
                return { id: sameActiveUserSub.id };
            }

            // Была ли подписка с триалом
            const trialSubscription = await this.db.pg.maybeOneFirst(sql`SELECT id FROM user_subs 
            WHERE user_id = ${user.id}
            AND trial_started IS NOT NULL;`);
            let status: UserSub["status"] = "trial";
            // Если была, сразу ожидаем оплату
            if (trialSubscription) status = "pending";

            const userSub: UserSub = {
                id: uuid(),
                userId: user.id,
                subscriptionId,
                subscriptionOption,
                status,
                trialStarted: status === "trial" ? dayjs.utc().toISOString() : null // если начинаем с триала, устанавливаем дату начала
            };
            await this._saveUserSub(userSub);
            return { id: userSub.id };
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

    async checkoutUserSub(user: User, { userSubId }: UserSubCheckout): Promise<{ id: UserPayment["id"] }> {
        try {
            const userSub: UserSub = await this._getUserSubById(userSubId);

            if (userSub.status === "canceled" || userSub.status === "expired")
                throw new BaseError(`Subscription is ${userSub.status}. Please create a new one.`);

            // Оставляем возможность админу сгенерировать платеж вручную
            if (!user.roles.allowedRoles.includes(UserRoles.admin) && userSub.userId != user.id)
                throw new ActionsHandlerError("Wrong user subscription", null, "FORBIDDEN", 403);

            userSub.subscription = await this.db.pg.one<SubscriptionOption>(sql`
            SELECT s.name AS subscription_name, 
            s.description AS subscription_description, 
            so.name,
            so.price_total,
            so.amount,
            so.unit
            FROM subscription_options so, subscriptions s 
            WHERE so.code = ${userSub.subscriptionOption} 
            AND so.subscription_id = ${userSub.subscriptionId}
            AND so.subscription_id = s.id;
            `);

            let userPayment = await this.db.pg.maybeOne<UserPayment>(sql`
                SELECT id, user_id, user_sub_id, provider, code, status,
                       price, created_at, 
                       subscription_from, subscription_to, subscription_option,
                       url, expires_at, 
                       addresses, 
                       pricing,
                       info 
                FROM user_payments 
                WHERE user_id = ${user.id} 
                AND user_sub_id = ${userSubId} ORDER BY created_at DESC LIMIT 1;`);

            // Если уже есть платеж, за ту же опцию и он еще не истек
            if (
                userPayment &&
                userPayment.subscriptionOption === userSub.subscriptionOption &&
                dayjs.utc(userPayment.expiresAt).valueOf() > dayjs.utc().valueOf()
            )
                // Возвращаем текущий платеж
                return { id: userPayment.id };

            let subscriptionFrom;
            // Eсли подписка уже была активна - продлеваем
            if (
                userSub.activeTo &&
                dayjs.utc(userSub.activeTo).startOf("day").valueOf() > dayjs.utc().startOf("day").valueOf()
            ) {
                subscriptionFrom = dayjs.utc(userSub.activeTo).toISOString();
            } else {
                subscriptionFrom = dayjs.utc().startOf("day").toISOString();
            }

            userPayment = await coinbaseCommerce.createCharge({
                userId: userSub.userId,
                userSubId: userSub.id,
                subscriptionId: userSub.subscriptionId,
                subscriptionOption: userSub.subscriptionOption,
                subscriptionFrom,
                subscriptionTo: dayjs
                    .utc(subscriptionFrom)
                    .add(userSub.subscription.amount, userSub.subscription.unit)
                    .startOf("day")
                    .toISOString(),
                name: `${userSub.subscription.subscriptionName} (${userSub.subscription.name})`,
                description: userSub.subscription.subscriptionDescription,
                price: userSub.subscription.priceTotal
            });

            await this._saveUserPayment(userPayment);

            return { id: userPayment.id };
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

            if (["COMPLETED", "RESOLVED", "EXPIRED", "CANCELED"].includes(savedUserPayment.status))
                return {
                    id: savedUserPayment.id
                };

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

                if (userSub.status === "trial" || userSub.status === "pending")
                    userSub.activeFrom = userPayment.subscriptionFrom;
                userSub.activeTo = userPayment.subscriptionTo;
                userSub.status = "active";

                await this._saveUserSub(userSub);
            } else if (
                userPayment.status === "EXPIRED" ||
                userPayment.status === "CANCELED" ||
                userPayment.status === "UNRESOLVED"
            ) {
                this.log.info(`User payment ${userPayment.status}`, userPayment);
                //TODO: Send notification
            }
            return { id: userPayment.id };
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }
}
