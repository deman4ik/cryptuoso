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
    UserPortfolioState
} from "@cryptuoso/portfolio-state";
import { User, UserExchangeAccountInfo, UserRoles } from "@cryptuoso/user-state";
import { v4 as uuid } from "uuid";
import combinate from "combinate";
import { sql } from "@cryptuoso/postgres";
import { capitalize, equals, nvl } from "@cryptuoso/helpers";
import dayjs from "@cryptuoso/dayjs";
import { ActionsHandlerError, BaseError } from "@cryptuoso/errors";
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
    PortfolioManagerUserPortfolioBuilded
} from "@cryptuoso/portfolio-events";
import { UserRobotStatus } from "@cryptuoso/user-robot-state";
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
                            default: 100000
                        },
                        leverage: { type: "number", optional: true, integer: true, default: 5 },
                        minRobotsCount: { type: "number", optional: true, integer: true, default: 20 },
                        maxRobotsCount: { type: "number", optional: true, integer: true }
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
                createUserPortfolio: {
                    inputSchema: {
                        exchange: "string",
                        type: { type: "enum", values: ["signals", "trading"] },
                        userExAccId: { type: "uuid", optional: true },
                        tradingAmountType: { type: "string" },
                        balancePercent: { type: "number", optional: true },
                        tradingAmountCurrency: { type: "number", optional: true },
                        initialBalance: {
                            type: "number",
                            optional: true
                        },
                        leverage: { type: "number", optional: true, integer: true, default: 3 },
                        minRobotsCount: { type: "number", optional: true, integer: true },
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
                        }
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
        this.createWorker("portfolioBuilder", this.portfolioBuilderProcess);
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
        minRobotsCount
    }: {
        exchange: string;
        tradingAmountType: PortfolioSettings["tradingAmountType"];
        balancePercent: PortfolioSettings["balancePercent"];
        tradingAmountCurrency: PortfolioSettings["tradingAmountCurrency"];
        initialBalance: PortfolioSettings["initialBalance"];
        leverage: PortfolioSettings["leverage"];
        maxRobotsCount?: PortfolioSettings["leverage"];
        minRobotsCount?: PortfolioSettings["leverage"];
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
        getPortfolioMinBalance(portfolioBalance, minTradeAmount, minRobotsCount);
        const allPortfolios: PortfolioDB[] = allOptions.map<PortfolioDB>((options) => ({
            id: uuid(),
            code: `${exchange}:${this.generateCode(options)}`,
            name: `${exchange} ${this.generateName(options)}`,
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
                minRobotsCount
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
            type,
            exchange,
            userExAccId,
            tradingAmountType,
            balancePercent,
            tradingAmountCurrency,
            initialBalance: userInitialBalance,
            leverage,
            maxRobotsCount,
            minRobotsCount,
            includeTimeframes,
            excludeTimeframes,
            includeAssets,
            excludeAssets,
            options
        }: PortfolioSettings & {
            exchange: UserPortfolioDB["exchange"];
            type: UserPortfolioDB["type"];
            userExAccId?: UserPortfolioDB["userExAccId"];
            initialBalance?: PortfolioSettings["initialBalance"];
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
        WHERE user_id = ${userId} 
        AND status != ${UserRobotStatus.stopped}
        `);

        if (oldUserRobots > 0) {
            this.log.warn("You already have started robots");
            //throw new Error("You already have started robots");
        }

        const { minTradeAmount } = await this.db.pg.one<{ minTradeAmount: PortfolioContext["minTradeAmount"] }>(sql`
        SELECT m.min_trade_amount
        FROM mv_exchange_info m
        WHERE m.exchange = ${exchange};
        `);

        let initialBalance;
        if (type === "signals") {
            initialBalance = userInitialBalance;
        } else if (type === "trading") {
            const userExAcc = await this.db.pg.maybeOne<{
                exchange: UserExchangeAccountInfo["exchange"];
                balance: UserExchangeAccountInfo["balance"];
            }>(sql`
            SELECT exchange, ((ea.balances ->> 'totalUSD'::text))::numeric as balance
            FROM user_exchange_accs ea
            WHERE ea.id = ${userExAccId};
            `);
            if (userExAcc.exchange !== exchange) throw new Error("Wrong exchange");
            initialBalance = userExAcc.balance;
        } else throw new Error("Unknown user portfolio type");

        /*   const portfolioBalance = getPortfolioBalance(
            initialBalance,
            tradingAmountType,
            balancePercent,
            tradingAmountCurrency
        );
        getPortfolioMinBalance(portfolioBalance, minTradeAmount, minRobotsCount); */

        const userPortfolio: UserPortfolioDB = {
            id: uuid(),
            type,
            userId,
            userExAccId,
            exchange,
            status: "stopped"
        };

        const userPortfolioSettings: PortfolioSettings = {
            options,
            tradingAmountType,
            balancePercent,
            tradingAmountCurrency,
            initialBalance,
            leverage,
            maxRobotsCount,
            minRobotsCount,
            includeAssets,
            excludeAssets,
            includeTimeframes,
            excludeTimeframes
        };
        await this.db.pg.transaction(async (t) => {
            await t.query(sql`
        insert into user_portfolios
        (id, type, user_id, user_ex_acc_id, exchange, status)
        VALUES (${userPortfolio.id},
        ${userPortfolio.type}, 
        ${userPortfolio.userId},
        ${userPortfolio.userExAccId || null}, 
        ${userPortfolio.exchange},
        ${userPortfolio.status}
        );`);

            await t.query(sql`
        insert into user_portfolio_settings (user_portfolio_id, active_from, user_portfolio_settings)
        values (${userPortfolio.id}, ${null}, ${JSON.stringify(userPortfolioSettings)}); 
        `);
        });

        await this.buildUserPortfolio({ userPortfolioId: userPortfolio.id });

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
            options
        }: {
            userPortfolioId: UserPortfolioDB["id"];
            tradingAmountType?: PortfolioSettings["tradingAmountType"];
            balancePercent?: PortfolioSettings["balancePercent"];
            tradingAmountCurrency?: PortfolioSettings["tradingAmountCurrency"];
            leverage?: PortfolioSettings["leverage"];
            maxRobotsCount?: PortfolioSettings["maxRobotsCount"];
            minRobotsCount?: PortfolioSettings["minRobotsCount"];
            options?: PortfolioSettings["options"];
        },
        user: User
    ) {
        const userPortfolio = await this.db.pg.one<UserPortfolioState>(sql`
        SELECT p.id, p.type, p.user_id, p.user_ex_acc_id, p.exchange, p.status, 
              ups.id as user_portfolio_settings_id, 
              ups.active_from as user_portfolio_settings_active_from,
              ups.user_portfolio_settings as settings,
                  json_build_object('minTradeAmount', m.min_trade_amount,
                                    'feeRate', m.fee_rate,
                                    'currentBalance', ((ea.balances ->> 'totalUSD'::text))::numeric) as context
           FROM user_portfolios p, user_portfolio_settings ups
                (SELECT mk.exchange, 
                        max(mk.min_amount_currency) as min_trade_amount, 
                        max(mk.fee_rate) as fee_rate 
                 FROM v_markets mk
                 GROUP BY mk.exchange) m
                 LEFT JOIN user_exchange_accs ea 
                 ON ea.id = p.user_ex_acc_id
           WHERE p.exchange = m.exchange
             AND ups.user_portfolio_id = p.id
             AND (ups.active = true OR ups.active_from is null)
             AND p.id = ${userPortfolioId}; 
       `);

        if (userPortfolio.userId !== user.id)
            throw new ActionsHandlerError(
                "Current user isn't owner of this User Portfolio",
                { userPortfolioId: userPortfolio.id },
                "FORBIDDEN",
                403
            );

        if (tradingAmountType) {
            let initialBalance = userPortfolio.settings.initialBalance;
            if (userPortfolio.type === "trading") {
                const userExAcc = await this.db.pg.maybeOne<{
                    exchange: UserExchangeAccountInfo["exchange"];
                    balance: UserExchangeAccountInfo["balance"];
                }>(sql`
                SELECT exchange, ((ea.balances ->> 'totalUSD'::text))::numeric as balance
                FROM user_exchange_accs ea
                WHERE ea.id = ${userPortfolio.userExAccId};
                `);
                initialBalance = userExAcc.balance;
            }
            const portfolioBalance = getPortfolioBalance(
                initialBalance,
                tradingAmountType,
                balancePercent,
                tradingAmountCurrency
            );
            getPortfolioMinBalance(
                portfolioBalance,
                userPortfolio.context.minTradeAmount,
                nvl(minRobotsCount, userPortfolio.settings.minRobotsCount)
            );
        }
        const userPortfolioSettings: PortfolioSettings = {
            ...userPortfolio.settings,
            options: nvl(options, userPortfolio.settings.options),
            tradingAmountType: nvl(tradingAmountType, userPortfolio.settings.tradingAmountType),
            balancePercent: nvl(balancePercent, userPortfolio.settings.balancePercent),
            tradingAmountCurrency: nvl(tradingAmountCurrency, userPortfolio.settings.tradingAmountCurrency),
            leverage: nvl(leverage, userPortfolio.settings.leverage),
            maxRobotsCount: nvl(maxRobotsCount, userPortfolio.settings.maxRobotsCount),
            minRobotsCount: nvl(minRobotsCount, userPortfolio.settings.minRobotsCount)
        };

        if (!equals(userPortfolioSettings, userPortfolio.settings)) {
            this.db.pg.query(sql`
        INSERT INTO user_portfolio_settings (user_portfolio_id, active_from, user_portfolio_settings)
        VALUES(${userPortfolio.id}, ${null} ${JSON.stringify(userPortfolioSettings)} )
        ON CONFLICT ON CONSTRAINT i_user_portfolio_settings_uk
        DO UPDATE SET user_portfolio_settings = excluded.user_portfolio_settings;
        `);
        }

        if (
            userPortfolio.status !== "started" ||
            dayjs.utc().diff(userPortfolio.userPortfolioSettingsActiveFrom, "month") > 1
        ) {
            await this.buildUserPortfolio({ userPortfolioId: userPortfolio.id });
        }
    }

    async deleteUserPortfolio(
        user: User,
        {
            userPortfolioId
        }: {
            userPortfolioId: UserPortfolioDB["id"];
        }
    ) {
        const userPortfolio = await this.db.pg.one<{
            id: UserPortfolioDB["id"];
            type: UserPortfolioDB["type"];
            userId: UserPortfolioDB["userId"];
            status: UserPortfolioDB["status"];
        }>(sql`
        SELECT p.id, p.type, p.user_id, p.status
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

        if (userPortfolio.type === "trading" && userPortfolio.status === "started") {
            throw new BaseError("User portfolio must be stopped before deleting", {
                userPortfolioId,
                status: userPortfolio.status,
                type: userPortfolio.type
            });
        }

        await this.db.pg.query(sql`
       DELETE FROM user_portfolios WHERE id = ${userPortfolioId};
       `);
    }

    async buildPortfolio({ portfolioId }: PortfolioManagerBuildPortfolio) {
        await this.db.pg.one<{ id: PortfolioDB["id"] }>(sql`
        SELECT id FROM portfolios where id = ${portfolioId};
        `);
        await this.addJob<PortfolioBuilderJob>(
            "portfolioBuilder",
            "build",
            { portfolioId, type: "portfolio" },
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
        if (!portfolios || !Array.isArray(portfolios) || !portfolios.length) return "No stopped portfolios";
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
        SELECT id FROM user_portfolios where status = ${"active"};
        `);
        if (!userPortfolios || !Array.isArray(userPortfolios) || !userPortfolios.length)
            return "No active user portfolios";
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
