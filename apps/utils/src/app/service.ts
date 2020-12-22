import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { sql } from "@cryptuoso/postgres";
import { VolumeSettingsType, AssetStaticSettings } from "@cryptuoso/robot-settings";
import { getAccessValue, User, UserAccessValues } from "@cryptuoso/user-state";

export type UtilsServiceConfig = HTTPServiceConfig;

export default class UtilsService extends HTTPService {
    constructor(config?: UtilsServiceConfig) {
        super(config);

        try {
            this.createRoutes({
                initConfig: {
                    auth: true,
                    roles: ["admin"],
                    handler: this.initConfig
                },
                initUserAccess: {
                    auth: true,
                    roles: ["admin"],
                    handler: this.initUserAccess
                },
                initUserNewsNotifications: {
                    auth: true,
                    roles: ["admin"],
                    handler: this.initUserNewsNotifications
                },
                initRobotSettings: {
                    inputSchema: {
                        robots: { type: "boolean", default: true },
                        userSignals: { type: "boolean", default: true },
                        userRobots: { type: "boolean", default: true }
                    },
                    auth: true,
                    roles: ["admin"],
                    handler: this.initRobotSettings
                }
            });
        } catch (err) {
            this.log.error("Error while constructing UtilsService", err);
        }
    }

    async initConfig(req: any, res: any) {
        const configs: {
            available: UserAccessValues;
            amount: {
                robot: {
                    minUSD: number;
                };
                userSignal: {
                    minUSD: number;
                };
                userRobot: {
                    minUSD: number;
                    balancePercent: number;
                };
            };
        }[] = [
            {
                available: UserAccessValues.user,
                amount: {
                    robot: {
                        minUSD: 100
                    },
                    userSignal: {
                        minUSD: 10
                    },
                    userRobot: {
                        minUSD: 20,
                        balancePercent: 200
                    }
                }
            }
        ];
        for (const config of configs) {
            await this.db.pg.query(sql`
        INSERT INTO configs 
        (available, 
        amount) 
        VALUES 
        (${config.available},
        ${sql.json(config.amount)})
        ON CONFLICT ON CONSTRAINT configs_pkey
        DO UPDATE SET amount = excluded.amount;`);
        }

        res.send({ result: "OK" });
        res.end();
    }

    async initUserAccess(req: any, res: any) {
        const users = await this.db.pg.many<User>(sql`SELECT id, roles from users;`);

        const usersWithAccess: User[] = users.map((user) => ({
            ...user,
            access: getAccessValue(user)
        }));

        for (const user of usersWithAccess) {
            await this.db.pg.query(sql`
            UPDATE users
            SET access = ${user.access}
            where id = ${user.id};`);
        }

        res.send({ result: "OK" });
        res.end();
    }

    async initUserNewsNotifications(req: any, res: any) {
        const news: User["settings"]["notifications"]["news"] = { email: true, telegram: true };

        await this.db.pg.query(sql`
            UPDATE users
            SET settings = jsonb_set(settings, '{"notifications", "news"}', ${sql.json(news)}, true)
            WHERE settings->'notifications'->'news' IS NULL
        `);

        res.send({ result: "OK" });
        res.end();
    }

    async initRobotSettings(
        req: {
            body: {
                input: { robots: boolean; userSignals: boolean; userRobots: boolean };
            };
        },
        res: any
    ) {
        const { robots, userSignals, userRobots } = req.body.input;

        if (robots) {
            await this.db.pg.query(sql`delete from robot_settings;`);
            const robotsList = await this.db.pg.many<{
                id: string;
                settings: {
                    strategyParameters: { [key: string]: any };
                    volume: number;
                    requiredHistoryMaxBars: number;
                };
                createdAt: string;
                startedAt: string;
            }>(sql`
            SELECT id, settings, trade_settings, created_at, started_at
            FROM robots;`);

            for (const { id, settings, createdAt, startedAt } of robotsList) {
                const strategySettings = { ...settings.strategyParameters, requiredHistoryMaxBars: 300 };

                const robotSettings: AssetStaticSettings = {
                    volumeType: VolumeSettingsType.assetStatic,
                    volume: settings.volume
                };

                await this.db.pg.query(sql`
                    INSERT INTO robot_settings 
                    (robot_id, 
                    strategy_settings, 
                    robot_settings, 
                    active_from) 
                    VALUES 
                    (${id},
                    ${sql.json(strategySettings)},
                    ${JSON.stringify(robotSettings)},
                    ${startedAt || createdAt})
                    ON CONFLICT ON CONSTRAINT robot_settings_robot_id_active_from_key
                    DO UPDATE SET strategy_settings = excluded.strategy_settings,
                                  robot_settings = excluded.robot_settings;`);
            }
        }

        if (userSignals) {
            await this.db.pg.query(sql`delete from user_signal_settings;`);
            const userSignalsList = await this.db.pg.many<{
                id: string;
                volume: number;
                subscribedAt: string;
            }>(sql`
            SELECT id, volume, subscribed_at
            FROM user_signals;`);

            for (const { id, volume, subscribedAt } of userSignalsList) {
                const userSignalSettings: AssetStaticSettings = {
                    volumeType: VolumeSettingsType.assetStatic,
                    volume
                };
                await this.db.pg.query(sql`
                    INSERT INTO user_signal_settings 
                    (user_signal_id, 
                    user_signal_settings, 
                    active_from) 
                    VALUES 
                    (${id},
                    ${JSON.stringify(userSignalSettings)},
                    ${subscribedAt})
                    ON CONFLICT ON CONSTRAINT user_signal_settings_user_signal_id_active_from_key
                    DO UPDATE SET user_signal_settings = excluded.user_signal_settings;`);
            }
        }

        if (userRobots) {
            await this.db.pg.query(sql`delete from user_robot_settings;`);
            const userRobotsList = await this.db.pg.many<{
                id: string;
                settings: { [key: string]: any };
                createdAt: string;
            }>(sql`
            SELECT ur.id, ur.settings, ur.created_at
            FROM user_robots ur, robots r
            WHERE ur.robot_id = r.id;`);

            for (const { id, settings, createdAt } of userRobotsList) {
                await this.db.pg.query(sql`
                    INSERT INTO user_robot_settings 
                    (user_robot_id, 
                    user_robot_settings, 
                    active_from) 
                    VALUES 
                    (${id},
                    ${sql.json(settings)},
                    ${createdAt})
                    ON CONFLICT ON CONSTRAINT user_robot_settings_user_robot_id_active_from_key
                    DO UPDATE SET user_robot_settings = excluded.user_robot_settings;`);
            }
        }

        res.send({ result: "OK" });
        res.end();
    }
}
