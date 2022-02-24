import { HTTPService, HTTPServiceConfig, RequestExtended } from "@cryptuoso/service";
import {
    User,
    UserRoles,
    UserExchangeAccount,
    UserExchangeKeys,
    UserExchangeAccStatus,
    UserExchangeAccBalances,
    UserSettings
} from "@cryptuoso/user-state";
import { UserSignalState /* , UserSignalSettings */ } from "@cryptuoso/user-signal-state";
import { RobotStatus } from "@cryptuoso/robot-state";
import { UserRobotDB, UserRobotStatus } from "@cryptuoso/user-robot-state";
import { UserMarketState } from "@cryptuoso/market";
import { ActionsHandlerError } from "@cryptuoso/errors";
import { sql } from "@cryptuoso/postgres";
import { v4 as uuid } from "uuid";
import dayjs from "@cryptuoso/dayjs";
import { StatsCalcRunnerEvents } from "@cryptuoso/stats-calc-events";
import { spawn, Pool, Worker as ThreadsWorker } from "threads";
import { Encrypt } from "./encryptWorker";
import { formatExchange, GenericObject, round } from "@cryptuoso/helpers";
import {
    checkAssetStatic,
    checkBalancePercent,
    checkCurrencyDynamic,
    UserRobotSettings,
    UserRobotSettingsSchema,
    UserSignalSettings,
    UserSignalSettingsSchema
} from "@cryptuoso/robot-settings";
import { PrivateConnector } from "@cryptuoso/ccxt-private";
import { GA } from "@cryptuoso/analytics";
import { UserExAccKeysChangedEvent, UserExAccOutEvents } from "@cryptuoso/user-events";

export type UserProfileServiceConfig = HTTPServiceConfig;

export default class UserProfileService extends HTTPService {
    private pool: Pool<any>;

    constructor(config?: UserProfileServiceConfig) {
        super(config);

        try {
            this.createRoutes({
                //#region "User Settings Schemes"
                setNotificationSettings: {
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
                    handler: this._httpHandler.bind(this, this.setNotificationSettings.bind(this))
                },
                changeName: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        name: {
                            type: "string",
                            trim: true,
                            empty: false
                        }
                    },
                    handler: this._httpHandler.bind(this, this.changeName.bind(this))
                },
                //#endregion "User Settings Schemes"

                //#region "User Signals Schemes"
                userSignalSubscribe: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        robotId: "uuid",
                        settings: UserSignalSettingsSchema
                    },
                    handler: this._httpHandler.bind(this, this.userSignalSubscribe.bind(this))
                },
                userSignalEdit: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        robotId: "uuid",
                        settings: UserSignalSettingsSchema
                    },
                    handler: this._httpHandler.bind(this, this.userSignalEdit.bind(this))
                },
                userSignalUnsubscribe: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        robotId: "uuid"
                    },
                    handler: this._httpHandler.bind(this, this.userSignalUnsubscribe.bind(this))
                },
                //#endregion "User Signals Schemes"

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
                    handler: this._httpHandler.bind(this, this.userExchangeAccUpsert.bind(this))
                },
                userExchangeAccChangeName: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: "uuid",
                        name: { type: "string", empty: false, trim: true }
                    },
                    handler: this._httpHandler.bind(this, this.userExchangeAccChangeName.bind(this))
                },
                userExchangeAccDelete: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: "uuid"
                    },
                    handler: this._httpHandler.bind(this, this.userExchangeAccDelete.bind(this))
                },
                //#endregion "User Exchange Account Schemes"

                //#region "User Robots Schemes"
                userRobotCreate: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        userExAccId: "uuid",
                        robotId: "uuid",
                        settings: UserRobotSettingsSchema
                    },
                    handler: this._httpHandler.bind(this, this.userRobotCreate.bind(this))
                },
                userRobotEdit: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: "uuid",
                        settings: UserRobotSettingsSchema
                    },
                    handler: this._httpHandler.bind(this, this.userRobotEdit.bind(this))
                },
                userRobotDelete: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: "uuid"
                    },
                    handler: this._httpHandler.bind(this, this.userRobotDelete.bind(this))
                }
                //#endregion "User Robots Schemes"
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
    }

    private async _onServiceStop(): Promise<void> {
        await this.pool.terminate();
    }

    async encrypt(userId: string, data: string) {
        return await this.pool.queue(async (encrypt: Encrypt) => encrypt(userId, data));
    }

    async _httpHandler(
        handler: (user: User, params: GenericObject<any>) => Promise<GenericObject<any>>,
        req: RequestExtended,
        res: any
    ) {
        const result = await handler(req.meta.user, req.body.input);

        res.send({ result: result || "OK" });
        res.end();
    }

    //#region "User Settings"

    async setNotificationSettings(
        user: User,
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
        }
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

    async changeName(user: User, { name }: { name: string }) {
        await this.db.pg.query(sql`
            UPDATE users
            SET name = ${name}
            WHERE id = ${user.id};
        `);
    }

    //#endregion "User Settings"

    //#region "User Signals"

    getNewUserSignalSettings(
        settings: UserSignalSettings,
        limits: UserMarketState["limits"]["userSignal"],
        precision: UserMarketState["precision"]
    ) {
        if (!limits?.min?.amount) throw new ActionsHandlerError("Market unavailable.", null, "FORBIDDEN", 403);

        let newUserSignalSettings: UserSignalSettings;

        if (settings.volumeType === "assetStatic") {
            const volume = round(settings.volume, precision?.amount || 6);
            const amountMin = limits?.min?.amount;
            const amountMax = limits?.max?.amount;
            checkAssetStatic(volume, amountMin, amountMax);
            newUserSignalSettings = { volumeType: "assetStatic", volume };
        } else if (settings.volumeType === "currencyDynamic") {
            const volumeInCurrency = round(settings.volumeInCurrency, precision?.price || 2);
            const amountMin = limits?.min?.amountUSD;
            const amountMax = limits?.max?.amountUSD;
            checkCurrencyDynamic(volumeInCurrency, amountMin, amountMax);

            newUserSignalSettings = { volumeType: "currencyDynamic", volumeInCurrency };
        }

        return newUserSignalSettings;
    }

    async userSignalSubscribe(user: User, { robotId, settings }: { robotId: string; settings: UserSignalSettings }) {
        const robot = await this.db.pg.maybeOne<{
            exchange: string;
            asset: string;
            currency: string;
            available: number;
        }>(sql`
            SELECT exchange, asset, currency, available
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!robot) throw new ActionsHandlerError("Robot is not found.", null, "NOT_FOUND", 404);

        const { exchange, asset, currency, available } = robot;

        const isSignalExists = await this.db.pg.maybeOne(sql`
                SELECT id
                FROM user_signals
                WHERE user_id = ${user.id}
                    AND robot_id = ${robotId};
            `);

        if (isSignalExists) return;

        if (available < user.access) throw new ActionsHandlerError("Robot unavailable.", { robotId }, "FORBIDDEN", 403);

        const { limits, precision } = await this.db.pg.one<{
            limits: UserMarketState["limits"]["userSignal"];
            precision: UserMarketState["precision"];
        }>(sql`
            SELECT limits->'userSignal' as limits, precision
            FROM v_user_markets
            WHERE user_id = ${user.id}
                AND exchange = ${exchange}
                AND asset = ${asset}
                AND currency = ${currency};
        `);

        const newSettings: UserSignalSettings = this.getNewUserSignalSettings(settings, limits, precision);

        const userSignalId = uuid();
        const subscribedAt = dayjs.utc().toISOString();

        await this.db.pg.query(sql`
        INSERT INTO user_signals(
            id, robot_id, user_id, subscribed_at
        ) VALUES (
            ${userSignalId},
            ${robotId},
            ${user.id},
            ${subscribedAt}
        );
    `);
        await this.db.pg.query(sql`
            INSERT INTO user_signal_settings(
                user_signal_id, user_signal_settings, active_from
            ) VALUES (
                ${userSignalId},
                ${JSON.stringify(newSettings)},
                ${subscribedAt}
            );
        `);

        const volume = newSettings.volumeType === "assetStatic" ? newSettings.volume : newSettings.volumeInCurrency;
        GA.event(user.id, "signals", "subscribe");
        return volume;
    }

    async userSignalEdit(user: User, { robotId, settings }: { robotId: string; settings: UserSignalSettings }) {
        const userSignal = await this.db.pg.maybeOne<UserSignalState>(sql`
            SELECT id
            FROM user_signals
            WHERE robot_id = ${robotId}
                AND user_id = ${user.id};
        `);

        if (!userSignal) throw new ActionsHandlerError("Subscription not found.", null, "NOT_FOUND", 404);

        const { signalSettings: currentUserSignalSettings } = await this.db.pg.one<{
            signalSettings: UserSignalSettings;
        }>(sql`
            SELECT signal_settings
            FROM v_user_signal_settings
            WHERE user_signal_id = ${userSignal.id};
        `);

        if (
            (currentUserSignalSettings?.volumeType === "assetStatic" &&
                settings.volumeType === "assetStatic" &&
                settings.volume === currentUserSignalSettings.volume) ||
            (currentUserSignalSettings?.volumeType === "currencyDynamic" &&
                settings.volumeType === "currencyDynamic" &&
                settings.volumeInCurrency === currentUserSignalSettings.volumeInCurrency)
        )
            return;

        const { limits, precision } = await this.db.pg.one<{
            limits: UserMarketState["limits"]["userSignal"];
            precision: UserMarketState["precision"];
        }>(sql`
            SELECT vm.limits->'userSignal' as limits, vm.precision
            FROM robots r, v_user_markets vm
            WHERE r.id = ${robotId}
                AND vm.user_id = ${user.id}
                AND vm.exchange = r.exchange
                AND vm.asset = r.asset
                AND vm.currency = r.currency;
        `);

        const newSettings: UserSignalSettings = this.getNewUserSignalSettings(settings, limits, precision);

        await this.db.pg.query(sql`
            INSERT INTO user_signal_settings(
                user_signal_id, user_signal_settings
            ) VALUES (
                ${userSignal.id},
                ${JSON.stringify(newSettings)}
            );
        `);

        const volume = newSettings.volumeType === "assetStatic" ? newSettings.volume : newSettings.volumeInCurrency;
        GA.event(user.id, "signals", "edit");
        return volume;
    }

    async userSignalUnsubscribe(user: User, { robotId }: { robotId: string }) {
        const userSignal = await this.db.pg.maybeOne<UserSignalState>(sql`
            SELECT id
            FROM user_signals
            WHERE robot_id = ${robotId}
                AND user_id = ${user.id};
        `);

        if (!userSignal) throw new ActionsHandlerError("Subscription not found.", null, "NOT_FOUND", 404);

        await this.db.pg.query(sql`
            DELETE
            FROM user_signals
            WHERE id = ${userSignal.id};
        `);
        // <StatsCalcRunnerUserSignalDeleted>
        await this.events.emit<any>({
            type: StatsCalcRunnerEvents.USER_SIGNAL_DELETED,
            data: {
                userId: user.id,
                robotId
            }
        });
        GA.event(user.id, "signals", "unsubscribe");
    }

    //#endregion "User Signals"

    //#region "User Exchange Account"

    async userExchangeAccUpsert(
        user: User,
        params: {
            id?: string;
            exchange: string;
            name?: string;
            allocation?: UserExchangeAccount["allocation"];
            keys: { key: string; secret: string; pass?: string };
        }
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
        user: User,
        {
            id,
            name
        }: {
            id: string;
            name: string;
        }
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

    async userExchangeAccDelete(user: User, { id }: { id: string }) {
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

    //#region "User Robots"

    async getNewUserRobotSettings(
        settings: UserRobotSettings,
        limits: UserMarketState["limits"]["userRobot"],
        precision: UserMarketState["precision"],
        availableBalancePercent?: number,
        totalBalance?: number
    ) {
        if (!limits?.min?.amount) throw new ActionsHandlerError("Market unavailable.", null, "FORBIDDEN", 403);

        let newUserRobotSettings: UserRobotSettings;

        if (settings.volumeType === "assetStatic") {
            const volume = round(settings.volume, precision?.amount || 6);
            const amountMin = limits?.min?.amount;
            const amountMax = limits?.max?.amount;
            checkAssetStatic(volume, amountMin, amountMax);
            newUserRobotSettings = { volumeType: "assetStatic", volume };
        } else if (settings.volumeType === "currencyDynamic") {
            const volumeInCurrency = round(settings.volumeInCurrency, precision?.price || 2);
            const amountMin = limits?.min?.amountUSD;
            const amountMax = limits?.max?.amountUSD;
            checkCurrencyDynamic(volumeInCurrency, amountMin, amountMax);
            newUserRobotSettings = { volumeType: "currencyDynamic", volumeInCurrency };
        } else if (settings.volumeType === "balancePercent") {
            const balancePercent = round(settings.balancePercent);
            const volumeInCurrency = round((balancePercent / 100) * totalBalance, precision?.price || 2);
            const amountMin = limits?.min?.amountUSD;
            const amountMax = limits?.max?.amountUSD;

            checkBalancePercent(balancePercent, availableBalancePercent, volumeInCurrency, amountMin, amountMax);

            newUserRobotSettings = { volumeType: "balancePercent", balancePercent };
        }
        return newUserRobotSettings;
    }

    async userRobotCreate(
        user: User,
        {
            userExAccId,
            robotId,
            settings
        }: {
            userExAccId: string;
            robotId: string;
            settings: UserRobotSettings;
        }
    ) {
        const { id: userId } = user;

        const userExchangeAcc = await this.db.pg.maybeOne<UserExchangeAccount>(sql`
            SELECT id, status, exchange, user_Id
            FROM user_exchange_accs
            WHERE id = ${userExAccId};
        `);

        if (!userExchangeAcc)
            throw new ActionsHandlerError("User Exchange Account not found", { userExAccId }, "NOT_FOUND", 404);

        if (userExchangeAcc.userId !== userId)
            throw new ActionsHandlerError(
                "Current user isn't owner of this User Exchange Account",
                { userExAccId: userExchangeAcc.id },
                "FORBIDDEN",
                403
            );

        // swapped (next check was after robot check)

        const userRobotExists = await this.db.pg.maybeOne(sql`
            SELECT id
            FROM user_robots
            WHERE user_id = ${userId}
                AND robot_id = ${robotId};
        `);

        if (userRobotExists) throw new ActionsHandlerError("User Robot already exists", null, "FORBIDDEN", 403);

        const robot = await this.db.pg.maybeOne<{
            exchange: string;
            asset: string;
            currency: string;
            available: number;
        }>(sql`
            SELECT id, exchange, asset, currency, available
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!robot) throw new ActionsHandlerError("Robot not found", { robotId }, "NOT_FOUND", 404);

        if (userExchangeAcc.exchange !== robot.exchange)
            throw new ActionsHandlerError("Wrong exchange", null, "FORBIDDEN", 403);

        if (robot.available < user.access) throw new ActionsHandlerError("Robot unavailable.", null, "FORBIDDEN", 403);

        const { limits, precision, availableBalancePercent, totalBalanceUsd } = await this.db.pg.one<{
            limits: UserMarketState["limits"]["userRobot"];
            precision: UserMarketState["precision"];
            availableBalancePercent: number;
            totalBalanceUsd: number;
        }>(sql`
        SELECT um.limits->'userRobot' as limits, um.precision, a.available_balance_percent, ea.total_balance_usd
        FROM v_user_markets um, v_user_amounts a, v_user_exchange_accs ea
        WHERE um.user_id = ${user.id}
            AND a.user_ex_acc_id = ${userExAccId}
            AND um.exchange = ${robot.exchange}
            AND um.asset = ${robot.asset}
            AND um.currency = ${robot.currency}
            AND ea.id = ${userExAccId} ;
    `);

        const newUserRobotSettings = await this.getNewUserRobotSettings(
            settings,
            limits,
            precision,
            availableBalancePercent,
            totalBalanceUsd
        );

        const userRobotId = uuid();

        await this.db.pg.query(sql`
            INSERT INTO user_robots(
                id, robot_id, user_ex_acc_id, user_id, status, settings
            ) VALUES (
                ${userRobotId},
                ${robotId},
                ${userExAccId},
                ${userId},
                ${RobotStatus.stopped},
                ${JSON.stringify({ active: true })}
            );
        `);

        await this.db.pg.query(sql`
                INSERT INTO user_robot_settings(
                    user_robot_id, user_robot_settings
                ) VALUES (
                    ${userRobotId},
                    ${JSON.stringify(newUserRobotSettings)}
                );
        `);
        GA.event(user.id, "robot", "add");
        return userRobotId;
    }

    async userRobotEdit(user: User, { id, settings }: { id: string; settings: UserRobotSettings }) {
        const { id: userId } = user;

        const userRobotExists = await this.db.pg.maybeOne<{
            id: UserRobotDB["id"];
            userPortfolioId?: UserRobotDB["userPortfolioId"];
            userId: UserRobotDB["userId"];
            robotId: UserRobotDB["robotId"];
            userExAccId: UserRobotDB["userExAccId"];
            userRobotSettings: UserRobotSettings;
        }>(sql`
            SELECT ur.id, ur.user_portfolio_id, ur.user_id, ur.robot_id, ur.user_ex_acc_id, s.user_robot_settings
            FROM user_robots ur, v_user_robot_settings s
            WHERE user_robot_id = ur.id
              AND ur.id = ${id};
        `);

        if (!userRobotExists)
            throw new ActionsHandlerError("User Robot not found", { userRobotId: id }, "NOT_FOUND", 404);

        if (userRobotExists.userId !== userId)
            throw new ActionsHandlerError(
                "Current user isn't owner of this User Robot",
                { userRobotId: id },
                "FORBIDDEN",
                403
            );

        if (userRobotExists.userPortfolioId)
            throw new ActionsHandlerError(
                "Editing user robot from portfolio is not allowed",
                { userRobotId: id, userPortfolioId: userRobotExists.userPortfolioId },
                "FORBIDDEN",
                500
            );
        const { userRobotSettings: currentUserRobotSettings } = userRobotExists;

        if (
            (currentUserRobotSettings?.volumeType === "assetStatic" &&
                settings.volumeType === "assetStatic" &&
                settings.volume === currentUserRobotSettings.volume) ||
            (currentUserRobotSettings?.volumeType === "currencyDynamic" &&
                settings.volumeType === "currencyDynamic" &&
                settings.volumeInCurrency === currentUserRobotSettings.volumeInCurrency)
        )
            return;

        const { limits, precision, availableBalancePercent, totalBalanceUsd } = await this.db.pg.one<{
            limits: UserMarketState["limits"]["userRobot"];
            precision: UserMarketState["precision"];
            availableBalancePercent: number;
            totalBalanceUsd: number;
        }>(sql`
            SELECT um.limits->'userRobot' as limits, um.precision, a.available_balance_percent, ea.total_balance_usd
            FROM robots r, v_user_markets um, v_user_amounts a, v_user_exchange_accs ea
            WHERE r.id = ${userRobotExists.robotId}
                AND um.user_id = ${user.id}
                AND a.user_ex_acc_id = ${userRobotExists.userExAccId}
                AND um.exchange = r.exchange
                AND um.asset = r.asset
                AND um.currency = r.currency
                AND ea.id = ${userRobotExists.userExAccId};
        `);

        const currentAvailableBalancePercent =
            currentUserRobotSettings?.volumeType === "balancePercent"
                ? availableBalancePercent + currentUserRobotSettings.balancePercent
                : availableBalancePercent;

        const newUserRobotSettings = await this.getNewUserRobotSettings(
            settings,
            limits,
            precision,
            currentAvailableBalancePercent,
            totalBalanceUsd
        );

        await this.db.pg.query(sql`
            INSERT INTO user_robot_settings(
                user_robot_id, user_robot_settings
            ) VALUES (
                ${id},
                ${JSON.stringify(newUserRobotSettings)}
            );
        `);
        GA.event(user.id, "robot", "edit");
    }

    async userRobotDelete(user: User, { id }: { id: string }) {
        const { id: userId } = user;

        const userRobotExists = await this.db.pg.maybeOne<{
            id: UserRobotDB["id"];
            userPortfolioId?: UserRobotDB["userPortfolioId"];
            robotId: UserRobotDB["robotId"];
            userId: UserRobotDB["userId"];
            status: UserRobotDB["status"];
        }>(sql`
            SELECT id, user_portfolio_id, robot_id, user_id, status
            FROM user_robots
            WHERE id = ${id};
        `);

        if (!userRobotExists)
            throw new ActionsHandlerError("User Robot not found", { userRobotId: id }, "NOT_FOUND", 404);

        if (userRobotExists.userId !== userId)
            throw new ActionsHandlerError(
                "Current user isn't owner of this User Robot",
                { userRobotId: id },
                "FORBIDDEN",
                403
            );

        if (userRobotExists.userPortfolioId)
            throw new ActionsHandlerError(
                "Editing user robot from portfolio is not allowed",
                { userRobotId: id, userPortfolioId: userRobotExists.userPortfolioId },
                "FORBIDDEN",
                500
            );

        if (userRobotExists.status !== UserRobotStatus.stopped && userRobotExists.status !== UserRobotStatus.paused)
            throw new ActionsHandlerError(`User Robot is ${userRobotExists.status}`, null, "FORBIDDEN", 403);

        await this.db.pg.query(sql`
                DELETE
                FROM user_robots
                WHERE id = ${id};
        `);
        //<StatsCalcRunnerUserRobotDeleted>
        await this.events.emit<any>({
            type: StatsCalcRunnerEvents.USER_ROBOT_DELETED,
            data: { userId, robotId: userRobotExists.robotId }
        });
        GA.event(user.id, "robot", "delete");
    }

    //#endregion "User Robots"
}
