import { sql } from "@cryptuoso/postgres";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { Webhook } from "coinbase-commerce-node";
import { UserSubCheckPayment, UserSubInEvents } from "@cryptuoso/user-sub-events";
import { UserRoles } from "@cryptuoso/user-state";
import {
    calcUserLeverage,
    getPortfolioBalance,
    PortfolioDB,
    PortfolioRobotDB,
    PortfolioSettings,
    SignalRobotDB,
    SignalSubscriptionDB,
    SignalSubscriptionPosition,
    SignalSubscriptionState
} from "@cryptuoso/portfolio-state";
import { v4 as uuid } from "uuid";
import dayjs from "@cryptuoso/dayjs";
import { equals, nvl } from "@cryptuoso/helpers";
import {
    PortfolioManagerInEvents,
    PortfolioManagerOutEvents,
    PortfolioManagerOutSchema,
    PortfolioManagerPortfolioBuilded,
    PortfolioManagerSignalSubscriptionBuildError,
    PortfolioManagerSignalSubscriptionError
} from "@cryptuoso/portfolio-events";
import { Signal, SignalEvents, SignalSchema } from "@cryptuoso/robot-events";
import {
    UserPortfolioStatus,
    UserRobotRunnerEvents,
    UserRobotRunnerPause,
    UserRobotRunnerResume,
    UserRobotRunnerSchema,
    UserRobotRunnerStart,
    UserRobotRunnerStartPortfolio,
    UserRobotRunnerStop,
    UserRobotRunnerStopPortfolio,
    UserRobotWorkerEvents,
    UserRobotWorkerStatus,
    USER_ROBOT_WORKER_TOPIC
} from "@cryptuoso/user-robot-events";
import { TradeAction } from "@cryptuoso/market";
import { SignalSubscriptionRobot } from "./signalSubscriptionRobot";

export type WebhooksServiceConfig = HTTPServiceConfig;

export default class WebhooksService extends HTTPService {
    constructor(config?: WebhooksServiceConfig) {
        super({ ...config, enableActions: true, enableWebhooks: true });
        try {
            this.createWebhooks({
                coinbaseCommerceEvents: {
                    handler: this.handleCoinbaseCommerceEvents
                }
            });
            this.createRoutes({
                createSignalSubscription: {
                    inputSchema: {
                        exchange: "string",
                        type: { type: "enum", values: ["zignaly"] },
                        url: "url",
                        token: "string",
                        initialBalance: { type: "number", positive: true },
                        leverage: { type: "number", optional: true, integer: true, positive: true },
                        options: {
                            type: "object",
                            props: {
                                profit: "boolean",
                                risk: "boolean",
                                moneyManagement: "boolean",
                                winRate: "boolean",
                                efficiency: "boolean"
                            }
                        }
                    },
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.createSignalSubscription.bind(this))
                },
                editSignalSubscription: {
                    inputSchema: {
                        signalSubscriptionId: "uuid",
                        leverage: { type: "number", optional: true, integer: true, positive: true },
                        options: {
                            type: "object",
                            props: {
                                profit: "boolean",
                                risk: "boolean",
                                moneyManagement: "boolean",
                                winRate: "boolean",
                                efficiency: "boolean"
                            },
                            optional: true
                        }
                    },
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.editSignalSubscription.bind(this))
                },
                deleteSignalSubscription: {
                    inputSchema: {
                        signalSubscriptionId: "uuid"
                    },
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.deleteSignalSubscription.bind(this))
                },
                startSignalSubscription: {
                    inputSchema: {
                        signalSubscriptionId: "uuid"
                    },
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.startSignalSubscription.bind(this))
                },
                stopSignalSubscription: {
                    inputSchema: {
                        signalSubscriptionId: "uuid"
                    },
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.stopSignalSubscription.bind(this))
                },
                syncSignalPortfolioRobots: {
                    roles: [UserRoles.admin, UserRoles.manager],
                    inputSchema: UserRobotRunnerSchema[UserRobotRunnerEvents.SYNC_SIGNAL_PORTFOLIO_ROBOTS],
                    handler: this.HTTPHandler.bind(this, this.syncSignalPortfolioRobots.bind(this))
                },
                syncSignalSubscriptionRobots: {
                    roles: [UserRoles.admin, UserRoles.manager],
                    inputSchema: UserRobotRunnerSchema[UserRobotRunnerEvents.SYNC_SIGNAL_SUBSCRIPTION_ROBOTS],
                    handler: this.HTTPHandler.bind(this, this.syncSignalSubscriptionRobots.bind(this))
                }
            });

            this.events.subscribe({
                [SignalEvents.TRADE]: {
                    handler: this.handleSignalTradeEvents.bind(this),
                    schema: SignalSchema[SignalEvents.TRADE]
                },
                [PortfolioManagerOutEvents.PORTFOLIO_BUILDED]: {
                    handler: this.handlePortfolioBuilded.bind(this),
                    schema: PortfolioManagerOutSchema[PortfolioManagerOutEvents.PORTFOLIO_BUILDED]
                }
            });
        } catch (err) {
            this.log.error("Failed to initialize WebhooksService", err);
        }
    }

    async handleCoinbaseCommerceEvents(
        req: {
            body: any;
            headers: { [key: string]: string };
        },
        res: any
    ) {
        try {
            this.log.debug(req);
            const event = Webhook.verifyEventBody(
                JSON.stringify(req.body),
                req.headers["x-cc-webhook-signature"],
                process.env.COINBASE_COMMERCE_SECRET
            );
            this.log.debug(event);

            await this.db.pg.query(sql`INSERT INTO coinbase_commerce_events
            (id, resource, type, api_version, data, created_at)
            VALUES (
                ${event.id},
                ${event.resource},
                ${event.type},
                ${event.api_version},
                ${JSON.stringify(event.data)},
                ${event.created_at}
            ) ON CONFLICT ON CONSTRAINT coinbase_commerce_events_pkey
            DO NOTHING;`);

            if (event.type.includes("charge") && event.type !== "charge:created")
                await this.events.emit<UserSubCheckPayment>({
                    type: UserSubInEvents.CHECK_PAYMENT,
                    data: {
                        chargeId: event.data.id,
                        provider: "coinbase.commerce"
                    }
                });
            res.send(200);
        } catch (error) {
            this.log.error(error);
            res.send(400);
        } finally {
            res.end();
        }
    }

    async createSignalSubscription({
        exchange,
        type,
        initialBalance,
        leverage,
        options,
        url,
        token
    }: PortfolioSettings & {
        exchange: SignalSubscriptionDB["exchange"];
        type: SignalSubscriptionDB["type"];
        url: SignalSubscriptionDB["url"];
        token: SignalSubscriptionDB["token"];
    }) {
        const {
            portfolioId,
            limits: { recommendedBalance },
            settings: { leverage: defaultLeverage },
            maxLeverage
        } = await this.db.pg.one<{
            portfolioId: string;
            limits: {
                recommendedBalance: number;
            };
            settings: PortfolioSettings;

            maxLeverage: number;
        }>(sql`
    SELECT p.id as portfolio_id, p.limits, p.settings, e.max_leverage 
    from v_portfolios p, exchanges e 
    where e.code = ${exchange}
    AND p.exchange = ${exchange} 
    AND p.base = true
    AND p.status = 'started'
    AND p.option_risk = ${options.risk}
    AND p.option_profit = ${options.profit}
    AND p.option_win_rate = ${options.winRate}
    AND p.option_efficiency = ${options.efficiency}
    AND p.option_money_management = ${options.moneyManagement};
    `);

        const portfolioRobots = await this.db.pg.any<PortfolioRobotDB>(sql`
        SELECT robot_id, active, share, priority
        FROM portfolio_robots
        WHERE portfolio_id = ${portfolioId}
        AND active = true;`);

        const signalSubscriptionLeverage =
            leverage || calcUserLeverage(recommendedBalance, defaultLeverage, maxLeverage, initialBalance);

        const signalSubscription: SignalSubscriptionDB = {
            id: uuid(),
            exchange,
            type,
            status: "started",
            url,
            token
        };

        const signalSubscriptionSettings: PortfolioSettings = {
            options,
            initialBalance,
            leverage: signalSubscriptionLeverage
        };

        await this.db.pg.transaction(async (t) => {
            await t.query(sql`
            insert into signal_subscriptions
            (id, exchange, type, status, url, token)
            VALUES (${signalSubscription.id},
            ${signalSubscription.exchange},
            ${signalSubscription.type}, 
            ${signalSubscription.status},
            ${signalSubscription.url},
            ${signalSubscription.token}
            );`);

            if (portfolioRobots && portfolioRobots.length) {
                await t.query(sql`
                    insert into signal_subscription_settings (signal_subscription_id, active_from, signal_subscription_settings, robots, active)
                    values (${signalSubscription.id}, ${dayjs.utc().toISOString()}, ${JSON.stringify(
                    signalSubscriptionSettings
                )}, ${JSON.stringify(portfolioRobots)}, ${true}); 
                    `);
            }
        });
        return { result: signalSubscription.id };
    }

    async editSignalSubscription({
        signalSubscriptionId,
        leverage,
        options
    }: PortfolioSettings & {
        signalSubscriptionId: SignalSubscriptionDB["id"];
    }) {
        const signalSubscription = await this.db.pg.one<SignalSubscriptionState>(sql`
        SELECT s.id, s.type, s.exchange, s.status, 
              sss.id as signal_subscription_settings_id, 
              sss.active_from as  signal_subscription_settings_active_from,
              sss.signal_subscription_settings as settings,
                  json_build_object('minTradeAmount', m.min_trade_amount,
                                    'feeRate', m.fee_rate,
                                    'currentBalance', ((s.full_stats ->> 'currentBalance'::text))::numeric) as context
           FROM signal_subscriptions s, signal_subscription_settings sss,
                (SELECT mk.exchange, 
                        max(mk.min_amount_currency) as min_trade_amount, 
                        max(mk.fee_rate) as fee_rate 
                 FROM v_markets mk
                 GROUP BY mk.exchange) m
           WHERE s.exchange = m.exchange
             AND sss.signal_subscription_id = s.id
             AND sss.active = true 
             AND s.id = ${signalSubscriptionId}
             ORDER BY sss.active_from DESC NULLS FIRST LIMIT 1; 
       `);

        const newOptions = { ...signalSubscription.settings.options, ...options };

        const { portfolioId } = await this.db.pg.one<{
            portfolioId: string;
        }>(sql`
SELECT  p.id as portfolio_id from v_portfolios p where
p.exchange = ${signalSubscription.exchange} 
AND p.base = true
AND p.status = 'started'
AND p.option_risk = ${newOptions.risk}
AND p.option_profit = ${newOptions.profit}
AND p.option_win_rate = ${newOptions.winRate}
AND p.option_efficiency = ${newOptions.efficiency}
AND p.option_money_management = ${newOptions.moneyManagement};
`);

        const portfolioRobots = await this.db.pg.any<PortfolioRobotDB>(sql`
SELECT robot_id, active, share, priority
FROM portfolio_robots
WHERE portfolio_id = ${portfolioId}
AND active = true;`);

        const signalSubscriptionSettings: PortfolioSettings = {
            ...signalSubscription.settings,
            options: newOptions,
            leverage: signalSubscription.settings.leverage || leverage
        };

        if (!equals(signalSubscriptionSettings, signalSubscription.settings)) {
            await this.db.pg.transaction(async (t) => {
                await t.query(sql`UPDATE signal_subscription_settings 
                    SET active = ${false}
                    WHERE signal_subscription_id = ${signalSubscription.id};
                    `);
                await t.query(sql`
                    insert into signal_subscription_settings (signal_subscription_id, active_from, signal_subscription_settings, robots, active)
                    values (${signalSubscription.id}, ${dayjs.utc().toISOString()}, ${JSON.stringify(
                    signalSubscriptionSettings
                )}, ${JSON.stringify(portfolioRobots) || null}, ${true}); 
                    `);
            });
        }
    }

    async deleteSignalSubscription({ signalSubscriptionId }: { signalSubscriptionId: string }) {
        const { status } = await this.db.pg.one<{ status: SignalSubscriptionDB["status"] }>(sql`
       SELECT  status 
       FROM sisgnal_subscriptions
       WHERE id = ${signalSubscriptionId};
       `);

        if (status === "started") throw new Error(`Signal Subscription #${signalSubscriptionId} is ${status}`);

        await this.db.pg.query(sql`
       DELETE FROM signal_subscriptions 
       WHERE id = ${signalSubscriptionId};
       `);
    }

    async startSignalSubscription({ signalSubscriptionId }: { signalSubscriptionId: string }) {
        const { status } = await this.db.pg.one<{ status: SignalSubscriptionDB["status"] }>(sql`
       SELECT  status 
       FROM sisgnal_subscriptions
       WHERE id = ${signalSubscriptionId};
       `);

        if (status === "started") return status;

        await this.db.pg.query(sql`
       UPDATE signal_subscriptions 
       SET status = 'started'
       WHERE id = ${signalSubscriptionId};
       `);

        return "started";
    }

    async stopSignalSubscription({ signalSubscriptionId }: { signalSubscriptionId: string }) {
        const { status } = await this.db.pg.one<{ status: SignalSubscriptionDB["status"] }>(sql`
       SELECT  status 
       FROM sisgnal_subscriptions
       WHERE id = ${signalSubscriptionId};
       `);

        if (status === "stopped") return status;

        await this.db.pg.query(sql`
       UPDATE signal_subscriptions 
       SET status = 'stopped'
       WHERE id = ${signalSubscriptionId};
       `);

        return "stopped";
    }

    async syncSignalPortfolioRobots({ exchange }: { exchange: string }) {
        const exchangeCondition = exchange ? sql`AND exchange = ${exchange}` : sql``;
        const portfolios = await this.db.pg.any<{ id: PortfolioDB["id"] }>(sql`
        SELECT id from portfolios 
        where base = true 
        and status = 'started' 
        ${exchangeCondition};
        `);

        for (const { id } of portfolios) {
            await this.handlePortfolioBuilded({ portfolioId: id });
        }
    }

    async handlePortfolioBuilded({ portfolioId }: PortfolioManagerPortfolioBuilded) {
        try {
            const portfolio = await this.db.pg.one<{
                exchange: PortfolioDB["exchange"];
                settings: PortfolioDB["settings"];
                status: PortfolioDB["status"];
                base: PortfolioDB["base"];
            }>(sql`
            SELECT exchange, settings, status, base 
            FROM portfolios 
            WHERE id = ${portfolioId};`);

            if (!portfolio.base || portfolio.status !== "started") return;

            const { options } = portfolio.settings;
            const signalSubscriptions = await this.db.pg.any<{ id: SignalSubscriptionDB["id"] }>(sql`
            SELECT p.id
            FROM v_signal_subscriptions p
            WHERE p.exchange = ${portfolio.exchange}
            AND p.option_risk = ${options.risk}
            AND p.option_profit = ${options.profit}
            AND p.option_win_rate = ${options.winRate}
            AND p.option_efficiency = ${options.efficiency}
            AND p.option_money_management = ${options.moneyManagement};`);

            if (!signalSubscriptions || !Array.isArray(signalSubscriptions) || !signalSubscriptions.length) return;

            const robots = await this.db.pg.any<PortfolioRobotDB>(sql`
                SELECT robot_id, active, share, priority
                FROM portfolio_robots
                WHERE portfolio_id = ${portfolioId}
                AND active = true;`);

            if (!robots || !Array.isArray(robots) || !robots.length) {
                this.log.error(`No portfolio robots found for ${portfolioId} portfolio`);
                return;
            }

            const stringifiedRobots = JSON.stringify(robots);
            for (const { id } of signalSubscriptions) {
                try {
                    await this.db.pg.query(sql`
                UPDATE signal_subscription_settings set robots = ${stringifiedRobots}
                WHERE signal_subscription_id = ${id} and active = true;
                `);
                    await this.syncSignalSubscriptionRobots({ signalSubscriptionId: id });
                } catch (error) {
                    this.log.error(`Failed to update signal subscription's #${id} settings and sync`, error);
                }
            }
            this.log.info(
                `Synced ${signalSubscriptions.length} user portfolio ${robots.length} robots with ${portfolioId} portfolio`
            );
        } catch (error) {
            this.log.error(`Failed to handle portfolio's #${portfolioId} builded event`, error);
        }
    }

    async syncSignalSubscriptionRobots({ signalSubscriptionId }: { signalSubscriptionId: string }) {
        this.log.info(`Syncing Signal Subscription #${signalSubscriptionId} robots`);
        const signalSubscription = await this.db.pg.one<SignalSubscriptionState>(sql`
        SELECT p.id, p.type, p.exchange, p.status, 
              p.signal_subscription_settings as settings,
              p.robots 
           FROM v_signal_subscriptions p
           WHERE p.id = ${signalSubscriptionId}; 
       `);
        if (signalSubscription.status !== "started") return;
        if (signalSubscription.settings && signalSubscription.robots && Array.isArray(signalSubscription.robots)) {
            try {
                await this.db.pg.transaction(async (t) => {
                    await t.query(sql`UPDATE signal_subscription_robots
            SET active = false
            WHERE signal_subscription_id = ${signalSubscription.id};
            `);

                    await t.query(sql`
            INSERT INTO signal_subscription_robots 
            (signal_subscription_id, robot_id, active, share)
            SELECT *
                FROM ${sql.unnest(
                    this.db.util.prepareUnnest(
                        signalSubscription.robots.map((r) => ({
                            signalSubscriptionId: signalSubscription.id,
                            robotId: r.robotId,
                            active: r.active,
                            share: r.share
                        })),
                        ["signalSubscriptionId", "robotId", "active", "share"]
                    ),
                    ["uuid", "uuid", "bool", "numeric"]
                )}
                ON CONFLICT ON CONSTRAINT signal_subscription_robots_signal_subscription_id_robot_id_key
                DO UPDATE SET active = excluded.active, share = excluded.share;
            `);

                    await t.query(sql`
            UPDATE signal_subscription_settings
            SET synced_at = ${dayjs.utc().toISOString()}
            WHERE signal_subscription_id = ${signalSubscriptionId}
            AND active = true;
            `);
                });
            } catch (error) {
                this.log.error(error);
                await this.events.emit<PortfolioManagerSignalSubscriptionBuildError>({
                    type: PortfolioManagerOutEvents.SIGNAL_SUBSCRIPTION_BUILD_ERROR,
                    data: {
                        signalSubscriptionId: signalSubscription.id,
                        error: error.message
                    }
                });
                return error.message;
            }
            this.log.info(
                `Added ${signalSubscription.robots.length} robots to Signal Subscription #${signalSubscriptionId}`
            );
        } else {
            this.log.warn(`Signal Subscription #${signalSubscription.id} has no active robots`);
        }
    }

    async handleSignalTradeEvents(signal: Signal) {
        if (signal.exchange !== "binance_futures") return;
        this.log.debug("Handling signal", signal);
        const { id, robotId, timestamp, emulated } = signal;
        if (emulated) return;
        const signalSubscriptionRobots = await this.db.pg.any<{
            id: SignalRobotDB["id"];
            signalSubscriptionId: SignalRobotDB["signalSubscriptionId"];
            robotId: SignalRobotDB["robotId"];
            active: SignalRobotDB["active"];
            share: SignalRobotDB["share"];
            state: SignalRobotDB["state"];
            exchange: SignalSubscriptionDB["exchange"];
            type: SignalSubscriptionDB["type"];
            url: SignalSubscriptionDB["url"];
            token: SignalSubscriptionDB["token"];
            settings: SignalSubscriptionState["settings"];
            currentPrice: number;
        }>(
            sql`
            SELECT ssr.id, 
            ssr.signal_subscription_id,
            ssr.robot_id,
            ssr.active,
            ssr.share,
            ssr.state,
            ss.exchange, 
            ss.type, 
            ss.url,
            ss.token,
            sss.signal_subscription_settings as settings,
            f_current_price(r.exchange, r.asset, r.currency) AS current_price
             FROM signal_subscription_robots ssr, signal_subscriptions ss, v_signal_subscription_settings sss, robots r
            WHERE ssr.robot_id = ${robotId}
             AND ssr.signal_subscription_id = ss.id
             AND ss.id = sss.signal_subscription_id
             AND ssr.robot_id = r.id
             AND ss.status = 'started'
             AND ((ssr.state->'latestSignal'->>'timestamp')::timestamp is null 
              OR (ssr.state->'latestSignal'->>'timestamp')::timestamp < ${timestamp})
              ORDER BY sss.active_from DESC LIMIT 1;
            `
        );

        this.log.info(`New signal #${id} from robot #${robotId} required by ${signalSubscriptionRobots.length}`);

        await Promise.all(
            signalSubscriptionRobots.map(async (r) => {
                await this.redlock.using([`signalSub-${r.id}`], 5000, async (redlockSignal) => {
                    try {
                        if (redlockSignal.aborted) {
                            throw redlockSignal.error;
                        }
                        const robot = new SignalSubscriptionRobot(r);

                        const openPositions = await this.db.pg.any<SignalSubscriptionPosition>(sql`
                SELECT * 
                FROM  signal_subscription_positions
                WHERE signal_subscription_id = ${r.signalSubscriptionId}
                AND subscription_robot_id = ${r.id}
                AND status = 'open';
                `);

                        robot.handleOpenPositions([...openPositions]);
                        await robot.handleSignal(signal);

                        await this.db.pg.transaction(async (t) => {
                            if (robot.positionsToSave.length) {
                                this.log.debug(`Saving robots #${r.id} positions`);
                                for (const pos of robot.positionsToSave) {
                                    await t.query(sql`
                    INSERT INTO signal_subscription_positions
                    (id, signal_subscription_id, subscription_robot_id, robot_id, 
                    exchange, asset, currency, leverage, direction, 
                    entry_price, entry_date, entry_order_type, 
                    exit_price, exit_date, exit_order_type,
                    share, status, error
                    ) VALUES (
                       ${pos.id}, ${pos.signalSubscriptionId}, ${pos.subscriptionRobotId}, ${pos.robotId},
                       ${pos.exchange}, ${pos.asset}, ${pos.currency}, ${pos.leverage}, ${pos.direction},
                       ${pos.entryPrice || null}, ${pos.entryDate || null}, ${pos.entryOrderType || null},
                       ${pos.exitPrice || null}, ${pos.exitDate || null}, ${pos.exitOrderType || null},
                       ${pos.share}, ${pos.status}, ${pos.error || null} 
                    )
                    ON CONFLICT ON CONSTRAINT signal_subscription_positions_pkey
                    DO UPDATE SET exit_price = excluded.exit_price,
                    exit_date = excluded.exit_date,
                    exit_order_type = excluded.exit_order_type,
                    status = excluded.status,
                    error = excluded.error;
                    `);
                                }
                            }

                            await t.query(sql`
                        UPDATE signal_subscription_robots 
                        SET state = ${JSON.stringify(robot.state)}
                        WHERE id = ${r.id};
                        `);
                        });
                    } catch (err) {
                        this.log.error(`Failed to handle signal ${err.message}`);
                        await this.events.emit<PortfolioManagerSignalSubscriptionError>({
                            type: PortfolioManagerOutEvents.SIGNAL_SUBSCRIPTION_ERROR,
                            data: {
                                signalSubscriptionId: r.signalSubscriptionId,
                                error: err.message,
                                data: signal
                            }
                        });
                    }
                });
            })
        );
    }
}
