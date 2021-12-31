import { sql } from "@cryptuoso/postgres";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { Webhook } from "coinbase-commerce-node";
import { UserSubCheckPayment, UserSubInEvents } from "@cryptuoso/user-sub-events";
import { UserRoles } from "@cryptuoso/user-state";
import {
    calcUserLeverage,
    getPortfolioBalance,
    PortfolioRobotDB,
    PortfolioSettings,
    SignalSubcriptionDB,
    SignalSubscriptionState
} from "@cryptuoso/portfolio-state";
import { v4 as uuid } from "uuid";
import dayjs from "@cryptuoso/dayjs";
import { equals, nvl } from "@cryptuoso/helpers";

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
                        tradingAmountType: { type: "string" },
                        balancePercent: { type: "number", integer: true, positive: true, optional: true },
                        tradingAmountCurrency: { type: "number", positive: true, optional: true },
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
                        url: { type: "url", optional: true },
                        token: { type: "string", optional: true },
                        tradingAmountType: { type: "string", optional: true },
                        balancePercent: { type: "number", integer: true, positive: true, optional: true },
                        tradingAmountCurrency: { type: "number", positive: true, optional: true },
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
        tradingAmountType,
        balancePercent,
        tradingAmountCurrency,
        leverage,
        options,
        url,
        token
    }: PortfolioSettings & {
        exchange: SignalSubcriptionDB["exchange"];
        type: SignalSubcriptionDB["type"];
        url: SignalSubcriptionDB["url"];
        token: SignalSubcriptionDB["token"];
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

        const signalSubscription: SignalSubcriptionDB = {
            id: uuid(),
            exchange,
            type,
            status: "stopped",
            url,
            token
        };

        const signalSubscriptionSettings: PortfolioSettings = {
            options,
            tradingAmountType,
            balancePercent,
            tradingAmountCurrency,
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
        tradingAmountType,
        balancePercent,
        tradingAmountCurrency,
        leverage,
        options,
        url,
        token
    }: PortfolioSettings & {
        signalSubscriptionId: SignalSubcriptionDB["id"];
        url: SignalSubcriptionDB["url"];
        token: SignalSubcriptionDB["token"];
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

        if (tradingAmountType) {
            let initialBalance = signalSubscription.settings.initialBalance;

            const portfolioBalance = getPortfolioBalance(
                initialBalance,
                tradingAmountType,
                balancePercent,
                tradingAmountCurrency
            );

            const {
                limits: { recommendedBalance },
                settings: { leverage: defaultLeverage },
                maxLeverage
            } = await this.db.pg.one<{
                limits: {
                    recommendedBalance: number;
                };
                settings: PortfolioSettings;
                maxLeverage: number;
            }>(sql`
    SELECT p.limits, p.settings, e.max_leverage from v_portfolios p, exchanges e where 
    e.code = ${signalSubscription.exchange}
    and p.id = ${portfolioId};
    `);

            const signalSubscriptionLeverage =
                leverage || calcUserLeverage(recommendedBalance, defaultLeverage, maxLeverage, portfolioBalance);
        }

        const signalSubscriptionSettings: PortfolioSettings = {
            ...signalSubscription.settings,
            options: newOptions,
            tradingAmountType: nvl(tradingAmountType, signalSubscription.settings.tradingAmountType),
            balancePercent: nvl(balancePercent, signalSubscription.settings.balancePercent),
            tradingAmountCurrency: nvl(tradingAmountCurrency, signalSubscription.settings.tradingAmountCurrency)
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
        const { status } = await this.db.pg.one<{ status: SignalSubcriptionDB["status"] }>(sql`
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
        const { status } = await this.db.pg.one<{ status: SignalSubcriptionDB["status"] }>(sql`
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
        const { status } = await this.db.pg.one<{ status: SignalSubcriptionDB["status"] }>(sql`
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
}
