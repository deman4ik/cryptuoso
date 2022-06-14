import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import {
    User,
    UserRoles,
    UserExchangeAccount,
    UserExchangeKeys,
    UserExchangeAccStatus,
    UserExchangeAccBalances,
    UserSettings,
    Notification
} from "@cryptuoso/user-state";
import { RobotStatus } from "@cryptuoso/robot-types";
import { UserRobotStatus } from "@cryptuoso/user-robot-state";
import { ActionsHandlerError } from "@cryptuoso/errors";
import { sql } from "@cryptuoso/postgres";
import { v4 as uuid } from "uuid";
import dayjs, { UnitType } from "@cryptuoso/dayjs";
import { spawn, Pool, Worker as ThreadsWorker } from "threads";
import { Encrypt } from "./encryptWorker";
import { chunkArray, formatExchange } from "@cryptuoso/helpers";
import { PrivateConnector } from "@cryptuoso/ccxt-private";
import { GA } from "@cryptuoso/analytics";
import { UserExAccKeysChangedEvent, UserExAccOutEvents } from "@cryptuoso/user-events";

import { UserPayment, UserSub, coinbaseCommerce, SubscriptionOption, Subscription } from "@cryptuoso/billing";
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
import { UserRobotRunnerEvents, UserRobotRunnerStopPortfolio } from "@cryptuoso/user-robot-events";
import { Job } from "bullmq";
import { BaseError } from "@cryptuoso/errors";
import mailUtil from "@cryptuoso/mail";

interface SupportMessage {
    id?: string;
    from: string;
    to: string;
    data: {
        message: string;
    };
    timestamp: string;
}

export type UserServiceConfig = HTTPServiceConfig;

export default class UserService extends HTTPService {
    private pool: Pool<any>;
    #expirationAmount = +process.env.SUB_EXPIRATION_AMOUNT || 5;
    #expirationUnit: UnitType = (process.env.SUB_EXPIRATION_UNIT as UnitType) || "day";

    constructor(config?: UserServiceConfig) {
        super(config);

        try {
            this.createRoutes({
                //#region "User Settings Schemes"
                userSetNotificationSettings: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        signalsTelegram: {
                            type: "boolean",
                            optional: true
                        },
                        signalsEmail: {
                            type: "boolean",
                            optional: true
                        },
                        tradingTelegram: {
                            type: "boolean",
                            optional: true
                        },
                        tradingEmail: {
                            type: "boolean",
                            optional: true
                        },
                        newsTelegram: {
                            type: "boolean",
                            optional: true
                        },
                        newsEmail: {
                            type: "boolean",
                            optional: true
                        }
                    },
                    handler: this.HTTPWithAuthHandler.bind(this, this.userSetNotificationSettings.bind(this))
                },
                userChangeName: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        name: {
                            type: "string",
                            trim: true,
                            empty: false
                        }
                    },
                    handler: this.HTTPWithAuthHandler.bind(this, this.userChangeName.bind(this))
                },
                //#endregion "User Settings Schemes"

                //#region "User Exchange Account Schemes"
                userExchangeAccUpsert: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: {
                            type: "uuid",
                            optional: true
                        },
                        exchange: "string",
                        name: { type: "string", empty: false, trim: true, optional: true },
                        keys: {
                            type: "object",
                            props: {
                                key: { type: "string", empty: false, trim: true },
                                secret: { type: "string", empty: false, trim: true },
                                pass: {
                                    type: "string",
                                    optional: true,
                                    empty: false,
                                    trim: true
                                }
                            }
                        },
                        allocation: {
                            type: "enum",
                            values: ["shared", "dedicated"],
                            optional: true,
                            default: "shared"
                        }
                    },
                    handler: this.HTTPWithAuthHandler.bind(this, this.userExchangeAccUpsert.bind(this))
                },
                userExchangeAccChangeName: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: "uuid",
                        name: { type: "string", empty: false, trim: true }
                    },
                    handler: this.HTTPWithAuthHandler.bind(this, this.userExchangeAccChangeName.bind(this))
                },
                userExchangeAccDelete: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: "uuid"
                    },
                    handler: this.HTTPWithAuthHandler.bind(this, this.userExchangeAccDelete.bind(this))
                },
                //#endregion "User Exchange Account Schemes"

                //#region "User Subscription Schemes"
                userSubCreate: {
                    inputSchema: UserSubInSchema[UserSubInEvents.CREATE],
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    handler: this.HTTPWithAuthHandler.bind(this, this.userSubCreate.bind(this))
                },
                userSubCancel: {
                    inputSchema: UserSubInSchema[UserSubInEvents.CANCEL],
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    handler: this.HTTPWithAuthHandler.bind(this, this.userSubCancel.bind(this))
                },
                userSubCheckout: {
                    inputSchema: UserSubInSchema[UserSubInEvents.CHECKOUT],
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    handler: this.HTTPWithAuthHandler.bind(this, this.userSubCheckout.bind(this))
                },
                userSubCheckPayment: {
                    inputSchema: UserSubInSchema[UserSubInEvents.CHECK_PAYMENT],
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager, UserRoles.admin],
                    handler: this.HTTPWithAuthHandler.bind(this, this.userSubCheckPayment.bind(this))
                },
                userSubCheckExpiration: {
                    roles: [UserRoles.admin],
                    handler: this.HTTPWithAuthHandler.bind(this, this.userSubCheckExpiration.bind(this))
                },
                userSubCheckTrial: {
                    roles: [UserRoles.admin],
                    handler: this.HTTPWithAuthHandler.bind(this, this.userSubCheckTrial.bind(this))
                },
                userSubCheckPending: {
                    roles: [UserRoles.admin],
                    handler: this.HTTPWithAuthHandler.bind(this, this.userSubCheckPending.bind(this))
                },
                //#endregion "User Subscription Schemes"

                //#region "Support Schemes"
                userSupportMessage: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        message: "string"
                    },
                    handler: this.HTTPWithAuthHandler.bind(this, this.userSupportMessage.bind(this))
                },
                managerReplySupportMessage: {
                    auth: true,
                    roles: [UserRoles.manager, UserRoles.admin],
                    inputSchema: {
                        to: "uuid",
                        message: "string"
                    },
                    handler: this.HTTPWithAuthHandler.bind(this, this.managerReplySupportMessage.bind(this))
                },
                managerBroadcastNews: {
                    auth: true,
                    roles: [UserRoles.manager, UserRoles.admin],
                    inputSchema: {
                        message: "string"
                    },
                    handler: this.HTTPWithAuthHandler.bind(this, this.managerBroadcastNews.bind(this))
                }
                //#endregion "Support Schemes"
            });

            this.addOnStartHandler(this._onServiceStart);
            this.addOnStopHandler(this._onServiceStop);
        } catch (err) {
            this.log.error("Failed to initialize UserProfileService", err);
        }
    }

    private async _onServiceStart(): Promise<void> {
        this.pool = Pool(() => spawn<Encrypt>(new ThreadsWorker("./encryptWorker")), {
            name: "encrypt",
            concurrency: this.workerConcurrency,
            size: this.workerThreads
        });

        this.events.subscribe({
            [UserSubInEvents.CHECK_PAYMENT]: {
                schema: UserSubInSchema[UserSubInEvents.CHECK_PAYMENT],
                handler: this.userSubCheckPayment.bind(this)
            }
        });
        this.createQueue("user-sub");

        this.createWorker("user-sub", this.process);
        await this.addJob("user-sub", "userSubCheckExpiration", null, {
            jobId: "userSubCheckExpiration",
            repeat: {
                cron: "0 3 1 * * *"
            },
            attempts: 5,
            backoff: { type: "exponential", delay: 60000 * 10 },
            removeOnComplete: 1,
            removeOnFail: 5
        });
        await this.addJob("user-sub", "userSubCheckTrial", null, {
            jobId: "userSubCheckTrial",
            repeat: {
                cron: "0 3 * * * *"
            },
            attempts: 5,
            backoff: { type: "exponential", delay: 60000 * 10 },
            removeOnComplete: 1,
            removeOnFail: 5
        });
        await this.addJob("user-sub", "userSubCheckPending", null, {
            jobId: "userSubCheckPending",
            repeat: {
                cron: "0 3 2 */5 * *"
            },
            attempts: 5,
            backoff: { type: "exponential", delay: 60000 * 10 },
            removeOnComplete: 1,
            removeOnFail: 5
        });
        await this.addJob("user-sub", "userSubCheckNewPayments", null, {
            jobId: "userSubCheckNewPayments",
            repeat: {
                cron: "0 */5 * * * *"
            },
            attempts: 5,
            backoff: { type: "exponential", delay: 60000 * 10 },
            removeOnComplete: 1,
            removeOnFail: 5
        });
    }

    private async _onServiceStop(): Promise<void> {
        await this.pool.terminate();
    }

    async encrypt(userId: string, data: string) {
        return await this.pool.queue(async (encrypt: Encrypt) => encrypt(userId, data));
    }

    //#region "User Settings"

    async userSetNotificationSettings(
        {
            signalsTelegram,
            signalsEmail,
            tradingTelegram,
            tradingEmail,
            newsTelegram,
            newsEmail
        }: {
            signalsTelegram?: boolean;
            signalsEmail?: boolean;
            tradingTelegram?: boolean;
            tradingEmail?: boolean;
            newsTelegram?: boolean;
            newsEmail?: boolean;
        },
        user: User
    ) {
        const { settings } = user;

        const newSettings: UserSettings = {
            ...settings,
            notifications: {
                signals: {
                    telegram:
                        signalsTelegram === true || signalsTelegram === false
                            ? signalsTelegram
                            : settings.notifications.signals.telegram,
                    email:
                        signalsEmail === true || signalsEmail === false
                            ? signalsEmail
                            : settings.notifications.signals.email
                },
                trading: {
                    telegram:
                        tradingTelegram === true || tradingTelegram === false
                            ? tradingTelegram
                            : settings.notifications.trading.telegram,
                    email:
                        tradingEmail === true || tradingEmail === false
                            ? tradingEmail
                            : settings.notifications.trading.email
                },
                news: {
                    telegram:
                        newsTelegram === true || newsTelegram === false
                            ? newsTelegram
                            : settings.notifications.news.telegram,
                    email: newsEmail === true || newsEmail === false ? newsEmail : settings.notifications.news.email
                }
            }
        };

        await this.db.pg.query(sql`
            UPDATE users
            SET settings = ${JSON.stringify(newSettings)}
            WHERE id = ${user.id};
        `);

        return newSettings;
    }

    async userChangeName({ name }: { name: string }, user: User) {
        await this.db.pg.query(sql`
            UPDATE users
            SET name = ${name}
            WHERE id = ${user.id};
        `);
    }

    //#endregion "User Settings"

    //#region "User Exchange Account"

    async userExchangeAccUpsert(
        params: {
            id?: string;
            exchange: string;
            name?: string;
            allocation?: UserExchangeAccount["allocation"];
            keys: { key: string; secret: string; pass?: string };
        },
        user: User
    ) {
        const {
            exchange,
            keys: { key, secret, pass },
            allocation
        } = params;
        const id = params.id;
        let name = params.name;
        const { id: userId } = user;

        let existed;

        if (id) {
            existed = await this.db.pg.maybeOne<{
                id: UserExchangeAccount["id"];
                name: UserExchangeAccount["name"];
                userId: UserExchangeAccount["userId"];
                exchange: UserExchangeAccount["exchange"];
                status: UserExchangeAccount["status"];
            }>(sql`
                SELECT id, name, user_id, exchange, status
                FROM user_exchange_accs
                WHERE id = ${id};
            `);

            if (existed) {
                if (existed.userId !== userId)
                    throw new ActionsHandlerError(
                        "Current user isn't owner of this User Exchange Account",
                        { userExAccId: existed.id },
                        "FORBIDDEN",
                        403
                    );

                if (existed.exchange !== exchange)
                    throw new ActionsHandlerError("Invalid exchange", null, "FORBIDDEN", 403);

                const startedUserRobotsCount = await this.db.pg.oneFirst<number>(sql`
                    SELECT COUNT(1)
                    FROM user_robots
                    WHERE user_ex_acc_id = ${existed.id}
                        AND status = ${RobotStatus.started};
                `);

                if (existed.status === UserExchangeAccStatus.enabled && startedUserRobotsCount > 0)
                    throw new ActionsHandlerError(
                        "Failed to change User Exchange Account with started Robots",
                        null,
                        "FORBIDDEN",
                        403
                    );
            }
        }

        if (!existed) {
            const anotherAccountExists = await this.db.pg.oneFirst<number>(sql`
                SELECT count(1)
                FROM user_exchange_accs
                WHERE user_id = ${userId}
                 AND exchange = ${exchange};
            `);
            if (anotherAccountExists > 0)
                throw new ActionsHandlerError(
                    "User Exchange Account already exists. Delete Exchange Account before creating a new one.",
                    null,
                    "FORBIDDEN",
                    500
                );
        }

        const connector = new PrivateConnector({
            exchange,
            keys: {
                apiKey: key,
                secret,
                password: pass
            }
        });
        const check:
            | {
                  success: boolean;
                  balances: UserExchangeAccBalances;
                  error?: undefined;
              }
            | {
                  success: boolean;
                  error: string;
                  balances?: undefined;
              } = await connector.checkAPIKeys();
        if (!check.success) throw new ActionsHandlerError(check.error, null, "VALIDATION", 400);

        const encryptedKeys: UserExchangeKeys = {
            key: await this.encrypt(userId, key),
            secret: await this.encrypt(userId, secret),
            pass: pass && (await this.encrypt(userId, pass))
        };

        /*
        if (!existed) {
            if (!name || name === "") {
                const accExists = await this.db.pg.maybeOne<{ name: string }>(sql`
                    SELECT name
                    FROM user_exchange_accs
                    WHERE exchange = ${exchange}
                    ORDER BY created_at
                    LIMIT 1;
                `);

                const sameExchangeName = accExists?.name || "";
                const number = (sameExchangeName && +sameExchangeName.split("#")[1]) || 0;

                name = `${formatExchange(exchange)} #${number + 1}`;
            } else {
                const existsWithName = await this.db.pg.maybeOne(sql`
                    SELECT id
                    FROM user_exchange_accs
                    WHERE name = ${name}
                    AND user_id = ${userId}
                    LIMIT 1;
                `);

                if (existsWithName)
                    throw new ActionsHandlerError(
                        `User Exchange Account already exists with name "${name}". Please try with another name.`,
                        null,
                        "FORBIDDEN",
                        403
                    );
            }
        }
        */
        if (!name) {
            name = `${formatExchange(exchange)}`;
        }

        const exchangeAcc: UserExchangeAccount = {
            id: id || uuid(),
            userId,
            exchange,
            name,
            keys: encryptedKeys,
            allocation,
            status: UserExchangeAccStatus.enabled,
            error: null,
            balances: check.balances,
            ordersCache: {}
        };

        if (existed) {
            name = name || existed.name;
            await this.db.pg.query(sql`
                UPDATE user_exchange_accs
                SET name = ${name},
                    keys = ${JSON.stringify(exchangeAcc.keys)},
                    allocation = ${exchangeAcc.allocation},
                    status = ${exchangeAcc.status},
                    error = ${exchangeAcc.error},
                    balances = ${JSON.stringify(exchangeAcc.balances) || null}
                WHERE id = ${id};
            `);

            await this.events.emit<UserExAccKeysChangedEvent>({
                type: UserExAccOutEvents.KEYS_CHANGED,
                data: {
                    userExAccId: id
                }
            });
        } else {
            await this.db.pg.query(sql`
                INSERT INTO user_exchange_accs(
                    id, user_id, exchange, name, allocation, keys, status, error, balances, orders_cache
                ) VALUES (
                    ${exchangeAcc.id},
                    ${exchangeAcc.userId},
                    ${exchangeAcc.exchange},
                    ${exchangeAcc.name},
                    ${exchangeAcc.allocation},
                    ${JSON.stringify(exchangeAcc.keys)},
                    ${exchangeAcc.status},
                    ${exchangeAcc.error},
                    ${JSON.stringify(exchangeAcc.balances) || null},
                    ${JSON.stringify(exchangeAcc.ordersCache)}
                );
            `);
        }
        GA.event(user.id, "exAcc", "upsert");
        return exchangeAcc.id;
    }

    async userExchangeAccChangeName(
        {
            id,
            name
        }: {
            id: string;
            name: string;
        },
        user: User
    ) {
        const { id: userId } = user;

        const userExchangeAcc = await this.db.pg.maybeOne<{
            id: UserExchangeAccount["id"];
            userId: UserExchangeAccount["userId"];
        }>(sql`
            SELECT id, user_id
            FROM user_exchange_accs
            WHERE id = ${id};
        `);

        if (!userExchangeAcc)
            throw new ActionsHandlerError("User Exchange Account not found", { id }, "NOT_FOUND", 404);

        if (userExchangeAcc.userId !== userId)
            throw new ActionsHandlerError(
                "Current user isn't owner of this User Exchange Account",
                { userExAccId: userExchangeAcc.id },
                "FORBIDDEN",
                403
            );

        const existsWithName = await this.db.pg.maybeOne(sql`
            SELECT id
            FROM user_exchange_accs
            WHERE name = ${name}
                AND id <> ${id}
            LIMIT 1;
        `);

        if (existsWithName)
            throw new ActionsHandlerError(
                `User Exchange Account already exists with name "${name}". Please try with another name.`,
                null,
                "FORBIDDEN",
                403
            );

        await this.db.pg.query(sql`
            UPDATE user_exchange_accs
            SET name = ${name}
            WHERE id = ${id};
        `);
    }

    async userExchangeAccDelete({ id }: { id: string }, user: User) {
        const { id: userId } = user;

        const userExchangeAcc = await this.db.pg.maybeOne<{
            id: UserExchangeAccount["id"];
            userId: UserExchangeAccount["userId"];
            status: UserExchangeAccount["status"];
        }>(sql`
            SELECT id, user_id, status
            FROM user_exchange_accs
            WHERE id = ${id};
        `);

        if (!userExchangeAcc)
            throw new ActionsHandlerError("User Exchange Account not found", { id }, "NOT_FOUND", 404);

        if (userExchangeAcc.userId !== userId)
            throw new ActionsHandlerError(
                "Current user isn't owner of this User Exchange Account",
                { userExAccId: userExchangeAcc.id },
                "FORBIDDEN",
                403
            );

        const userRobotsCount = await this.db.pg.oneFirst<number>(sql`
            SELECT COUNT(1)
            FROM user_robots
            WHERE user_ex_acc_id = ${id}
              AND status = ${UserRobotStatus.started};
        `);

        if (userExchangeAcc.status === UserExchangeAccStatus.enabled && userRobotsCount > 0)
            throw new ActionsHandlerError("You can't delete API Keys with started Robots", null, "FORBIDDEN", 403);

        await this.db.pg.query(sql`
            DELETE
            FROM user_exchange_accs
            WHERE id = ${id};
        `);
        GA.event(user.id, "exAcc", "delete");
    }

    //#endregion "User Exchange Account"

    //#region "User Subscription"
    async process(job: Job) {
        this.log.info(`Processing ${job.name}`);
        switch (job.name) {
            case "userSubCheckExpiration":
                await this.userSubCheckExpiration();
                break;
            case "userSubCheckTrial":
                await this.userSubCheckTrial();
                break;
            case "userSubCheckPending":
                await this.userSubCheckPending();
                break;
            case "userSubCheckNewPayments":
                await this.userSubCheckNewPayments();
                break;
            default:
                this.log.error(`Unknow job ${job.name}`);
        }
        return { result: "ok" };
    }

    async userSubCheckExpiration() {
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
                        AND trial_ended is not null AND trial_ended < ${currentDate});`);

            for (const sub of expiredSubscriptions) {
                this.log.info(`Subscription #${sub.id} for user #${sub.userId} expired`);
                const userPortfolios = await this.db.pg.any<{ id: string }>(sql`
                            SELECT id 
                            FROM user_portfolios
                            WHERE user_id = ${sub.userId} 
                            AND status = 'started';`);
                if (userPortfolios && userPortfolios.length) {
                    for (const { id } of userPortfolios) {
                        await this.events.emit<UserRobotRunnerStopPortfolio>({
                            type: UserRobotRunnerEvents.STOP_PORTFOLIO,
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
                this.log.info(`Subscription #${sub.id} for user #${sub.userId} is expiring`);
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

    async userSubCheckTrial() {
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
            FROM v_user_subs where status = 'trial' and trial_ended is null;`);

            for (const sub of trialSubscriptions) {
                this.log.info(`Trial Subscription #${sub.id} for user #${sub.userId} is expiring`);
                const userPortfolio = await this.db.pg.maybeOne<{ id: string }>(sql`
                    SELECT id 
                      FROM user_portfolios
                    WHERE user_id = ${sub.userId}
                      AND (full_stats->'netProfit')::numeric > ${sub.subscriptionLimits?.trialNetProfit || 15};
                    `);

                if (userPortfolio) {
                    const trialEnded = dayjs
                        .utc()
                        .startOf("day")
                        .add(this.#expirationAmount, this.#expirationUnit)
                        .toISOString();
                    await this.db.pg.query(sql`
                        UPDATE user_subs
                          SET trial_ended = ${trialEnded}
                        WHERE id = ${sub.id};
                        `);
                    await this.events.emit<UserSubStatusEvent>({
                        type: UserSubOutEvents.USER_SUB_STATUS,
                        data: {
                            userSubId: sub.id,
                            userId: sub.userId,
                            status: "expiring",
                            context: sub.status,
                            trialEnded: trialEnded,
                            activeTo: null,
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

    async userSubCheckPending() {
        try {
            const date = dayjs.utc().startOf("day").add(-7, "day").toISOString();
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
            FROM v_user_subs where status = 'pending'
            AND updated_at > ${date}
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
            this.log.error(`Failed to check pending subscriptions ${error.message}`, error);
            throw error;
        }
    }

    async userSubCheckNewPayments() {
        try {
            const newPayments = await this.db.pg.any<{ id: string }>(sql`
             SELECT id FROM user_payments
             WHERE status not in ('COMPLETED', 'CANCELLED', 'EXPIRED', 'RESOLVED');
            `);
            await Promise.all(newPayments.map(async ({ id }) => this.userSubCheckPayment({ chargeId: id }, null)));
        } catch (error) {
            this.log.error(`Failed to check new payments ${error.message}`, error);
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

    async userSubCreate({ subscriptionId, subscriptionOption }: UserSubCreate, user?: User) {
        try {
            // Есть ли подписка и опция
            const subscription = await this.db.pg.maybeOne<{
                code: SubscriptionOption["code"];
                name: SubscriptionOption["name"];
                subscriptionName: Subscription["name"];
                trialAvailable: Subscription["trialAvailable"];
            }>(sql`SELECT so.code, so.name, s.name as subscription_name, s.trial_available
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

            let status: UserSub["status"] = "pending";
            if (subscription.trialAvailable) {
                // Была ли подписка с триалом
                const trialSubscription = await this.db.pg.maybeOne(sql`SELECT id FROM user_subs 
            WHERE user_id = ${user.id}
            AND trial_started IS NOT NULL ORDER BY created_at DESC LIMIT 1;`);

                // Если была, сразу ожидаем оплату
                if (trialSubscription) status = "pending";
                else status = "trial";
            }

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

    async userSubCancel({ userSubId }: UserSubCancel, user: User) {
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

            const userPortfolios = await this.db.pg.any<{ id: string }>(sql`
           SELECT id 
           FROM user_portfolios
           WHERE user_id = ${user.id} 
           AND status = 'started';`);
            if (userPortfolios && userPortfolios.length) {
                for (const { id } of userPortfolios) {
                    await this.events.emit<UserRobotRunnerStopPortfolio>({
                        type: UserRobotRunnerEvents.STOP_PORTFOLIO,
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

    async userSubCheckout({ userSubId }: UserSubCheckout, user: User): Promise<{ id: UserPayment["id"] }> {
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

    async userSubCheckPayment({ chargeId, provider = "coinbase.commerce" }: UserSubCheckPayment, user: User) {
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

            if (savedUserPayment.status === userPayment.status)
                return {
                    id: savedUserPayment.id
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
                userPayment.status === "UNRESOLVED" ||
                userPayment.status === "PENDING"
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
    //#endregion "User Subscription"

    //#region "Support"
    #saveSupportMessage = async (supportMessage: SupportMessage) =>
        this.db.pg.query(sql`
INSERT into messages ( timestamp, "from", "to", data ) VALUES (
    
    ${supportMessage.timestamp}, ${supportMessage.from}, ${supportMessage.to}, ${JSON.stringify(supportMessage.data)}
)
`);

    #saveNotifications = async (notifications: Notification<any>[]) => {
        if (!notifications?.length) return;

        try {
            for (const chunk of chunkArray(notifications, 1000)) {
                await this.db.pg.query(sql`
    INSERT INTO notifications (
        user_id, timestamp, type, data, send_telegram, send_email
            )
    SELECT * FROM 
    ${sql.unnest(
        this.db.util.prepareUnnest(chunk, ["userId", "timestamp", "type", "data", "sendTelegram", "sendEmail"]),
        ["uuid", "timestamp", "varchar", "jsonb", "bool", "bool"]
    )}        
    `);
            }
        } catch (err) {
            this.log.error("Failed to save notifications", err);
            throw err;
        }
    };

    async userSupportMessage({ message }: { message: string }, user: User) {
        const newMessage: SupportMessage = {
            from: user.id,
            to: null,
            data: { message },
            timestamp: dayjs.utc().toISOString()
        };

        await this.#saveSupportMessage(newMessage);

        await mailUtil.send({
            to: "support@cryptuoso.com",
            subject: `New Support Request from user ${user.id}`,
            variables: {
                body: `<p>New Support Request from user <b>${user.id}</b></p>
                <p>${message}</p>
                <p>${newMessage.timestamp}</p>
                `
            },
            tags: ["support"]
        });
    }

    async managerReplySupportMessage({ to, message }: { to: string; message: string }, user: User) {
        const { telegramId, email } = await this.db.pg.one<{ telegramId: string; email: string }>(
            sql`SELECT telegram_id, email from users where id = ${to}`
        );

        const newMessage: SupportMessage = {
            from: user.id,
            to,
            data: { message },
            timestamp: dayjs.utc().toISOString()
        };
        await this.#saveSupportMessage(newMessage);

        const notification: Notification<SupportMessage> = {
            userId: to,
            timestamp: newMessage.timestamp,
            type: "message.support-reply",
            data: newMessage,
            sendTelegram: !!telegramId,
            sendEmail: !!email
        };

        await this.#saveNotifications([notification]);
    }

    async managerBroadcastNews({ message }: { message: string }) {
        const users = await this.db.pg.many<{
            userId: string;
            telegramId: string;
            email: string;
            settings: UserSettings;
        }>(
            sql`SELECT id as user_id, telegram_id, email, settings 
        FROM users 
        WHERE status > 0;`
        );
        const timestamp = dayjs.utc().toISOString();
        const notifications: Notification<any>[] = users.map(
            ({
                userId,
                telegramId,
                email,
                settings: {
                    notifications: { news }
                }
            }) => ({
                userId,
                timestamp,
                type: "message.broadcast",
                data: { message },
                sendTelegram: news.telegram && telegramId ? true : false,
                sendEmail: news.email && email ? true : false
            })
        );

        await this.#saveNotifications(notifications);
    }
    //#endregion "Support"
}
