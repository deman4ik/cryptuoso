import { spawn, Worker as ThreadsWorker, Thread } from "threads";
import { Job } from "bullmq";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { PortfolioWorker } from "./worker";
import {
    getPortfolioBalance,
    getPortfolioMinBalance,
    PortfolioBuilderJob,
    PortfolioContext,
    PortfolioDB,
    PortfolioOptions,
    PortfolioSettings,
    UserPortfolioDB,
    UserPortfolioBuilderJob,
    UserPortfolioState,
    calcUserLeverage,
    PortfolioRobotDB
} from "@cryptuoso/portfolio-state";
import { User, UserExchangeAccountInfo, UserExchangeAccStatus, UserRoles } from "@cryptuoso/user-state";
import { v4 as uuid } from "uuid";
import combinate from "combinate";
import { sql } from "@cryptuoso/postgres";
import { capitalize, equals, formatExchange, nvl } from "@cryptuoso/helpers";
import dayjs from "@cryptuoso/dayjs";
import { ActionsHandlerError, BaseError } from "@cryptuoso/errors";
import { UserSub } from "@cryptuoso/billing";
import {
    PortfolioManagerInSchema,
    PortfolioManagerInEvents,
    PortfolioManagerBuildPortfolio,
    PotrfolioManagerBuildPortfolios,
    PortfolioManagerBuildUserPortfolio,
    PortfolioManagerPortfolioBuildError,
    PortfolioManagerOutEvents,
    PortfolioManagerUserPortfolioBuildError,
    PortfolioManagerPortfolioBuilded,
    PortfolioManagerUserPortfolioBuilded,
    PotrfolioManagerRebuildPortfolios
} from "@cryptuoso/portfolio-events";
import { Timeframe } from "@cryptuoso/market";

export type PortfolioManagerServiceConfig = HTTPServiceConfig;

export default class PortfolioManagerService extends HTTPService {
    constructor(config?: PortfolioManagerServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                initPortfolios: {
                    inputSchema: {
                        exchange: "string",
                        tradingAmountType: { type: "string", default: "balancePercent" },
                        balancePercent: { type: "number", integer: true, optional: true, default: 100 },
                        tradingAmountCurrency: { type: "number", integer: true, optional: true },
                        initialBalance: {
                            type: "number",
                            optional: true,
                            default: 10000
                        },
                        leverage: { type: "number", optional: true, integer: true, default: 2 },
                        minRobotsCount: { type: "number", optional: true, integer: true, default: 20 },
                        maxRobotsCount: { type: "number", optional: true, integer: true },
                        dateFrom: { type: "string" }
                    },
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.initPortfolios.bind(this))
                },
                buildPortfolio: {
                    inputSchema: PortfolioManagerInSchema[PortfolioManagerInEvents.BUILD_PORTFOLIO],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.buildPortfolio.bind(this))
                },
                buildPortfolios: {
                    inputSchema: PortfolioManagerInSchema[PortfolioManagerInEvents.BUILD_PORTFOLIOS],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.buildPortfolios.bind(this))
                },
                rebuildPortfolios: {
                    inputSchema: PortfolioManagerInSchema[PortfolioManagerInEvents.REBUILD_PORTFOLIOS],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.rebuildPortfolios.bind(this))
                },
                createUserPortfolio: {
                    inputSchema: {
                        exchange: "string",
                        type: { type: "enum", values: ["shared", "dedicated"], optional: true, default: "shared" },
                        userExAccId: { type: "uuid" },
                        tradingAmountType: { type: "string" },
                        balancePercent: { type: "number", optional: true },
                        tradingAmountCurrency: { type: "number", optional: true },
                        leverage: { type: "number", optional: true, integer: true, default: 2 },
                        minRobotsCount: { type: "number", optional: true, integer: true, default: 5 },
                        maxRobotsCount: { type: "number", optional: true, integer: true },
                        includeTimeframes: { type: "array", enum: Timeframe.validArray, optional: true },
                        excludeTimeframes: { type: "array", enum: Timeframe.validArray, optional: true },
                        includeAssets: { type: "array", items: "string", optional: true },
                        excludeAssets: { type: "array", items: "string", optional: true },
                        options: {
                            type: "object",
                            props: {
                                profit: "boolean",
                                risk: "boolean",
                                moneyManagement: "boolean",
                                winRate: "boolean",
                                efficiency: "boolean"
                            }
                        },
                        custom: { type: "boolean", optional: true, default: false }
                    },
                    auth: true,
                    roles: [UserRoles.admin, UserRoles.manager, UserRoles.user, UserRoles.vip],
                    handler: this.HTTPWithAuthHandler.bind(this, this.createUserPortfolio.bind(this))
                },
                editUserPortfolio: {
                    inputSchema: {
                        userPortfolioId: { type: "uuid", optional: true },
                        tradingAmountType: { type: "string", optional: true },
                        balancePercent: { type: "number", optional: true },
                        tradingAmountCurrency: { type: "number", optional: true },
                        leverage: { type: "number", optional: true, integer: true },
                        minRobotsCount: { type: "number", optional: true, integer: true },
                        maxRobotsCount: { type: "number", optional: true, integer: true },
                        includeAssets: { type: "array", items: "string", optional: true },
                        excludeAssets: { type: "array", items: "string", optional: true },
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
                        },
                        custom: { type: "boolean", optional: true }
                    },
                    auth: true,
                    roles: [UserRoles.admin, UserRoles.manager, UserRoles.user, UserRoles.vip],
                    handler: this.HTTPWithAuthHandler.bind(this, this.editUserPortfolio.bind(this))
                },
                deleteUserPortfolio: {
                    inputSchema: {
                        userPortfolioId: { type: "uuid", optional: true }
                    },
                    auth: true,
                    roles: [UserRoles.admin, UserRoles.manager, UserRoles.user, UserRoles.vip],
                    handler: this.HTTPWithAuthHandler.bind(this, this.deleteUserPortfolio.bind(this))
                },
                buildUserPortfolio: {
                    inputSchema: PortfolioManagerInSchema[PortfolioManagerInEvents.BUILD_USER_PORTFOLIO],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.buildUserPortfolio.bind(this))
                },
                buildUserPortfolios: {
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.buildUserPortfolios.bind(this))
                }
            });
            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error("Error while constructing PortfolioManagerService", err);
        }
    }

    async onServiceStart(): Promise<void> {
        this.createQueue("portfolioBuilder");
        this.createWorker("portfolioBuilder", this.process);
        await this.addJob("portfolioBuilder", "userPortfolioCheck", null, {
            jobId: "userPortfolioCheck",
            repeat: {
                cron: "0 0 */12 * * *"
            },
            attempts: 3,
            backoff: { type: "exponential", delay: 60000 },
            removeOnComplete: 1,
            removeOnFail: 10
        });
    }

    generateOptions() {
        const values = {
            //diversification: [true, false],
            profit: [true, false],
            risk: [true, false],
            moneyManagement: [true, false],
            winRate: [true, false],
            efficiency: [true, false]
        };

        return combinate(values).slice(0, -1);
    }

    generateCode(options: PortfolioOptions) {
        return Object.entries(options)
            .filter(([, value]) => value)
            .map(([key]) => key)
            .sort()
            .join("+");
    }

    generateName(options: PortfolioOptions) {
        return Object.entries(options)
            .filter(([, value]) => value)
            .map(([key]) => capitalize(key))
            .sort()
            .join(" ");
    }

    async initPortfolios({
        exchange,
        tradingAmountType,
        balancePercent,
        tradingAmountCurrency,
        initialBalance,
        leverage,
        maxRobotsCount,
        minRobotsCount,
        dateFrom
    }: {
        exchange: string;
        tradingAmountType: PortfolioSettings["tradingAmountType"];
        balancePercent: PortfolioSettings["balancePercent"];
        tradingAmountCurrency: PortfolioSettings["tradingAmountCurrency"];
        initialBalance: PortfolioSettings["initialBalance"];
        leverage: PortfolioSettings["leverage"];
        maxRobotsCount?: PortfolioSettings["maxRobotsCount"];
        minRobotsCount?: PortfolioSettings["minRobotsCount"];
        dateFrom?: PortfolioSettings["dateFrom"];
    }) {
        const allOptions = this.generateOptions();
        const { minTradeAmount } = await this.db.pg.one<{ minTradeAmount: PortfolioContext["minTradeAmount"] }>(sql`
        SELECT max(m.min_amount_currency) as min_trade_amount from v_markets m
        WHERE m.exchange = ${exchange}
        GROUP BY m.exchange;
        `);
        const portfolioBalance = getPortfolioBalance(
            initialBalance,
            tradingAmountType,
            balancePercent,
            tradingAmountCurrency
        );
        getPortfolioMinBalance(portfolioBalance, minTradeAmount, minRobotsCount, leverage);
        const allPortfolios: PortfolioDB[] = allOptions.map<PortfolioDB>((options) => ({
            id: uuid(),
            code: `${exchange}:${this.generateCode(options)}`,
            name: `${formatExchange(exchange)} ${this.generateName(options)}`,
            exchange,
            available: 5,
            status: "stopped",
            base: true,
            settings: {
                options,
                tradingAmountType,
                balancePercent,
                tradingAmountCurrency,
                initialBalance,
                leverage,
                maxRobotsCount,
                minRobotsCount,
                dateFrom,
                excludeTimeframes: [1]
            }
        }));
        await this.db.pg.query(sql`
                insert into portfolios
                (id, code, name, exchange, available, status, base, settings)
                SELECT *
                FROM ${sql.unnest(
                    this.db.util.prepareUnnest(
                        allPortfolios.map((p) => ({ ...p, settings: JSON.stringify(p.settings) })),
                        ["id", "code", "name", "exchange", "available", "status", "base", "settings"]
                    ),
                    ["uuid", "varchar", "varchar", "varchar", "int8", "varchar", "bool", "jsonb"]
                )}
                ON CONFLICT ON CONSTRAINT portfolios_code_key
                DO UPDATE SET settings = excluded.settings;`);
        this.log.info(`Inited ${allPortfolios.length} ${exchange} portfolios`);
    }

    async createUserPortfolio(
        {
            exchange,
            type,
            userExAccId,
            tradingAmountType,
            balancePercent,
            tradingAmountCurrency,
            leverage,
            maxRobotsCount,
            minRobotsCount,
            includeTimeframes,
            excludeTimeframes,
            includeAssets,
            excludeAssets,
            options,
            custom
        }: PortfolioSettings & {
            exchange: UserPortfolioDB["exchange"];
            type: UserPortfolioDB["type"];
            userExAccId: UserPortfolioDB["userExAccId"];
            custom: boolean;
        },
        user: User
    ) {
        const { id: userId } = user;
        const userPortfolioExists = await this.db.pg.maybeOne<{ id: UserPortfolioDB["id"] }>(sql`
         SELECT p.id
            FROM user_portfolios p
            WHERE p.user_id = ${userId}; 
        `);

        if (userPortfolioExists) throw new Error("User portfolio already exists");

        const oldUserRobots = await this.db.pg.oneFirst<number>(sql`
        SELECT COUNT(1)
        FROM user_robots
        WHERE user_id = ${userId};
        `);

        if (oldUserRobots > 0) {
            throw new Error("You still have started robots");
        }

        const userExAcc = await this.db.pg.maybeOne<{
            exchange: UserExchangeAccountInfo["exchange"];
            status: UserExchangeAccountInfo["status"];
            balance: UserExchangeAccountInfo["balance"];
        }>(sql`
            SELECT exchange, status, ((ea.balances ->> 'totalUSD'::text))::numeric as balance
            FROM user_exchange_accs ea
            WHERE ea.id = ${userExAccId};
            `);
        if (!userExAcc) throw new Error("Exchange account not found");
        if (userExAcc.exchange !== exchange) throw new Error("Wrong exchange");
        if (userExAcc.status !== UserExchangeAccStatus.enabled)
            throw new ActionsHandlerError(
                `Something went wrong with your ${formatExchange(
                    userExAcc.exchange
                )} Exchange Account. Please check and update your exchange API keys.`,
                null,
                "FORBIDDEN",
                403
            );
        const initialBalance = userExAcc.balance;

        const userSub = await this.db.pg.maybeOne<{ id: UserSub["id"] }>(sql`
            SELECT id 
            FROM user_subs
            WHERE user_id = ${userId}
            AND status in (${"active"},${"trial"});
            `);

        if (!userSub)
            throw new ActionsHandlerError(`Your Cryptuoso Subscription is not Active.`, null, "FORBIDDEN", 403);

        const portfolioBalance = getPortfolioBalance(
            initialBalance,
            tradingAmountType,
            balancePercent,
            tradingAmountCurrency
        );

        let robots: PortfolioRobotDB[];
        if (!custom) {
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
        SELECT p.id as portfolio_id, p.limits, p.settings, e.max_leverage from v_portfolios p, exchanges e where 
        e.code = ${exchange}
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
            robots = [...portfolioRobots];

            leverage = calcUserLeverage(recommendedBalance, defaultLeverage, maxLeverage, portfolioBalance);
        }

        const userPortfolio: UserPortfolioDB = {
            id: uuid(),
            userId,
            userExAccId,
            exchange,
            type,
            status: "starting"
        };

        const userPortfolioSettings: PortfolioSettings = {
            options,
            tradingAmountType,
            balancePercent,
            tradingAmountCurrency,
            initialBalance,
            leverage,
            minRobotsCount,
            maxRobotsCount,
            custom
        };

        if (custom) {
            userPortfolioSettings.includeAssets = includeAssets;
            userPortfolioSettings.excludeAssets = excludeAssets;
            userPortfolioSettings.includeTimeframes = includeTimeframes;
            userPortfolioSettings.excludeTimeframes = excludeTimeframes;
        }

        await this.db.pg.transaction(async (t) => {
            await t.query(sql`
        insert into user_portfolios
        (id, user_id, user_ex_acc_id, exchange, status)
        VALUES (${userPortfolio.id},
        ${userPortfolio.userId},
        ${userPortfolio.userExAccId || null}, 
        ${userPortfolio.exchange},
        ${userPortfolio.status}
        );`);

            await t.query(sql`
                insert into user_portfolio_settings (user_portfolio_id, active_from, user_portfolio_settings, robots, active)
                values (${userPortfolio.id}, ${dayjs.utc().toISOString()}, ${JSON.stringify(
                userPortfolioSettings
            )}, ${JSON.stringify(robots)}, ${true}); 
                `);
        });

        await this.events.emit<PortfolioManagerUserPortfolioBuilded>({
            type: PortfolioManagerOutEvents.USER_PORTFOLIO_BUILDED,
            data: {
                userPortfolioId: userPortfolio.id
            }
        });

        return { result: userPortfolio.id };
    }

    async editUserPortfolio(
        {
            userPortfolioId,
            tradingAmountType,
            balancePercent,
            tradingAmountCurrency,
            leverage,
            maxRobotsCount,
            minRobotsCount,
            includeTimeframes,
            excludeTimeframes,
            includeAssets,
            excludeAssets,
            options
        }: {
            userPortfolioId: UserPortfolioDB["id"];
            tradingAmountType?: PortfolioSettings["tradingAmountType"];
            balancePercent?: PortfolioSettings["balancePercent"];
            tradingAmountCurrency?: PortfolioSettings["tradingAmountCurrency"];
            leverage?: PortfolioSettings["leverage"];
            maxRobotsCount?: PortfolioSettings["maxRobotsCount"];
            minRobotsCount?: PortfolioSettings["minRobotsCount"];
            includeTimeframes?: PortfolioSettings["includeTimeframes"];
            excludeTimeframes?: PortfolioSettings["excludeTimeframes"];
            includeAssets?: PortfolioSettings["includeAssets"];
            excludeAssets?: PortfolioSettings["excludeAssets"];
            options?: PortfolioSettings["options"];
        },
        user: User
    ) {
        await this.redlock.using([`userPortfolioEdit:${userPortfolioId}`], 5000, async (signal) => {
            if (signal.aborted) {
                throw signal.error;
            }

            const userPortfolio = await this.db.pg.one<UserPortfolioState>(sql`
        SELECT p.id, p.type, p.user_id, p.user_ex_acc_id, p.exchange, p.status, 
              ups.id as user_portfolio_settings_id, 
              ups.active_from as user_portfolio_settings_active_from,
              ups.user_portfolio_settings as settings,
                  json_build_object('minTradeAmount', m.min_trade_amount,
                                    'feeRate', m.fee_rate,
                                    'currentBalance', ((ea.balances ->> 'totalUSD'::text))::numeric) as context
           FROM user_portfolios p, user_portfolio_settings ups, user_exchange_accs ea,
                (SELECT mk.exchange, 
                        max(mk.min_amount_currency) as min_trade_amount, 
                        max(mk.fee_rate) as fee_rate 
                 FROM v_markets mk
                 GROUP BY mk.exchange) m
           WHERE p.exchange = m.exchange
             AND ea.id = p.user_ex_acc_id
             AND ups.user_portfolio_id = p.id
             AND (ups.active = true OR ups.active_from is null)
             AND p.id = ${userPortfolioId}
             ORDER BY ups.active_from DESC NULLS FIRST LIMIT 1; 
       `);

            const custom = userPortfolio.settings.custom;
            if (userPortfolio.userId !== user.id)
                throw new ActionsHandlerError(
                    "Current user isn't owner of this User Portfolio",
                    { userPortfolioId: userPortfolio.id },
                    "FORBIDDEN",
                    403
                );

            const newOptions = { ...userPortfolio.settings.options, ...options };
            let portfolioId;
            let robots: PortfolioRobotDB[];
            if (!custom) {
                ({ portfolioId } = await this.db.pg.one<{
                    portfolioId: string;
                }>(sql`
        SELECT  p.id as portfolio_id from v_portfolios p where
        p.exchange = ${userPortfolio.exchange} 
        AND p.base = true
        AND p.status = 'started'
        AND p.option_risk = ${newOptions.risk}
        AND p.option_profit = ${newOptions.profit}
        AND p.option_win_rate = ${newOptions.winRate}
        AND p.option_efficiency = ${newOptions.efficiency}
        AND p.option_money_management = ${newOptions.moneyManagement};
        `));

                const portfolioRobots = await this.db.pg.any<PortfolioRobotDB>(sql`
        SELECT robot_id, active, share, priority
        FROM portfolio_robots
        WHERE portfolio_id = ${portfolioId}
        AND active = true;`);
                robots = [...portfolioRobots];
            }

            if (tradingAmountType) {
                let initialBalance = userPortfolio.settings.initialBalance;

                const userExAcc = await this.db.pg.maybeOne<{
                    exchange: UserExchangeAccountInfo["exchange"];
                    balance: UserExchangeAccountInfo["balance"];
                }>(sql`
                SELECT exchange, ((ea.balances ->> 'totalUSD'::text))::numeric as balance
                FROM user_exchange_accs ea
                WHERE ea.id = ${userPortfolio.userExAccId};
                `);
                initialBalance = userExAcc.balance;

                const portfolioBalance = getPortfolioBalance(
                    initialBalance,
                    tradingAmountType,
                    balancePercent,
                    tradingAmountCurrency
                );

                if (!custom) {
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
            e.code = ${userPortfolio.exchange}
            and p.id = ${portfolioId};
            `);

                    leverage = calcUserLeverage(recommendedBalance, defaultLeverage, maxLeverage, portfolioBalance);
                }
            }

            const userPortfolioSettings: PortfolioSettings = {
                ...userPortfolio.settings,
                options: newOptions,
                tradingAmountType: nvl(tradingAmountType, userPortfolio.settings.tradingAmountType),
                balancePercent: nvl(balancePercent, userPortfolio.settings.balancePercent),
                tradingAmountCurrency: nvl(tradingAmountCurrency, userPortfolio.settings.tradingAmountCurrency)
            };

            if (custom) {
                userPortfolioSettings.leverage = leverage ?? userPortfolioSettings.leverage;
                userPortfolioSettings.maxRobotsCount = maxRobotsCount ?? userPortfolioSettings.maxRobotsCount;
                userPortfolioSettings.minRobotsCount = minRobotsCount ?? userPortfolioSettings.minRobotsCount;
                userPortfolioSettings.includeAssets = includeAssets ?? userPortfolioSettings.includeAssets;
                userPortfolioSettings.excludeAssets = excludeAssets ?? userPortfolioSettings.excludeAssets;
                userPortfolioSettings.includeTimeframes = includeTimeframes ?? userPortfolioSettings.includeTimeframes;
                userPortfolioSettings.excludeTimeframes = excludeTimeframes ?? userPortfolioSettings.excludeTimeframes;
            }

            if (!equals(userPortfolioSettings, userPortfolio.settings)) {
                await this.db.pg.transaction(async (t) => {
                    if (!custom) {
                        await t.query(sql`UPDATE user_portfolio_settings 
                    SET active = ${false}
                    WHERE user_portfolio_id = ${userPortfolio.id};
                    `);
                        await t.query(sql`
                    insert into user_portfolio_settings (user_portfolio_id, active_from, user_portfolio_settings, robots, active)
                    values (${userPortfolio.id}, ${dayjs.utc().toISOString()}, ${JSON.stringify(
                            userPortfolioSettings
                        )}, ${JSON.stringify(robots) || null}, ${true}); 
                    `);
                    } else {
                        const settingsExists = await t.maybeOne(sql`
                        SELECT id 
                        FROM user_portfolio_settings 
                        WHERE user_portfolio_id = ${userPortfolio.id}
                        AND active_from is null;
            `);

                        if (settingsExists) {
                            await t.query(sql`
                        UPDATE user_portfolio_settings 
                        set user_portfolio_settings = ${JSON.stringify(userPortfolioSettings)}
                        WHERE id = ${settingsExists.id};
                `);
                        } else {
                            await t.query(sql`
                INSERT INTO user_portfolio_settings (user_portfolio_id, active_from, user_portfolio_settings)
                VALUES(${userPortfolio.id}, ${null}, ${JSON.stringify(userPortfolioSettings)} );`);
                        }
                    }
                });
            }

            if (!custom) {
                await this.events.emit<PortfolioManagerUserPortfolioBuilded>({
                    type: PortfolioManagerOutEvents.USER_PORTFOLIO_BUILDED,
                    data: {
                        userPortfolioId: userPortfolio.id
                    }
                });
            } else {
                await this.buildUserPortfolio({ userPortfolioId: userPortfolio.id });
            }
        });
    }

    async deleteUserPortfolio(
        {
            userPortfolioId
        }: {
            userPortfolioId: UserPortfolioDB["id"];
        },
        user: User
    ) {
        const userPortfolio = await this.db.pg.one<{
            id: UserPortfolioDB["id"];

            userId: UserPortfolioDB["userId"];
            status: UserPortfolioDB["status"];
        }>(sql`
        SELECT p.id, p.user_id, p.status
           FROM user_portfolios p
           WHERE p.id = ${userPortfolioId}; 
       `);

        if (userPortfolio.userId !== user.id)
            throw new ActionsHandlerError(
                "Current user isn't owner of this User Portfolio",
                { userPortfolioId: userPortfolio.id },
                "FORBIDDEN",
                403
            );

        if (userPortfolio.status === "started") {
            throw new BaseError("User portfolio must be stopped before deleting", {
                userPortfolioId,
                status: userPortfolio.status
            });
        }

        await this.db.pg.query(sql`
       DELETE FROM user_portfolios WHERE id = ${userPortfolioId};
       `);
    }

    async buildPortfolio({ portfolioId, saveSteps }: PortfolioManagerBuildPortfolio) {
        await this.db.pg.one<{ id: PortfolioDB["id"] }>(sql`
        SELECT id FROM portfolios where id = ${portfolioId};
        `);
        await this.addJob<PortfolioBuilderJob>(
            "portfolioBuilder",
            "build",
            { portfolioId, type: "portfolio", saveSteps },
            {
                jobId: portfolioId,
                removeOnComplete: true,
                removeOnFail: 10
            }
        );
    }

    async buildPortfolios({ exchange }: PotrfolioManagerBuildPortfolios) {
        const portfolios = await this.db.pg.any<{ id: PortfolioDB["id"] }>(sql`
        SELECT id FROM portfolios where exchange = ${exchange} and status = 'stopped';
        `);
        if (!portfolios || !Array.isArray(portfolios) || !portfolios.length) return { result: "No stopped portfolios" };
        for (const { id } of portfolios) {
            await this.addJob<PortfolioBuilderJob>(
                "portfolioBuilder",
                "build",
                { portfolioId: id, type: "portfolio" },
                {
                    jobId: id,
                    removeOnComplete: true,
                    removeOnFail: 10
                }
            );
        }
    }

    async rebuildPortfolios({ exchange, checkDate }: PotrfolioManagerRebuildPortfolios) {
        const dateCondition = checkDate
            ? sql`and (builded_at is null OR builded_at < ${dayjs.utc().startOf("day").add(-1, "month").toISOString()})`
            : sql``;
        const portfolios = await this.db.pg.any<{ id: PortfolioDB["id"] }>(sql`
        SELECT id FROM portfolios where exchange = ${exchange} 
        and status = 'started' 
        ${dateCondition}
        ;
        `);
        if (!portfolios || !Array.isArray(portfolios) || !portfolios.length) return { result: "No portfolios" };
        for (const { id } of portfolios) {
            await this.addJob<PortfolioBuilderJob>(
                "portfolioBuilder",
                "build",
                { portfolioId: id, type: "portfolio" },
                {
                    jobId: id,
                    removeOnComplete: true,
                    removeOnFail: 10
                }
            );
        }
    }

    async buildUserPortfolio({ userPortfolioId }: PortfolioManagerBuildUserPortfolio) {
        await this.db.pg.one<{ id: UserPortfolioDB["id"] }>(sql`
        SELECT id FROM user_portfolios where id = ${userPortfolioId};
        `);
        await this.addJob<UserPortfolioBuilderJob>(
            "portfolioBuilder",
            "build",
            { userPortfolioId, type: "userPortfolio" },
            {
                jobId: userPortfolioId,
                removeOnComplete: true,
                removeOnFail: 10
            }
        );
    }

    async buildUserPortfolios() {
        const userPortfolios = await this.db.pg.any<{ id: UserPortfolioDB["id"] }>(sql`
        SELECT id FROM user_portfolios where status = ${"started"};
        `);
        if (!userPortfolios || !Array.isArray(userPortfolios) || !userPortfolios.length)
            return { result: "No active user portfolios" };
        for (const { id } of userPortfolios) {
            await this.addJob<UserPortfolioBuilderJob>(
                "portfolioBuilder",
                "build",
                { userPortfolioId: id, type: "userPortfolio" },
                {
                    jobId: id,
                    removeOnComplete: true,
                    removeOnFail: 10
                }
            );
        }
    }
    async process(job: Job) {
        if (job.name === "userPortfolioCheck") {
            await this.userPortfolioSettingsCheck();
        } else if (job.name === "build") {
            await this.portfolioBuilderProcess(job);
        } else {
            this.log.error(`Unknown job ${job.name}`);
        }
    }

    async userPortfolioSettingsCheck() {
        return;
    }

    async portfolioBuilderProcess(job: Job<PortfolioBuilderJob | UserPortfolioBuilderJob, boolean>) {
        try {
            const beacon = this.lightship.createBeacon();

            const portfolioWorker = await spawn<PortfolioWorker>(new ThreadsWorker("./worker"));

            try {
                if (job.data.type === "portfolio") {
                    portfolioWorker.progress().subscribe(async (progress: number) => {
                        this.log.info(
                            `Portfolio #${(job.data as PortfolioBuilderJob).portfolioId} build progress - ${progress}%`
                        );
                        await job.updateProgress(progress);
                    });
                    await portfolioWorker.buildPortfolio(job.data);
                    await this.events.emit<PortfolioManagerPortfolioBuilded>({
                        type: PortfolioManagerOutEvents.PORTFOLIO_BUILDED,
                        data: {
                            portfolioId: job.data.portfolioId
                        }
                    });
                } else if (job.data.type === "userPortfolio") {
                    portfolioWorker.progress().subscribe(async (progress: number) => {
                        this.log.info(
                            `Portfolio #${
                                (job.data as UserPortfolioBuilderJob).userPortfolioId
                            } build progress - ${progress}%`
                        );
                        await job.updateProgress(progress);
                    });
                    await portfolioWorker.buildUserPortfolio(job.data);
                    await this.events.emit<PortfolioManagerUserPortfolioBuilded>({
                        type: PortfolioManagerOutEvents.USER_PORTFOLIO_BUILDED,
                        data: {
                            userPortfolioId: job.data.userPortfolioId
                        }
                    });
                } else throw new Error("Unsupported job type");
                this.log.info(`Job ${job.id} processed`);
            } finally {
                await Thread.terminate(portfolioWorker);
                await beacon.die();
            }
        } catch (error) {
            this.log.error(error);
            if (job?.data?.type === "portfolio") {
                await this.events.emit<PortfolioManagerPortfolioBuildError>({
                    type: PortfolioManagerOutEvents.PORTFOLIO_BUILD_ERROR,
                    data: {
                        portfolioId: job.data.portfolioId,
                        error: error.message
                    }
                });
            } else if (job?.data?.type === "userPortfolio") {
                await this.events.emit<PortfolioManagerUserPortfolioBuildError>({
                    type: PortfolioManagerOutEvents.USER_PORTFOLIO_BUILD_ERROR,
                    data: {
                        userPortfolioId: job.data.userPortfolioId,
                        error: error.message
                    }
                });
            }
        }
    }
}
