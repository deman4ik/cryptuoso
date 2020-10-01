import { HTTPService, HTTPServiceConfig, RequestExtended, UserExtended } from "@cryptuoso/service";
import {
    GenericObject,
    /* User,  */ UserRoles,
    UserExchangeAccountState,
    UserExchangeKeys,
    UserExchangeAccStatus,
    EncryptedData
} from "@cryptuoso/user-state";
import { UserSignalState /* , UserSignalSettings */ } from "@cryptuoso/user-signal-state";
import { RobotState, RobotStatus } from "@cryptuoso/robot-state";
import { UserRobotDB } from "@cryptuoso/user-robot-state";
import { Market } from "@cryptuoso/market";
import { ActionsHandlerError } from "@cryptuoso/errors";
import { sql } from "@cryptuoso/postgres";
import { v4 as uuid } from "uuid";
import dayjs from "@cryptuoso/dayjs";
import { StatsCalcRunnerEvents } from "@cryptuoso/stats-calc-events";
import { spawn, Pool, Worker as ThreadsWorker } from "threads";
import { Encrypt } from "./encryptWorker";
import { formatExchange } from "@cryptuoso/helpers";
import { UserRobotSettings } from "@cryptuoso/robot-settings";

export type UserProfileServiceConfig = HTTPServiceConfig;

export default class UserProfileService extends HTTPService {
    private pool: Pool<any>;

    constructor(config?: UserProfileServiceConfig) {
        super(config);

        try {
            this.createRoutes({
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
                        name: "string",
                        // TODO: check
                        empty: false
                    },
                    handler: this._httpHandler.bind(this, this.changeName.bind(this))
                },
                userSignalSubscribe: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        robotId: "uuid",
                        volume: "number"
                    },
                    handler: this._httpHandler.bind(this, this.userSignalSubscribe.bind(this))
                },
                userSignalEdit: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        robotId: "uuid",
                        volume: "number"
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
                }
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
        return this.pool.queue(async (encrypt: Encrypt) => encrypt(userId, data));
    }

    async _httpHandler(
        handler: (user: UserExtended, params: GenericObject) => Promise<GenericObject | any>,
        req: RequestExtended,
        res: any
    ) {
        const result = await handler(req.meta.user, req.body.input);

        res.send({ result: result || "OK" });
        res.end();
    }

    //#region "User Settings"

    async setNotificationSettings(
        user: UserExtended,
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

    async changeName(user: UserExtended, { name }: { name: string }) {
        await this.db.pg.query(sql`
            UPDATE users
            SET name = ${name}
            WHERE id = ${user.id};
        `);
    }

    //#endregion "User Settings"

    //#region "User Signals"

    async userSignalSubscribe(user: UserExtended, { robotId, volume }: { robotId: string; volume: number }) {
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

        const marketLimits: Market["limits"] = (await this.db.pg.maybeOneFirst(sql`
            SELECT limits
            FROM markets
            WHERE exchange = ${exchange}
                AND asset = ${asset}
                AND currency = ${currency};
        `)) as any;

        if (!marketLimits?.amount) throw new ActionsHandlerError("Market unavailable.", null, "FORBIDDEN", 403);

        const { amount } = marketLimits;

        if (volume < amount.min)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be at least ${amount.min}.`,
                null,
                "FORBIDDEN",
                403
            );

        if (volume > amount.max)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be not greater than ${amount.max}.`,
                null,
                "FORBIDDEN",
                403
            );

        const userSignalId = uuid();
        const subscribedAt = dayjs.utc().toISOString();

        await this.db.pg.query(sql`
        INSERT INTO user_signals(
            id, robot_id, user_id, volume, subscribed_at
        ) VALUES (
            ${userSignalId},
            ${robotId},
            ${user.id},
            ${volume},
            ${subscribedAt}
        );
    `);
        await this.db.pg.query(sql`
            INSERT INTO user_signal_settings(
                user_signal_id, user_signal_settings, active_from
            ) VALUES (
                ${userSignalId},
                ${sql.json({ volume })},
                ${subscribedAt}
            );
        `);

        // TODO: initialize statistics or do nothing
    }

    async userSignalEdit(user: UserExtended, { robotId, volume }: { robotId: string; volume: number }) {
        const userSignal: UserSignalState = await this.db.pg.maybeOne(sql`
            SELECT id
            FROM user_signals
            WHERE robot_id = ${robotId}
                AND user_id = ${user.id};
        `);

        if (!userSignal) throw new ActionsHandlerError("Subscription not found.", null, "NOT_FOUND", 404);

        const userSignalSettings: GenericObject & {
            volume: number;
        } = await this.db.pg.maybeOne(sql`
            SELECT signal_settings
            FROM v_user_signal_settings
            WHERE user_signal_id = ${userSignal.id};
        `);

        if (userSignalSettings?.volume === volume)
            throw new ActionsHandlerError("This volume value is already set.", null, "FORBIDDEN", 403);

        const marketLimits: Market["limits"] = (await this.db.pg.maybeOneFirst(sql`
            SELECT m.limits
            FROM robots r, markets m
            WHERE r.id = ${robotId}
                AND m.exchange = r.exchange
                AND m.asset = r.asset
                AND m.currency = r.currency;
        `)) as any;

        if (!marketLimits?.amount) throw new ActionsHandlerError("Market unavailable.", null, "FORBIDDEN", 403);

        const { amount } = marketLimits;

        if (volume < amount.min)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be at least ${amount.min}.`,
                null,
                "FORBIDDEN",
                403
            );

        if (volume > amount.max)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be not greater than ${amount.max}.`,
                null,
                "FORBIDDEN",
                403
            );

        const newUserSignalSettings = { ...userSignalSettings, volume };

        await this.db.pg.query(sql`
            UPDATE user_signals
            SET volume = ${volume}
            WHERE id = ${userSignal.id};
        `);

        await this.db.pg.query(sql`
            INSERT INTO user_signal_settings(
                user_signal_id, user_signal_settings, active_from
            ) VALUES (
                ${userSignal.id},
                ${sql.json(newUserSignalSettings)},
                ${dayjs.utc().toISOString()}
            );
        `);
    }

    async userSignalUnsubscribe(user: UserExtended, { robotId }: { robotId: string }) {
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
        user: UserExtended,
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
                    throw new ActionsHandlerError("", { userExAccId: existed.id }, "FORBIDDEN", 403);

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
        user: UserExtended,
        {
            id,
            name
        }: {
            id: string;
            name: string;
        }
    ) {
        const { id: userId } = user;

        let userExchangeAcc: UserExchangeAccountState = await this.db.pg.maybeOne(sql`
            SELECT *
            FROM user_exchange_accs
            WHERE id = ${id};
        `);

        if (!userExchangeAcc)
            throw new ActionsHandlerError("User Exchange Account not found", { id }, "NOT_FOUND", 404);
        if (userExchangeAcc.userId !== userId)
            throw new ActionsHandlerError("", { userExAccId: userExchangeAcc.id }, "FORBIDDEN", 403);

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

    async userExchangeAccDelete(user: UserExtended, { id }: { id: string }) {
        const { id: userId } = user;

        let userExchangeAcc: UserExchangeAccountState = await this.db.pg.maybeOne(sql`
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
        user: UserExtended,
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

        const robot: {
            id: string;
            exchange: string;
            asset: string;
            currency: string;
            available: number;
        } = await this.db.pg.maybeOne(sql`
            SELECT id, exchange, asset, currency, available
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!robot) throw new ActionsHandlerError("Robot not found", { robotId }, "NOT_FOUND", 404);

        if (userExchangeAcc.exchange !== robot.exchange)
            throw new ActionsHandlerError("Wrong exchange", null, "FORBIDDEN", 403);

        if (robot.available < user.access) throw new ActionsHandlerError("", null, "FORBIDDEN", 403);

        const userRobotExists = await this.db.pg.maybeOne(sql`
            SELECT id
            FROM user_robots
            WHERE user_id = ${userId}
                AND robot_id = ${robotId};
        `);

        if (userRobotExists) throw new ActionsHandlerError("User Robot already exists", null, "FORBIDDEN", 403);

        const marketLimits: Market["limits"] = (await this.db.pg.maybeOneFirst(sql`
            SELECT limits
            FROM markets
            WHERE exchange = ${robot.exchange}
                AND asset = ${robot.asset}
                AND currency = ${robot.currency};
        `)) as any;

        if (!marketLimits?.amount) throw new ActionsHandlerError("Market unavailable.", null, "FORBIDDEN", 403);

        const { amount } = marketLimits;

        // TODO: settings typing

        if ((settings as any).volume < amount.min)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be at least ${amount.min}.`,
                null,
                "FORBIDDEN",
                403
            );

        if ((settings as any).volume > amount.max)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be not greater than ${amount.max}.`,
                null,
                "FORBIDDEN",
                403
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
                    ${sql.json(settings)}
                );
        `);

        return userRobotId;
    }

    async userRobotEdit(user: UserExtended, { id, settings }: { id: string; settings: UserRobotSettings }) {
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

        const robot: {
            id: string;
            exchange: string;
            asset: string;
            currency: string;
        } = await this.db.pg.maybeOne(sql`
            SELECT id, exchange, asset, currency
            FROM robots
            WHERE id = ${userRobotExists.robotId};
        `);

        if (!robot)
            throw new ActionsHandlerError("Robot not found", { robotId: userRobotExists.robotId }, "NOT_FOUND", 404);

        const marketLimits: Market["limits"] = (await this.db.pg.maybeOneFirst(sql`
            SELECT limits
            FROM markets
            WHERE exchange = ${robot.exchange}
                AND asset = ${robot.asset}
                AND currency = ${robot.currency};
        `)) as any;

        if (!marketLimits?.amount) throw new ActionsHandlerError("Market unavailable.", null, "FORBIDDEN", 403);

        const { amount } = marketLimits;

        // TODO: settings typing

        if ((settings as any).volume < amount.min)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be at least ${amount.min}.`,
                null,
                "FORBIDDEN",
                403
            );

        if ((settings as any).volume > amount.max)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be not greater than ${amount.max}.`,
                null,
                "FORBIDDEN",
                403
            );

        await this.db.pg.query(sql`
            UPDATE user_robots
            SET settings = ${sql.json(settings)}
            WHERE id = ${id};
        `);

        /* TODO: create event subscriber (stats-calc-runner) or do nothing

        await this.events.emit({
            type: StatsCalcRunnerEvents.USER_ROBOT_UPDATED,
            data: { userRobotId: id }
        }); */
    }

    async userRobotDelete(user: UserExtended, { id }: { id: string }) {
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

        await this.db.pg.query(sql`
                DELETE
                FROM user_robots
                WHERE id = ${id};
        `);

        await this.events.emit({
            type: StatsCalcRunnerEvents.USER_ROBOT_DELETED,
            data: { userId, robotId: userRobotExists.robotId }
        });
    }

    //#endregion "User Robots"
}
