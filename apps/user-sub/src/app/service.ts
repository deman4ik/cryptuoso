import { UserPayment, UserSub, coinbaseCommerce, SubscriptionOption } from "@cryptuoso/billing";
import dayjs, { UnitType } from "@cryptuoso/dayjs";
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
    UserSubErrorEvent,
    UserSubInEvents,
    UserSubInSchema,
    UserSubOutEvents,
    UserSubPaymentStatusEvent,
    UserSubStatusEvent
} from "@cryptuoso/user-sub-events";
import { UserRobotRunnerEvents, UserRobotRunnerStop } from "@cryptuoso/user-robot-events";
import { Job } from "bullmq";
import { BaseError } from "ccxt";
import { v4 as uuid } from "uuid";
import { GA } from "@cryptuoso/analytics";

export type UserSubServiceConfig = HTTPServiceConfig;

export default class UserSubService extends HTTPService {
    #expirationAmount = +process.env.SUB_EXPIRATION_AMOUNT || 5;
    #expirationUnit: UnitType = (process.env.SUB_EXPIRATION_UNIT as UnitType) || "day";

    constructor(config?: UserSubServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                createUserSub: {
                    inputSchema: UserSubInSchema[UserSubInEvents.CREATE],
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    handler: this._httpHandler.bind(this, this.createUserSub.bind(this))
                },
                cancelUserSub: {
                    inputSchema: UserSubInSchema[UserSubInEvents.CANCEL],
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    handler: this._httpHandler.bind(this, this.cancelUserSub.bind(this))
                },
                checkoutUserSub: {
                    inputSchema: UserSubInSchema[UserSubInEvents.CHECKOUT],
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    handler: this._httpHandler.bind(this, this.checkoutUserSub.bind(this))
                },
                checkPayment: {
                    inputSchema: UserSubInSchema[UserSubInEvents.CHECK_PAYMENT],
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager, UserRoles.admin],
                    handler: this._httpHandler.bind(this, this.checkPayment.bind(this))
                },
                checkExpiration: {
                    roles: [UserRoles.admin],
                    handler: this._httpHandler.bind(this, this.checkExpiration.bind(this))
                },
                checkTrial: {
                    roles: [UserRoles.admin],
                    handler: this._httpHandler.bind(this, this.checkTrial.bind(this))
                },
                checkPending: {
                    roles: [UserRoles.admin],
                    handler: this._httpHandler.bind(this, this.checkPending.bind(this))
                }
            });

            this.events.subscribe({
                [UserSubInEvents.CHECK_PAYMENT]: {
                    schema: UserSubInSchema[UserSubInEvents.CHECK_PAYMENT],
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
                cron: "0 3 1 * * *"
            },
            attempts: 5,
            backoff: { type: "exponential", delay: 60000 * 10 },
            removeOnComplete: 1,
            removeOnFail: 5
        });
        await this.addJob("user-sub", "checkTrial", null, {
            jobId: "checkTrial",
            repeat: {
                cron: "0 3 * * * *"
            },
            attempts: 5,
            backoff: { type: "exponential", delay: 60000 * 10 },
            removeOnComplete: 1,
            removeOnFail: 5
        });
        await this.addJob("user-sub", "checkPending", null, {
            jobId: "checkPending",
            repeat: {
                cron: "0 3 2 */5 * *"
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
                await this.checkExpiration();
                break;
            case "checkTrial":
                await this.checkExpiration();
                break;
            case "checkPending":
                await this.checkPending();
                break;
            default:
                this.log.error(`Unknow job ${job.name}`);
        }
        return { result: "ok" };
    }

    async checkExpiration() {
        try {
            const currentDate = dayjs.utc().toISOString();
            const expiredSubscriptions = await this.db.pg.any<{
                id: string;
                userId: string;
                status: UserSub["status"];
                subscriptionName: string;
                subscriptionOptionName: string;
                activeTo: string;
                trialEnded: string;
            }>(sql`
                        SELECT id, user_id, status,
                        subscription_name, subscription_option_name,
                        active_to, trial_ended
                        FROM v_user_subs
                        WHERE (status = 'active' AND active_to is not null
                        AND active_to < ${currentDate})
                        OR (status = 'trial'
                        AND trial_ended is not null AND trial_ended  < ${currentDate});`);

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
                await this.events.emit<UserSubStatusEvent>({
                    type: UserSubOutEvents.USER_SUB_STATUS,
                    data: {
                        userSubId: sub.id,
                        userId: sub.userId,
                        status: "expired",
                        context: sub.status,
                        trialEnded: sub.trialEnded,
                        activeTo: sub.activeTo,
                        subscriptionName: sub.subscriptionName,
                        subscriptionOptionName: sub.subscriptionOptionName,
                        timestamp: dayjs.utc().toISOString()
                    }
                });
            }

            const expirationDate = dayjs
                .utc(currentDate)
                .startOf("day")
                .add(this.#expirationAmount, this.#expirationUnit)
                .toISOString();
            const expiringSubscriptions = await this.db.pg.any<{
                id: string;
                userId: string;
                status: UserSub["status"];
                subscriptionName: string;
                subscriptionOptionName: string;
                activeTo: string;
                trialEnded: string;
            }>(sql`
            SELECT id, user_id, status, 
            subscription_name, subscription_option_name,
                active_to, trial_ended
            FROM v_user_subs
            WHERE  (status = 'active' AND active_to is not null
                        AND active_to < ${expirationDate})
                        OR (status = 'trial' AND trial_ended is not null
                        AND trial_ended  < ${expirationDate});`);
            for (const sub of expiringSubscriptions) {
                await this.events.emit<UserSubStatusEvent>({
                    type: UserSubOutEvents.USER_SUB_STATUS,
                    data: {
                        userSubId: sub.id,
                        userId: sub.userId,
                        status: "expiring",
                        context: sub.status,
                        trialEnded: sub.trialEnded,
                        activeTo: sub.activeTo,
                        subscriptionName: sub.subscriptionName,
                        subscriptionOptionName: sub.subscriptionOptionName,
                        timestamp: dayjs.utc().toISOString()
                    }
                });
            }
        } catch (error) {
            this.log.error(`Failed to check expired subscriptions ${error.message}`, error);
            throw error;
        }
    }

    async checkTrial() {
        try {
            const trialSubscriptions = await this.db.pg.any<{
                id: string;
                userId: string;
                status: UserSub["status"];
                subscriptionName: string;
                subscriptionOptionName: string;
                activeTo: string;
                trialEnded: string;
                subscriptionLimits: {
                    trialNetProfit: number;
                };
            }>(sql`
            SELECT id, user_id, status, 
            subscription_name, subscription_option_name,
                active_to, trial_ended, subscription_limits
            FROM v_user_subs where status = 'trial';`);

            for (const sub of trialSubscriptions) {
                if (!sub.trialEnded) {
                    const userStats = await this.db.pg.maybeOne<{ id: string }>(sql`
                    SELECT id 
                      FROM v_user_aggr_stats
                    WHERE user_id = ${sub.userId}
                      AND type = 'userRobot'
                      AND exchange is null
                      AND asset is null
                      AND net_profit > ${sub.subscriptionLimits?.trialNetProfit || 15};
                    `);

                    if (userStats) {
                        await this.db.pg.query(sql`
                        UPDATE user_subs
                          SET trial_ended = ${dayjs
                              .utc()
                              .startOf("day")
                              .add(this.#expirationAmount, this.#expirationUnit)
                              .toISOString()}
                        WHERE id = ${sub.id};
                        `);
                        await this.events.emit<UserSubStatusEvent>({
                            type: UserSubOutEvents.USER_SUB_STATUS,
                            data: {
                                userSubId: sub.id,
                                userId: sub.userId,
                                status: "expiring",
                                context: sub.status,
                                trialEnded: sub.trialEnded,
                                activeTo: sub.activeTo,
                                subscriptionName: sub.subscriptionName,
                                subscriptionOptionName: sub.subscriptionOptionName,
                                timestamp: dayjs.utc().toISOString()
                            }
                        });
                    }
                } else {
                    await this.events.emit<UserSubStatusEvent>({
                        type: UserSubOutEvents.USER_SUB_STATUS,
                        data: {
                            userSubId: sub.id,
                            userId: sub.userId,
                            status: "expiring",
                            context: sub.status,
                            trialEnded: sub.trialEnded,
                            activeTo: sub.activeTo,
                            subscriptionName: sub.subscriptionName,
                            subscriptionOptionName: sub.subscriptionOptionName,
                            timestamp: dayjs.utc().toISOString()
                        }
                    });
                }
            }
        } catch (error) {
            this.log.error(`Failed to check trial subscriptions ${error.message}`, error);
            throw error;
        }
    }

    async checkPending() {
        try {
            const date = dayjs.utc().startOf("day").toISOString();
            const pendingSubscriptions = await this.db.pg.any<{
                id: string;
                userId: string;
                status: UserSub["status"];
                subscriptionName: string;
                subscriptionOptionName: string;
                activeTo: string;
                trialEnded: string;
            }>(sql`
            SELECT id, user_id, status, 
            subscription_name, subscription_option_name,
                active_to, trial_ended
            FROM v_user_subs where (status = 'expired'
            AND ((active_to is not null and active_to < ${date}) 
            OR (trial_ended is not null and trial_ended < ${date})) 
            OR status = 'pending'
            );`);

            for (const sub of pendingSubscriptions) {
                await this.events.emit<UserSubStatusEvent>({
                    type: UserSubOutEvents.USER_SUB_STATUS,
                    data: {
                        userSubId: sub.id,
                        userId: sub.userId,
                        status: sub.status,
                        context: null,
                        trialEnded: sub.trialEnded,
                        activeTo: sub.activeTo,
                        subscriptionName: sub.subscriptionName,
                        subscriptionOptionName: sub.subscriptionOptionName,
                        timestamp: dayjs.utc().toISOString()
                    }
                });
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
               url, context, expires_at, 
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
            url, context,
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
            ${charge.context || null},
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
        const result = await handler(req.body.input, req.meta?.user);

        res.send(result || { result: "OK" });
        res.end();
    }

    async createUserSub({ subscriptionId, subscriptionOption }: UserSubCreate, user?: User) {
        try {
            // Есть ли подписка и опция
            const subscription = await this.db.pg.maybeOne<{
                code: string;
                name: string;
                subscriptionName: string;
            }>(sql`SELECT so.code, so.name, s.name as subscription_name
            FROM subscription_options so , subscriptions s 
            WHERE so.code = ${subscriptionOption} 
            AND so.subscription_id = ${subscriptionId}
            AND so.available >= ${user.access}
            AND so.subscription_id = s.id;
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
            const sameActiveUserSub = await this.db.pg.maybeOne<{ id: string }>(sql`
            SELECT id 
            FROM user_subs
            WHERE user_id = ${user.id}
            AND subscription_id = ${subscriptionId}
            AND subscription_option != ${subscriptionOption}
            AND status in (${"active"},${"trial"},${"pending"})
            ORDER BY created_at DESC LIMIT 1;
            `);
            this.log.info(subscriptionOption, sameActiveUserSub);
            // Если есть, просто меняем опцию
            if (sameActiveUserSub) {
                await this.db.pg.query(sql`
            UPDATE user_subs SET subscription_option = ${subscriptionOption}
            WHERE id = ${sameActiveUserSub.id};
            `);
                return { id: sameActiveUserSub.id };
            }

            // Была ли подписка с триалом
            const trialSubscription = await this.db.pg.maybeOne(sql`SELECT id FROM user_subs 
            WHERE user_id = ${user.id}
            AND trial_started IS NOT NULL ORDER BY created_at DESC LIMIT 1;`);
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
            await this.events.emit<UserSubStatusEvent>({
                type: UserSubOutEvents.USER_SUB_STATUS,
                data: {
                    userSubId: userSub.id,
                    userId: userSub.userId,
                    status: userSub.status,
                    context: null,
                    trialEnded: null,
                    activeTo: null,
                    subscriptionName: subscription.subscriptionName,
                    subscriptionOptionName: subscription.name,
                    timestamp: dayjs.utc().toISOString()
                }
            });
            GA.event(user.id, "subscription", "create");
            return { id: userSub.id };
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }

    async cancelUserSub({ userSubId }: UserSubCancel, user: User) {
        try {
            const { id, userId, status, name, subscriptionName } = await this.db.pg.maybeOne<{
                id: UserSub["id"];
                userId: UserSub["userId"];
                status: UserSub["status"];
                name: string;
                subscriptionName: string;
            }>(sql`select us.id, us.user_id, us.status,
            so.name, s.name as subscription_name
            FROM  user_subs us, subscription_options so, subscriptions s 
           WHERE us.id = ${userSubId} 
           AND us.user_id = ${user.id}
           AND us.subscription_option = so.code
           AND us.subscription_id = so.subscription_id
           AND so.subscription_id = s.id;
           `);

            if (!status) throw new BaseError("User Subscription doesn't exists");

            if (status === "canceled" || status === "expired") throw new BaseError(`User Subscription is ${status}`);

            await this.db.pg.query(sql`UPDATE user_subs
           SET status = ${"canceled"} 
           WHERE id = ${userSubId} 
           AND user_id = ${user.id};
           `);

            const userRobots = await this.db.pg.any<{ id: string }>(sql`
           SELECT id 
           FROM user_robots 
           WHERE user_id = ${user.id} 
           AND status = 'started';`);
            if (userRobots && userRobots.length) {
                for (const { id } of userRobots) {
                    await this.events.emit<UserRobotRunnerStop>({
                        type: UserRobotRunnerEvents.STOP,
                        data: {
                            id,
                            message: "Subscription canceled"
                        }
                    });
                }
            }
            await this.events.emit<UserSubStatusEvent>({
                type: UserSubOutEvents.USER_SUB_STATUS,
                data: {
                    userSubId: id,
                    userId: userId,
                    status: status,
                    context: null,
                    trialEnded: null,
                    activeTo: null,
                    subscriptionName: subscriptionName,
                    subscriptionOptionName: name,
                    timestamp: dayjs.utc().toISOString()
                }
            });
            GA.event(user.id, "subscription", "cancel");
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }

    async checkoutUserSub({ userSubId }: UserSubCheckout, user: User): Promise<{ id: UserPayment["id"] }> {
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
                SELECT id, subscription_option, expires_at
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
            GA.event(user.id, "subscription", "checkout");
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

                const subscription = await this.db.pg.one<SubscriptionOption>(sql`
                SELECT so.name, s.name as subscription_name,
                so.amount, so.unit, so.price_total
                FROM subscription_options so, subscriptions s
                WHERE so.code = ${userSub.subscriptionOption} 
                AND so.subscription_id = ${userSub.subscriptionId}
                AND so.subscription_id = s.id;
                `);

                if (savedUserSub.status === "active") {
                    if (savedUserSub.activeTo === userPayment.subscriptionTo) return { id: userPayment.id };
                } else if (savedUserSub.status === "canceled" || savedUserSub.status === "expired") {
                    this.log.warn(
                        `New ${userPayment.status} payment for ${savedUserSub.status} subscription`,
                        userPayment
                    );
                    await this.events.emit<UserSubErrorEvent>({
                        type: UserSubOutEvents.ERROR,
                        data: {
                            userSubId: savedUserPayment.id,
                            userId: savedUserPayment.userId,
                            subscriptionName: subscription.subscriptionName,
                            subscriptionOptionName: subscription.name,
                            error: `New ${userPayment.status} payment ${userPayment.code} for ${subscription.subscriptionName} ${savedUserSub.status} subscription. Please contact support.`,
                            timestamp: dayjs.utc().toISOString(),
                            userPayment
                        }
                    });
                    throw new BaseError(`New ${userPayment.status} payment for ${savedUserSub.status} subscription`);
                }

                if (subscription.priceTotal > userPayment.price) {
                    this.log.warn(
                        `Wrong payment price ${userPayment.price} for subscription (${subscription.priceTotal})`,
                        userPayment
                    );
                    await this.events.emit<UserSubErrorEvent>({
                        type: UserSubOutEvents.ERROR,
                        data: {
                            userSubId: savedUserPayment.id,
                            userId: savedUserPayment.userId,
                            subscriptionName: subscription.subscriptionName,
                            subscriptionOptionName: subscription.name,
                            error: `Wrong payment ${userPayment.code} price ${userPayment.price} for ${subscription.subscriptionName} subscription (${subscription.priceTotal}). Please contact support.`,
                            timestamp: dayjs.utc().toISOString(),
                            userPayment
                        }
                    });
                    throw new BaseError(
                        `Wrong payment price ${userPayment.price} for subscription (${subscription.priceTotal})`
                    );
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

                await this.events.emit<UserSubPaymentStatusEvent>({
                    type: UserSubOutEvents.PAYMENT_STATUS,
                    data: {
                        userSubId: userPayment.userSubId,
                        userId: userPayment.userId,
                        userPaymentId: userPayment.id,
                        code: userPayment.code,
                        status: userPayment.status,
                        context: null,
                        price: userPayment.price,
                        subscriptionName: subscription.subscriptionName,
                        subscriptionOptionName: subscription.name,
                        timestamp: dayjs.utc().toISOString()
                    }
                });

                await this.events.emit<UserSubStatusEvent>({
                    type: UserSubOutEvents.USER_SUB_STATUS,
                    data: {
                        userSubId: userSub.id,
                        userId: userSub.userId,
                        status: userSub.status,
                        context: null,
                        trialEnded: userSub.trialEnded,
                        activeTo: userSub.activeTo,
                        subscriptionName: subscription.subscriptionName,
                        subscriptionOptionName: subscription.name,
                        timestamp: dayjs.utc().toISOString()
                    }
                });

                GA.purchase(
                    userSub.userId,
                    userPayment.code,
                    userPayment.price,
                    `${subscription.subscriptionName} ${subscription.name}`
                );
            } else if (
                userPayment.status === "EXPIRED" ||
                userPayment.status === "CANCELED" ||
                userPayment.status === "UNRESOLVED"
            ) {
                this.log.info(`User payment ${userPayment.status}`, userPayment);

                const userSub = await this.db.pg.one<{
                    subscriptionName: string;
                    subscriptionOptionName: string;
                }>(sql`
                SELECT
                subscription_name, subscription_option_name
                FROM v_user_subs
                WHERE  id = ${userPayment.userSubId};`);

                await this.events.emit<UserSubPaymentStatusEvent>({
                    type: UserSubOutEvents.PAYMENT_STATUS,
                    data: {
                        userSubId: userPayment.userSubId,
                        userId: userPayment.userId,
                        userPaymentId: userPayment.id,
                        code: userPayment.code,
                        status: userPayment.status,
                        context: null,
                        price: userPayment.price,
                        subscriptionName: userSub.subscriptionName,
                        subscriptionOptionName: userSub.subscriptionOptionName,
                        timestamp: dayjs.utc().toISOString()
                    }
                });
            }
            return { id: userPayment.id };
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }
}
