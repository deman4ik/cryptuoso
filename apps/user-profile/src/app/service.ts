import { HTTPService, HTTPServiceConfig, RequestExtended } from "@cryptuoso/service";
import {
    GenericObject,
    User,
    UserRoles,
    UserExchangeAccountState,
    UserExchangeKeys,
    UserExchangeAccStatus
} from "@cryptuoso/user-state";
import { UserSignalState /* , UserSignalSettings */ } from "@cryptuoso/user-signal-state";
import { RobotState, RobotStatus } from "@cryptuoso/robot-state";
import { UserRobotDB } from "@cryptuoso/user-robot-state";
import { UserMarketState } from "@cryptuoso/market";
import { ActionsHandlerError } from "@cryptuoso/errors";
import { sql } from "@cryptuoso/postgres";
import { v4 as uuid } from "uuid";
import dayjs from "@cryptuoso/dayjs";
import { StatsCalcRunnerEvents } from "@cryptuoso/stats-calc-events";
import { spawn, Pool, Worker as ThreadsWorker } from "threads";
import { Encrypt } from "./encryptWorker";
import { formatExchange } from "@cryptuoso/helpers";
import { UserRobotSettings, UserSignalSettings, RobotVolumeType, UserRobotVolumeType } from "@cryptuoso/robot-settings";

export type UserProfileServiceConfig = HTTPServiceConfig;

export default class UserProfileService extends HTTPService {
    private pool: Pool<any>;

    constructor(config?: UserProfileServiceConfig) {
        super(config);

        try {
            const userSignalSettingsInnerSchema = {
                type: "object",
                props: {
                    volumeType: {
                        type: "enum",
                        values: [RobotVolumeType.assetStatic, RobotVolumeType.currencyDynamic]
                    },
                    volume: {
                        type: "number",
                        optional: true
                    },
                    volumeInCurrency: {
                        type: "number",
                        optional: true
                    }
                }
            };

            const userRobotSettingsInnerSchema = {
                type: "object",
                props: {
                    volumeType: {
                        type: "enum",
                        values: [
                            RobotVolumeType.assetStatic,
                            RobotVolumeType.currencyDynamic,
                            UserRobotVolumeType.balancePercent
                        ]
                    },
                    volume: {
                        type: "number",
                        optional: true
                    },
                    volumeInCurrency: {
                        type: "number",
                        optional: true
                    },
                    balancePercent: {
                        type: "number",
                        optional: true
                    }
                }
            };

            this.createRoutes({
                //#region "User Settings Schemes"
                setNotificationSettings: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        signalsTelegram: {
                            type: "string",
                            optional: true
                        },
                        signalsEmail: {
                            type: "string",
                            optional: true
                        },
                        tradingTelegram: {
                            type: "string",
                            optional: true
                        },
                        tradingEmail: {
                            type: "string",
                            optional: true
                        }
                    },
                    handler: this._httpHandler.bind(this, this.setNotificationSettings.bind(this))
                },
                changeName: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        name: "string" /* ,
                        // TODO: check
                        empty: false */
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
                        settings: userSignalSettingsInnerSchema
                    },
                    handler: this._httpHandler.bind(this, this.userSignalSubscribe.bind(this))
                },
                userSignalEdit: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        robotId: "uuid",
                        settings: userSignalSettingsInnerSchema
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
                        name: {
                            type: "string",
                            optional: true
                        },
                        keys: {
                            type: "object",
                            props: {
                                key: "string",
                                secret: "string",
                                pass: {
                                    type: "string",
                                    optional: true
                                }
                            }
                        }
                    },
                    handler: this._httpHandler.bind(this, this.userExchangeAccUpsert.bind(this))
                },
                userExchangeAccChangeName: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: "uuid",
                        name: "string"
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
                        settings: userRobotSettingsInnerSchema
                    },
                    handler: this._httpHandler.bind(this, this.userRobotCreate.bind(this))
                },
                userRobotEdit: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: "uuid",
                        settings: userRobotSettingsInnerSchema
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

            this.addOnStartHandler(this._onStartService);
            this.addOnStopHandler(this._onStopService);
        } catch (err) {
            this.log.error("Failed to initialize UserProfileService", err);
        }
    }

    private async _onStartService(): Promise<void> {
        this.pool = Pool(() => spawn<Encrypt>(new ThreadsWorker("./encryptWorker")), {
            name: "encrypt"
        });
    }

    private async _onStopService(): Promise<void> {
        await this.pool.terminate();
    }

    async encrypt(userId: string, data: string) {
        return await this.pool.queue(async (encrypt: Encrypt) => encrypt(userId, data));
    }

    async _httpHandler(
        handler: (user: User, params: GenericObject) => Promise<GenericObject | any>,
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
            tradingEmail
        }: {
            signalsTelegram?: boolean;
            signalsEmail?: boolean;
            tradingTelegram?: boolean;
            tradingEmail?: boolean;
        }
    ) {
        const { settings } = user;

        const newSettings = {
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
                }
            }
        };

        await this.db.pg.query(sql`
            UPDATE users
            SET settings = ${sql.json(newSettings)}
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

    async userSignalSubscribe(user: User, { robotId, settings }: { robotId: string; settings: UserSignalSettings }) {
        const robot: RobotState = await this.db.pg.maybeOne(sql`
            SELECT exchange, asset, currency, available
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!robot) throw new ActionsHandlerError("Robot is not found.", null, "NOT_FOUND", 404);

        const { exchange, asset, currency, available } = robot;

        const isSignalExists =
            0 <
            +(await this.db.pg.oneFirst(sql`
                SELECT COUNT(*)
                FROM user_signals
                WHERE user_id = ${user.id}
                    AND robot_id = ${robotId};
            `));

        if (isSignalExists) return;

        if (available < user.access) throw new ActionsHandlerError("Robot unavailable.", { robotId }, "FORBIDDEN", 403);

        const marketLimits: UserMarketState["limits"] = (await this.db.pg.maybeOneFirst(sql`
            SELECT limits
            FROM v_user_markets
            WHERE user_id = ${user.id}
                AND exchange = ${exchange}
                AND asset = ${asset}
                AND currency = ${currency};
        `)) as any;

        let _volume: number;
        let _amountMin: number;
        let _amountMax: number;
        let newSettings: UserSignalSettings;

        if (settings.volumeType === RobotVolumeType.assetStatic) {
            _volume = settings.volume;
            _amountMin = marketLimits?.userSignal?.min?.amount;
            _amountMax = marketLimits?.userSignal?.max?.amount;
            newSettings = { volumeType: RobotVolumeType.assetStatic, volume: _volume };
        } else if (settings.volumeType === RobotVolumeType.currencyDynamic) {
            _volume = settings.volumeInCurrency;
            _amountMin = marketLimits?.userSignal?.min?.amountUSD;
            _amountMax = marketLimits?.userSignal?.max?.amountUSD;
            newSettings = { volumeType: RobotVolumeType.currencyDynamic, volumeInCurrency: _volume };
        }

        if (!_amountMin /*  || !_amountMax */)
            throw new ActionsHandlerError("Market unavailable.", null, "FORBIDDEN", 403);

        if (_volume < _amountMin)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be at least ${_amountMin}.`,
                null,
                "FORBIDDEN",
                403
            );

        if (_amountMax && _volume > _amountMax)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be not greater than ${_amountMax}.`,
                null,
                "FORBIDDEN",
                403
            );

        const userSignalId = uuid();
        const subscribedAt = dayjs.utc().toISOString();

        await this.db.pg.query(sql`
        INSERT INTO user_signals(
            id, robot_id, user_id, subscribed_at, volume
        ) VALUES (
            ${userSignalId},
            ${robotId},
            ${user.id},
            ${subscribedAt},
            0
        );
    `);
        await this.db.pg.query(sql`
            INSERT INTO user_signal_settings(
                user_signal_id, user_signal_settings, active_from
            ) VALUES (
                ${userSignalId},
                ${sql.json(newSettings)},
                ${subscribedAt}
            );
        `);

        // TODO: initialize statistics or do nothing
    }

    async userSignalEdit(user: User, { robotId, settings }: { robotId: string; settings: UserSignalSettings }) {
        const userSignal: UserSignalState = await this.db.pg.maybeOne(sql`
            SELECT id
            FROM user_signals
            WHERE robot_id = ${robotId}
                AND user_id = ${user.id};
        `);

        if (!userSignal) throw new ActionsHandlerError("Subscription not found.", null, "NOT_FOUND", 404);

        const currentUserSignalSettings: UserSignalSettings = await this.db.pg.maybeOne(sql`
            SELECT signal_settings
            FROM v_user_signal_settings
            WHERE user_signal_id = ${userSignal.id};
        `);

        if (
            (currentUserSignalSettings?.volumeType === RobotVolumeType.assetStatic &&
                settings.volumeType === RobotVolumeType.assetStatic &&
                settings.volume === currentUserSignalSettings.volume) ||
            (currentUserSignalSettings?.volumeType === RobotVolumeType.currencyDynamic &&
                settings.volumeType === RobotVolumeType.currencyDynamic &&
                settings.volumeInCurrency === currentUserSignalSettings.volumeInCurrency)
        )
            throw new ActionsHandlerError("This volume value is already set.", null, "FORBIDDEN", 403);

        const marketLimits: UserMarketState["limits"] = (await this.db.pg.maybeOneFirst(sql`
            SELECT vm.limits
            FROM robots r, v_user_markets vm
            WHERE r.id = ${robotId}
                AND vm.user_id = ${user.id}
                AND vm.exchange = r.exchange
                AND vm.asset = r.asset
                AND vm.currency = r.currency;
        `)) as any;

        let _volume: number;
        let _amountMin: number;
        let _amountMax: number;
        let newSettings: UserSignalSettings;

        if (settings.volumeType === RobotVolumeType.assetStatic) {
            _volume = settings.volume;
            _amountMin = marketLimits?.userSignal?.min?.amount;
            _amountMax = marketLimits?.userSignal?.max?.amount;
            newSettings = { volumeType: RobotVolumeType.assetStatic, volume: _volume };
        } else if (settings.volumeType === RobotVolumeType.currencyDynamic) {
            _volume = settings.volumeInCurrency;
            _amountMin = marketLimits?.userSignal?.min?.amountUSD;
            _amountMax = marketLimits?.userSignal?.max?.amountUSD;
            newSettings = { volumeType: RobotVolumeType.currencyDynamic, volumeInCurrency: _volume };
        }

        if (!_amountMin /*  || !_amountMax */)
            throw new ActionsHandlerError("Market unavailable.", null, "FORBIDDEN", 403);

        if (_volume < _amountMin)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be at least ${_amountMin}.`,
                null,
                "FORBIDDEN",
                403
            );

        if (_amountMax && _volume > _amountMax)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be not greater than ${_amountMax}.`,
                null,
                "FORBIDDEN",
                403
            );

        // active_from = now() // default
        await this.db.pg.query(sql`
            INSERT INTO user_signal_settings(
                user_signal_id, user_signal_settings
            ) VALUES (
                ${userSignal.id},
                ${sql.json(newSettings)}
            );
        `);
    }

    async userSignalUnsubscribe(user: User, { robotId }: { robotId: string }) {
        const userSignal: UserSignalState = await this.db.pg.maybeOne(sql`
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

        await this.events.emit({
            type: StatsCalcRunnerEvents.USER_SIGNAL_DELETED,
            data: {
                userId: user.id,
                robotId
            }
        });
    }

    //#endregion "User Signals"

    //#region "User Exchange Account"

    async userExchangeAccUpsert(
        user: User,
        {
            id,
            exchange,
            name,
            keys: { key, secret, pass }
        }: {
            id?: string;
            exchange: string;
            name?: string;
            keys: { key: string; secret: string; pass?: string };
        }
    ) {
        const { id: userId } = user;

        let existed: UserExchangeAccountState;

        if (id) {
            existed = await this.db.pg.maybeOne(sql`
                SELECT *
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

                const startedUserRobotsCount = +(await this.db.pg.oneFirst(sql`
                    SELECT COUNT(*)
                    FROM user_robots
                    WHERE user_ex_acc_id = ${existed.id}
                        AND status = ${RobotStatus.started};
                `));

                if (existed.status === UserExchangeAccStatus.enabled && startedUserRobotsCount > 0)
                    throw new ActionsHandlerError(
                        "Failed to change User Exchange Account with started Robots",
                        null,
                        "FORBIDDEN",
                        403
                    );
            }
        }

        // TODO: checkAPIKeys

        const encryptedKeys: UserExchangeKeys = {
            key: await this.encrypt(userId, key),
            secret: await this.encrypt(userId, secret),
            pass: pass && (await this.encrypt(userId, pass))
        };

        if (!existed) {
            if (!name || name === "") {
                const sameExchangeName: string = (await this.db.pg.maybeOneFirst(sql`
                    SELECT name
                    FROM user_exchange_accs
                    WHERE exchange = ${exchange}
                    ORDER BY created_at
                    LIMIT 1;
                `)) as any;

                const number = (sameExchangeName && +sameExchangeName.split("#")[1]) || 0;

                name = `${formatExchange(exchange)} #${number + 1}`;
            } else {
                const existsWithName = await this.db.pg.maybeOne(sql`
                    SELECT id
                    FROM user_exchange_accs
                    WHERE name = ${name}
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

        const exchangeAcc: UserExchangeAccountState = {
            id: id || uuid(),
            userId,
            exchange,
            name,
            keys: encryptedKeys,
            status: UserExchangeAccStatus.enabled,
            error: null,
            ordersCache: {}
        };

        if (existed) {
            name = name || existed.name;
            await this.db.pg.query(sql`
                UPDATE user_exchange_accs
                SET name = ${name},
                    keys = ${sql.json(exchangeAcc.keys)},
                    status = ${exchangeAcc.status},
                    error = ${exchangeAcc.error}
                WHERE id = ${id};
            `);
        } else {
            await this.db.pg.query(sql`
                INSERT INTO user_exchange_accs(
                    id, user_id, exchange, "name", "keys", "status", "error", orders_cache
                ) VALUES (
                    ${exchangeAcc.id},
                    ${exchangeAcc.userId},
                    ${exchangeAcc.exchange},
                    ${exchangeAcc.name},
                    ${sql.json(exchangeAcc.keys)},
                    ${exchangeAcc.status},
                    ${exchangeAcc.error},
                    ${sql.json(exchangeAcc.ordersCache)}
                );
            `);
        }

        return name;
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

        const userExchangeAcc: UserExchangeAccountState = await this.db.pg.maybeOne(sql`
            SELECT *
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

        const userExchangeAcc: UserExchangeAccountState = await this.db.pg.maybeOne(sql`
            SELECT *
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

        const userRobotsCount = +(await this.db.pg.oneFirst(sql`
            SELECT COUNT(*)
            FROM user_robots
            WHERE user_ex_acc_id = ${id};
        `));

        if (userExchangeAcc.status === UserExchangeAccStatus.enabled && userRobotsCount > 0)
            throw new ActionsHandlerError("You can't delete API Keys with added Robots", null, "FORBIDDEN", 403);

        await this.db.pg.query(sql`
            DELETE
            FROM user_exchange_accs
            WHERE id = ${id};
        `);
    }

    //#endregion "User Exchange Account"

    //#region "User Robots"

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

        const userExchangeAcc: UserExchangeAccountState = await this.db.pg.maybeOne(sql`
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

        const robot: RobotState = await this.db.pg.maybeOne(sql`
            SELECT id, exchange, asset, currency, available
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!robot) throw new ActionsHandlerError("Robot not found", { robotId }, "NOT_FOUND", 404);

        if (userExchangeAcc.exchange !== robot.exchange)
            throw new ActionsHandlerError("Wrong exchange", null, "FORBIDDEN", 403);

        if (robot.available < user.access) throw new ActionsHandlerError("Robot unavailable.", null, "FORBIDDEN", 403);

        // TODO: do something if volumeType == balancePercent
        const marketLimits: UserMarketState["limits"] = (await this.db.pg.maybeOneFirst(sql`
            SELECT limits
            FROM v_user_markets
            WHERE user_id = ${user.id}
                AND exchange = ${robot.exchange}
                AND asset = ${robot.asset}
                AND currency = ${robot.currency};
        `)) as any;

        let _volume: number;
        let _amountMin: number;
        let _amountMax: number;
        let newUserRobotSettings: UserRobotSettings;

        if (settings.volumeType === RobotVolumeType.assetStatic) {
            _volume = settings.volume;
            _amountMin = marketLimits?.userRobot?.min?.amount;
            _amountMax = marketLimits?.userRobot?.max?.amount;
            newUserRobotSettings = { volumeType: RobotVolumeType.assetStatic, volume: _volume };
        } else if (settings.volumeType === RobotVolumeType.currencyDynamic) {
            _volume = settings.volumeInCurrency;
            _amountMin = marketLimits?.userRobot?.min?.amountUSD;
            _amountMax = marketLimits?.userRobot?.max?.amountUSD;
            newUserRobotSettings = { volumeType: RobotVolumeType.currencyDynamic, volumeInCurrency: _volume };
        } else if (settings.volumeType === UserRobotVolumeType.balancePercent) {
            _volume = settings.balancePercent;
            _amountMin = 1;
            _amountMax = 100;
            newUserRobotSettings = { volumeType: UserRobotVolumeType.balancePercent, balancePercent: _volume };
        }

        if (!_amountMin /*  || !_amountMax */)
            throw new ActionsHandlerError("Market unavailable.", null, "FORBIDDEN", 403);

        if (_volume < _amountMin)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be at least ${_amountMin}.`,
                null,
                "FORBIDDEN",
                403
            );

        if (_amountMax && _volume > _amountMax)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be not greater than ${_amountMax}.`,
                null,
                "FORBIDDEN",
                403
            );

        const userRobotId = uuid();

        await this.db.pg.query(sql`
            INSERT INTO user_robots(
                id, robot_id, user_ex_acc_id, user_id, status
            ) VALUES (
                ${userRobotId},
                ${robotId},
                ${userExAccId},
                ${userId},
                ${RobotStatus.stopped}
            );
        `);

        // active_from = now() // default
        await this.db.pg.query(sql`
                INSERT INTO user_robot_settings(
                    user_robot_id, user_robot_settings, trade_settings
                ) VALUES (
                    ${userRobotId},
                    ${sql.json(newUserRobotSettings)},
                    ${sql.json({})}
                );
        `);

        return userRobotId;
    }

    async userRobotEdit(user: User, { id, settings }: { id: string; settings: UserRobotSettings }) {
        const { id: userId } = user;

        const userRobotExists: UserRobotDB = await this.db.pg.maybeOne(sql`
            SELECT *
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

        // Not need
        //if (userRobotExists.status !== RobotStatus.stopped)

        const {
            userRobotSettings: currentUserRobotSettings,
            tradeSettings: currentTradeSettings
        }: {
            userRobotSettings: UserRobotSettings;
            tradeSettings: any;
        } = await this.db.pg.maybeOne(sql`
            SELECT user_robot_settings
            FROM v_user_robot_settings
            WHERE user_robot_id = ${id};
        `);

        if (
            (currentUserRobotSettings?.volumeType === RobotVolumeType.assetStatic &&
                settings.volumeType === RobotVolumeType.assetStatic &&
                settings.volume === currentUserRobotSettings.volume) ||
            (currentUserRobotSettings?.volumeType === RobotVolumeType.currencyDynamic &&
                settings.volumeType === RobotVolumeType.currencyDynamic &&
                settings.volumeInCurrency === currentUserRobotSettings.volumeInCurrency) ||
            (currentUserRobotSettings?.volumeType === UserRobotVolumeType.balancePercent &&
                settings.volumeType === UserRobotVolumeType.balancePercent &&
                settings.balancePercent === currentUserRobotSettings.balancePercent)
        )
            throw new ActionsHandlerError("This volume value is already set.", null, "FORBIDDEN", 403);

        // TODO: do something if volumeType == balancePercent
        const marketLimits: UserMarketState["limits"] = (await this.db.pg.maybeOneFirst(sql`
            SELECT vm.limits
            FROM robots r, v_user_markets vm
            WHERE r.id = ${userRobotExists.robotId}
                AND vm.user_id = ${user.id}
                AND vm.exchange = r.exchange
                AND vm.asset = r.asset
                AND vm.currency = r.currency;
        `)) as any;

        let _volume: number;
        let _amountMin: number;
        let _amountMax: number;
        let newUserRobotSettings: UserRobotSettings;

        if (settings.volumeType === RobotVolumeType.assetStatic) {
            _volume = settings.volume;
            _amountMin = marketLimits?.userRobot?.min?.amount;
            _amountMax = marketLimits?.userRobot?.max?.amount;
            newUserRobotSettings = { volumeType: RobotVolumeType.assetStatic, volume: _volume };
        } else if (settings.volumeType === RobotVolumeType.currencyDynamic) {
            _volume = settings.volumeInCurrency;
            _amountMin = marketLimits?.userRobot?.min?.amountUSD;
            _amountMax = marketLimits?.userRobot?.max?.amountUSD;
            newUserRobotSettings = { volumeType: RobotVolumeType.currencyDynamic, volumeInCurrency: _volume };
        } else if (settings.volumeType === UserRobotVolumeType.balancePercent) {
            _volume = settings.balancePercent;
            _amountMin = 1;
            _amountMax = 100;
            newUserRobotSettings = { volumeType: UserRobotVolumeType.balancePercent, balancePercent: _volume };
        }

        if (!_amountMin /*  || !_amountMax */)
            throw new ActionsHandlerError("Market unavailable.", null, "FORBIDDEN", 403);

        if (_volume < _amountMin)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be at least ${_amountMin}.`,
                null,
                "FORBIDDEN",
                403
            );

        if (_amountMax && _volume > _amountMax)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be not greater than ${_amountMax}.`,
                null,
                "FORBIDDEN",
                403
            );

        // active_from = now() // default
        await this.db.pg.query(sql`
            INSERT INTO user_robot_settings(
                user_robot_id, user_robot_settings, trade_settings
            ) VALUES (
                ${id},
                ${sql.json(newUserRobotSettings)},
                ${sql.json(currentTradeSettings || {})}
            );
        `);
    }

    async userRobotDelete(user: User, { id }: { id: string }) {
        const { id: userId } = user;

        const userRobotExists: UserRobotDB = await this.db.pg.maybeOne(sql`
            SELECT *
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

        if (userRobotExists.status !== RobotStatus.stopped)
            throw new ActionsHandlerError("User Robot is not stopped", null, "FORBIDDEN", 403);

        //const deletingStartTime = Date.now();
        await this.db.pg.query(sql`
                DELETE
                FROM user_robots
                WHERE id = ${id};
        `);
        //console.warn("DELETING TIME:", Date.now() - deletingStartTime);

        await this.events.emit({
            type: StatsCalcRunnerEvents.USER_ROBOT_DELETED,
            data: { userId, robotId: userRobotExists.robotId }
        });
    }

    //#endregion "User Robots"
}
