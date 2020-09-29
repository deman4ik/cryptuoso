import { HTTPService, HTTPServiceConfig, RequestExtended, UserExtended } from "@cryptuoso/service";
import { /* User,  */ UserRoles } from "@cryptuoso/user-state";
import { UserSignalState /* , UserSignalSettings */ } from "@cryptuoso/user-signal-state";
import { RobotState } from "@cryptuoso/robot-state";
import { Market } from "@cryptuoso/market";
import { ActionsHandlerError } from "@cryptuoso/errors";
import { sql } from "@cryptuoso/postgres";
import { v4 as uuid } from "uuid";
import dayjs from "@cryptuoso/dayjs";
import { StatsCalcRunnerEvents } from "@cryptuoso/stats-calc-events";

interface SomeObject<T = any> {
    [key: string]: T;
}

export interface UserProfileServiceConfig extends HTTPServiceConfig {}

export default class UserProfileService extends HTTPService {
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
                        name: "string"
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
        } catch (err) {
            this.log.error("Failed to initialize UserProfileService", err);
        }
    }

    async _httpHandler(
        handler: (user: UserExtended, params: SomeObject) => Promise<SomeObject>,
        req: RequestExtended,
        res: any
    ) {
        const result = await handler(req.meta.user, req.body.input);

        res.send({ result: result || "OK" });
        res.end();
    }

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

    async userSignalSubscribe(user: UserExtended, { robotId, volume }: { robotId: string; volume: number }) {
        const robot: RobotState = await this.db.pg.maybeOne(sql`
            SELECT exchange, asset, currency, available
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!robot) throw new ActionsHandlerError("Robot is not found.", null, "NOT_FOUND", 404);

        const { exchange, asset, currency, available } = robot;

        const isSignalExists = new Boolean(
            +(await this.db.pg.oneFirst(sql`
            SELECT COUNT(*)
            FROM user_signals
            WHERE user_id = ${user.id}
                AND robot_id = ${robotId};
        `))
        );

        if (isSignalExists) return;

        if (available < user.access) throw new ActionsHandlerError("Robot unavailable", { robotId }, "FORBIDDEN", 403);

        const market: Market = await this.db.pg.maybeOne(sql`
            SELECT *
            FROM markets
            WHERE exchange ${exchange ? sql`= ${exchange}` : sql`IS NULL`}
                AND asset ${asset ? sql`= ${asset}` : sql`IS NULL`}
                AND currency ${currency ? sql`= ${currency}` : sql`IS NULL`};
        `);

        if (volume < market.limits.amount.min)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be more than ${market.limits.amount.min}`,
                null,
                "FORBIDDEN",
                403
            );

        if (volume > market.limits.amount.max)
            throw new ActionsHandlerError(
                `Wrong volume! Value must be less than ${market.limits.amount.max}`,
                null,
                "FORBIDDEN",
                403
            );

        const userSignalId = uuid();

        await this.db.pg.query(sql`
            INSERT INTO user_signals(
                id, robot_id, user_id, volume, subscribed_at
            ) VALUES (
                ${userSignalId},
                ${robotId},
                ${user.id},
                ${volume},
                ${dayjs.utc().toISOString()}
            );

            INSERT INTO user_signal_settings(
                user_signal_id, volume, active_from
            ) VALUES (
                ${userSignalId},
                ${sql.json({ volume })},
                ${dayjs.utc().toISOString()}
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

        const userSignalSettings: SomeObject & {
            volume: number;
        } = await this.db.pg.maybeOne(sql`
            SELECT signal_settings
            FROM v_user_signal_settings
            WHERE user_signal_id = ${userSignal.id};
        `);

        if (userSignalSettings?.volume === volume)
            throw new ActionsHandlerError("This volume value is already set.", null, "FORBIDDEN", 403);

        const newUserSignalSettings = { ...userSignalSettings, volume };

        await this.db.pg.query(sql`
            UPDATE user_signals
            SET volume = ${volume}
            WHERE id = ${userSignal.id};

            INSERT INTO user_signal_settings(
                user_signal_id, volume, active_from
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

        // TODO: think about other way to update this user signals aggr. statistics
        await this.events.emit({
            type: StatsCalcRunnerEvents.USER_SIGNALS,
            data: {
                userId: user.id,
                calcAll: true
            }
        });
    }
}
