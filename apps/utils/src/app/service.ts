import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { RobotSettings, RobotTradeSettings } from "@cryptuoso/robot-state";
import { sql } from "@cryptuoso/postgres";

export type UtilsServiceConfig = HTTPServiceConfig;

export default class UtilsService extends HTTPService {
    constructor(config?: UtilsServiceConfig) {
        super(config);

        try {
            this.createRoutes({
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
            this.log.error(err, "While consctructing UtilsService");
        }
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
            const robotsList: {
                id: string;
                settings: {
                    strategyParameters: { [key: string]: any };
                    volume: number;
                    requiredHistoryMaxBars: number;
                };
                tradeSettings: RobotTradeSettings;
                createdAt: string;
            }[] = await this.db.pg.many(sql`
            SELECT id, settings, trade_settings, created_at
            FROM robots;`);

            for (const { id, settings, tradeSettings, createdAt } of robotsList) {
                const strategySettings = settings.strategyParameters;

                const robotSettings = {
                    volume: settings.volume,
                    requiredHistoryMaxBars: settings.requiredHistoryMaxBars
                };

                await this.db.pg.query(sql`
                    INSERT INTO robot_settings 
                    (robot_id, 
                    strategy_settings, 
                    robot_settings, 
                    trade_settings, 
                    active_from) 
                    VALUES 
                    (${id},
                    ${sql.json(strategySettings)},
                    ${sql.json(robotSettings)},
                    ${sql.json(tradeSettings)},
                    ${createdAt})
                    ON CONFLICT ON CONSTRAINT robot_settings_robot_id_active_from_key
                    DO UPDATE SET strategy_settings = excluded.strategy_settings,
                                  robot_settings = excluded.robot_settings,
                                  trade_settings = excluded.trade_settings;`);
            }
        }

        if (userSignals) {
            const userSignalsList: {
                id: string;
                volume: number;
                subscribedAt: string;
            }[] = await this.db.pg.many(sql`
            SELECT id, volume, subscribed_at
            FROM user_signals;`);

            for (const { id, volume, subscribedAt } of userSignalsList) {
                await this.db.pg.query(sql`
                    INSERT INTO user_signal_settings 
                    (user_signal_id, 
                    signal_settings, 
                    active_from) 
                    VALUES 
                    (${id},
                    ${sql.json({ volume })},
                    ${subscribedAt})
                    ON CONFLICT ON CONSTRAINT user_signal_settings_user_signal_id_active_from_key
                    DO UPDATE SET signal_settings = excluded.signal_settings;`);
            }
        }

        if (userRobots) {
            const userRobotsList: {
                id: string;
                settings: { [key: string]: any };
                createdAt: string;
                tradeSettings: RobotTradeSettings;
            }[] = await this.db.pg.many(sql`
            SELECT ur.id, ur.settings, ur.created_at, r.trade_settings
            FROM user_robots ur, robots r
            WHERE ur.robot_id = r.id;`);

            for (const { id, settings, tradeSettings, createdAt } of userRobotsList) {
                await this.db.pg.query(sql`
                    INSERT INTO user_robot_settings 
                    (user_robot_id, 
                    user_robot_settings, 
                    trade_settings,
                    active_from) 
                    VALUES 
                    (${id},
                    ${sql.json(settings)},
                    ${sql.json(tradeSettings)},
                    ${createdAt})
                    ON CONFLICT ON CONSTRAINT user_robot_settings_user_robot_id_active_from_key
                    DO UPDATE SET user_robot_settings = excluded.user_robot_settings,
                    trade_settings = excluded.trade_settings;`);
            }
        }

        res.send({ result: "OK" });
        res.end();
    }
}
