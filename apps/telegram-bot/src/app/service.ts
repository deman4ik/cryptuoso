import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { Auth } from "@cryptuoso/auth-utils";
import { gql, GraphQLClient } from "@cryptuoso/graphql-client";
import { Telegraf, Extra, Stage } from "telegraf";
import Validator from "fastest-validator";
import { I18n, match, reply } from "@edjopato/telegraf-i18n";
import { TelegrafSessionRedis } from "@ivaniuk/telegraf-session-redis";
import telegrafThrottler from "telegraf-throttler";
import path from "path";
import { getBackKeyboard, getMainKeyboard, getStartKeyboard } from "./keyboard";
import { formatTgName } from "@cryptuoso/user-state";
import { Robot, TelegramScene, TelegramUser } from "./types";
import { sql } from "@cryptuoso/postgres";
import { startScene, registrationScene, loginScene, signalsScene } from "./scenes";
const { enter, leave } = Stage;

export type TelegramBotServiceConfig = BaseServiceConfig;

export default class TelegramBotService extends BaseService {
    bot: any;
    i18n: I18n;
    session: TelegrafSessionRedis;
    validator: Validator;
    authUtils: Auth;
    gqlClient: GraphQLClient;
    constructor(config?: TelegramBotServiceConfig) {
        super(config);
        try {
            this.authUtils = new Auth();
            this.gqlClient = new GraphQLClient({
                refreshToken: this.authUtils.refreshTokenTg.bind(this.authUtils)
            });
            this.validator = new Validator();
            this.bot = new Telegraf(process.env.BOT_TOKEN);
            this.bot.catch((err: any) => {
                this.log.error(err);
            });
            const throttler = telegrafThrottler({
                in: {
                    maxConcurrent: 100
                }
            });
            this.bot.use(throttler);
            this.bot.use(async (ctx: any, next: any) => {
                const start = dayjs.utc();
                await next();
                const ms = dayjs.utc().diff(start, "millisecond");
                this.log.debug(`Response time ${ms} ms`);
            });
            this.session = new TelegrafSessionRedis({
                client: this.redis.duplicate()
            });
            this.bot.use(this.session.middleware());

            this.i18n = new I18n({
                defaultLanguage: "en",
                useSession: true,
                defaultLanguageOnMissing: true,
                directory: path.resolve(__dirname, "assets/locales")
            });
            this.bot.use(this.i18n.middleware());
            // Create scene manager
            const regStage = new Stage([startScene(this), registrationScene(this), loginScene(this)]);
            regStage.command("cancel", leave());

            this.bot.use(regStage.middleware());
            this.bot.hears(match("keyboards.startKeybord.info"), this.info.bind(this));
            this.bot.use(this.auth.bind(this));

            const mainStage = new Stage([signalsScene(this)]);
            mainStage.command("cancel", leave());
            this.bot.use(mainStage.middleware());
            this.bot.start(this.start.bind(this));
            this.bot.hears(match("keyboards.startKeybord.start"), this.mainMenu.bind(this));
            this.bot.command("menu", this.mainMenu.bind(this));
            // Main menu
            this.bot.hears(match("keyboards.mainKeyboard.signals"), enter(TelegramScene.SIGNALS));
            this.bot.hears(match("keyboards.mainKeyboard.robots"), enter(TelegramScene.ROBOTS));
            this.bot.hears(match("keyboards.mainKeyboard.settings"), enter(TelegramScene.SETTINGS));
            this.bot.hears(match("keyboards.mainKeyboard.support"), enter(TelegramScene.SUPPORT));
            this.bot.hears(match("keyboards.mainKeyboard.donation"), reply("donation", Extra.HTML()));
            this.bot.hears(/(.*?)/, this.defaultHandler.bind(this));

            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error("Error in TelegramBotService constructor", err);
        }
    }

    async onServiceStart() {
        if (process.env.NODE_ENV === "production") {
            await this.bot.telegram.setWebhook(process.env.BOT_HOST);
            await this.bot.startWebhook("/", null, +process.env.PORT);
            this.log.warn("Bot in production mode!");
        } else if (process.env.NODE_ENV === "dev" || process.env.NODE_ENV === "development") {
            await this.bot.telegram.deleteWebhook();
            await this.bot.startPolling();
            this.log.warn("Bot in development mode!");
        } else {
            this.log.warn("Bot not started!");
        }
    }

    formatName(ctx: any) {
        return formatTgName(ctx.from.username, ctx.from.first_name, ctx.from.last_name);
    }

    async getUser(telegramId: number) {
        return this.db.pg.maybeOne<TelegramUser>(sql`
        SELECT id, status, roles, access, settings, last_active_at,
        name, email, email_new, telegram_id, telegram_username,
        secret_code, secret_code_expire_at
        FROM users 
        WHERE telegram_id = ${telegramId};
        `);
    }

    async auth(ctx: any, next: () => any) {
        if (
            ctx.scene &&
            (ctx.scene?.current?.id === TelegramScene.REGISTRATION ||
                ctx.scene?.current?.id === TelegramScene.LOGIN ||
                ctx.scene?.current?.id === TelegramScene.START)
        ) {
            const isStart = match("keyboards.startKeybord.start");
            if (isStart(ctx.message?.text, ctx)) {
                await ctx.scene.leave();
                await ctx.scene.enter(TelegramScene.START);
            }
            return;
        }
        const sessionData = ctx.session;
        if (!sessionData || !sessionData.user) {
            try {
                const { user, accessToken } = await this.authUtils.refreshTokenTg({ telegramId: ctx.from.id });
                ctx.session.user = { ...user, accessToken };
            } catch (err) {
                this.log.warn("Auth middleware -", err.message);
                await ctx.scene.leave();
                await ctx.scene.enter(TelegramScene.START);
                return;
            }
            await next();
        } else await next();
    }

    async start(ctx: any) {
        try {
            const params = ctx.update.message.text.replace("/start ", "");
            if (params && params !== "") {
                const [scene, robotId] = params.split("_");
                if (scene && robotId && (scene === TelegramScene.ROBOT_SIGNAL || scene === TelegramScene.USER_ROBOT)) {
                    ctx.scene.state.silent = true;
                    await ctx.scene.leave();
                    await ctx.reply(
                        ctx.i18n.t("welcome", {
                            username: this.formatName(ctx)
                        }),
                        getBackKeyboard(ctx)
                    );
                    return ctx.scene.enter(scene, { robotId });
                }
            }
            return this.mainMenu(ctx);
        } catch (e) {
            this.log.error(e);
            return ctx.reply(ctx.i18n.t("failed"));
        }
    }

    async info(ctx: any) {
        await ctx.reply(`${ctx.i18n.t("scenes.support.info1alt")}${ctx.i18n.t("scenes.support.info2")}`, Extra.HTML());
    }

    async mainMenu(ctx: any) {
        const sessionData = ctx.session;
        if (!sessionData || !sessionData.user) {
            await ctx.reply(ctx.i18n.t("menu"), getStartKeyboard(ctx));
        } else {
            await ctx.reply(ctx.i18n.t("menu"), getMainKeyboard(ctx));
        }
    }

    async defaultHandler(ctx: any) {
        this.log.info("defaultHandler");
        await ctx.reply(ctx.i18n.t("defaultHandler"), getMainKeyboard(ctx));
    }

    async getSignalRobot(ctx: any): Promise<Robot> {
        const { robot } = await this.gqlClient.request<{ robot: Robot }, { robotId: string; userId: string }>(
            gql`
                query UserSignalsRobot($robotId: uuid!, $userId: uuid!) {
                    robot: robots_by_pk(id: $robotId) {
                        id
                        code
                        name
                        mod
                        exchange
                        asset
                        currency
                        timeframe
                        strategy: strategyByStrategy {
                            code
                            description
                        }
                        startedAt: started_at
                        settings: robot_settings {
                            currentSettings: robot_settings
                        }
                        stats {
                            netProfit: net_profit
                            tradesCount: trades_count
                            avgNetProfit: avg_net_profit
                            avgBarsHeld: avg_bars_held
                            profitFactor: profit_factor
                            recoveryFactor: recovery_factor
                            payoffRatio: payoff_ratio
                            maxDrawdown: max_drawdown
                            maxDrawdownDate: max_drawdown_date
                            winRate: win_rate
                            grossProfit: gross_profit
                            avgProfit: avg_profit
                            avgBarsHeldWinning: avg_bars_held_winning
                            maxConsecWins: max_consec_wins
                            lossRate: loss_rate
                            grossLoss: gross_loss
                            avgLoss: avg_loss
                            avgBarsHeldLosing: avg_bars_held_losing
                            maxConsecLosses: max_consec_losses
                            lastUpdatedAt: last_updated_at
                        }
                        openPositions: robot_positions(
                            where: { status: { _eq: "open" } }
                            order_by: { entry_date: desc_nulls_last }
                        ) {
                            id
                            code
                            direction
                            entryAction: entry_action
                            entryPrice: entry_price
                            entryDate: entry_date
                            volume
                            profit
                        }
                        closedPositions: robot_positions(
                            where: { status: { _eq: "closed" } }
                            order_by: { entry_date: desc_nulls_last }
                            limit: 5
                        ) {
                            id
                            code
                            direction
                            entryAction: entry_action
                            entryPrice: entry_price
                            entryDate: entry_date
                            exitAction: exit_action
                            exitPrice: exit_price
                            exitDate: exit_date
                            barsHeld: bars_held
                            volume
                            profit
                        }
                        activeSignals: active_signals(
                            order_by: { position_code: asc_nulls_last, timestamp: asc_nulls_last }
                        ) {
                            code: position_code
                            action
                            price
                            orderType: order_type
                            timestamp
                            volume
                        }
                        userSignals: user_signals(where: { user_id: { _eq: $userId } }) {
                            id
                            subscribedAt: subscribed_at
                            settings: user_signal_settings {
                                currentSettings: signal_settings
                            }
                            stats {
                                netProfit: net_profit
                                tradesCount: trades_count
                                avgNetProfit: avg_net_profit
                                avgBarsHeld: avg_bars_held
                                profitFactor: profit_factor
                                recoveryFactor: recovery_factor
                                payoffRatio: payoff_ratio
                                maxDrawdown: max_drawdown
                                maxDrawdownDate: max_drawdown_date
                                winRate: win_rate
                                grossProfit: gross_profit
                                avgProfit: avg_profit
                                avgBarsHeldWinning: avg_bars_held_winning
                                maxConsecWins: max_consec_wins
                                lossRate: loss_rate
                                grossLoss: gross_loss
                                avgLoss: avg_loss
                                avgBarsHeldLosing: avg_bars_held_losing
                                maxConsecLosses: max_consec_losses
                                lastUpdatedAt: last_updated_at
                            }
                            openPositions: user_signal_positions(
                                where: { status: { _eq: "open" } }
                                order_by: { entry_date: desc_nulls_last }
                            ) {
                                id
                                code
                                direction
                                entryAction: entry_action
                                entryPrice: entry_price
                                entryDate: entry_date
                                volume
                                profit
                            }
                            closedPositions: user_signal_positions(
                                where: { status: { _eq: "closed" } }
                                order_by: { entry_date: desc_nulls_last }
                                limit: 5
                            ) {
                                id
                                code
                                direction
                                entryAction: entry_action
                                entryPrice: entry_price
                                entryDate: entry_date
                                exitAction: exit_action
                                exitPrice: exit_price
                                exitDate: exit_date
                                barsHeld: bars_held
                                volume
                                profit
                            }
                            activeSignals: active_signals(
                                order_by: { position_code: asc_nulls_last, timestamp: asc_nulls_last }
                            ) {
                                code: position_code
                                action
                                price
                                orderType: order_type
                                timestamp
                                volume
                            }
                        }
                    }
                }
            `,
            {
                userId: ctx.session.user.id,
                robotId: ctx.scene.state.robot.id
            },
            ctx
        );
        return {
            ...robot,
            userSignals: [],
            userSignal: robot.userSignals[0],
            lastInfoUpdatedAt: dayjs.utc().format("YYYY-MM-DD HH:mm:ss UTC")
        };
    }

    async getUserRobot(ctx: any): Promise<Robot> {
        const { robot } = await this.gqlClient.request<{ robot: Robot }, { robotId: string; userId: string }>(
            gql`
                query UserRobot($robotId: uuid!, $userId: uuid!) {
                    robot: robots_by_pk(id: $robotId) {
                        id
                        code
                        name
                        mod
                        exchange
                        asset
                        currency
                        timeframe
                        strategy: strategyByStrategy {
                            code
                            description
                        }
                        startedAt: started_at
                        settings: robot_settings {
                            currentSettings: robot_settings
                        }
                        stats {
                            netProfit: net_profit
                            tradesCount: trades_count
                            avgNetProfit: avg_net_profit
                            avgBarsHeld: avg_bars_held
                            profitFactor: profit_factor
                            recoveryFactor: recovery_factor
                            payoffRatio: payoff_ratio
                            maxDrawdown: max_drawdown
                            maxDrawdownDate: max_drawdown_date
                            winRate: win_rate
                            grossProfit: gross_profit
                            avgProfit: avg_profit
                            avgBarsHeldWinning: avg_bars_held_winning
                            maxConsecWins: max_consec_wins
                            lossRate: loss_rate
                            grossLoss: gross_loss
                            avgLoss: avg_loss
                            avgBarsHeldLosing: avg_bars_held_losing
                            maxConsecLosses: max_consec_losses
                            lastUpdatedAt: last_updated_at
                        }
                        openPositions: robot_positions(
                            where: { status: { _eq: "open" } }
                            order_by: { entry_date: desc_nulls_last }
                        ) {
                            id
                            code
                            direction
                            entryAction: entry_action
                            entryPrice: entry_price
                            entryDate: entry_date
                            volume
                            profit
                        }
                        closedPositions: robot_positions(
                            where: { status: { _eq: "closed" } }
                            order_by: { entry_date: desc_nulls_last }
                            limit: 5
                        ) {
                            id
                            code
                            direction
                            entryAction: entry_action
                            entryPrice: entry_price
                            entryDate: entry_date
                            exitAction: exit_action
                            exitPrice: exit_price
                            exitDate: exit_date
                            barsHeld: bars_held
                            volume
                            profit
                        }
                        activeSignals: active_signals(
                            order_by: { position_code: asc_nulls_last, timestamp: asc_nulls_last }
                        ) {
                            code: position_code
                            action
                            price
                            orderType: order_type
                            timestamp
                            volume
                        }
                        userRobots: user_robots(where: { user_id: { _eq: $userId } }) {
                            id
                            userExAcc: user_exchange_acc {
                                userExAccId: id
                                userExAccName: name
                            }
                            startedAt: started_at
                            stoppedAt: stopped_at
                            settings: user_robot_settings {
                                currentSettings: user_robot_settings
                            }
                            stats {
                                netProfit: net_profit
                                tradesCount: trades_count
                                avgNetProfit: avg_net_profit
                                avgBarsHeld: avg_bars_held
                                profitFactor: profit_factor
                                recoveryFactor: recovery_factor
                                payoffRatio: payoff_ratio
                                maxDrawdown: max_drawdown
                                maxDrawdownDate: max_drawdown_date
                                winRate: win_rate
                                grossProfit: gross_profit
                                avgProfit: avg_profit
                                avgBarsHeldWinning: avg_bars_held_winning
                                maxConsecWins: max_consec_wins
                                lossRate: loss_rate
                                grossLoss: gross_loss
                                avgLoss: avg_loss
                                avgBarsHeldLosing: avg_bars_held_losing
                                maxConsecLosses: max_consec_losses
                                lastUpdatedAt: last_updated_at
                            }
                            openPositions: user_positions(
                                where: { status: { _eq: "open" } }
                                order_by: { entry_date: desc_nulls_last }
                            ) {
                                id
                                code
                                direction
                                entryAction: entry_action
                                entryPrice: entry_price
                                entryDate: entry_date
                                volume: entry_executed
                                profit
                            }
                            closedPositions: user_positions(
                                where: { status: { _in: ["closed", "closedAuto"] } }
                                order_by: { entry_date: desc_nulls_last }
                                limit: 5
                            ) {
                                id
                                code
                                direction
                                entryAction: entry_action
                                entryPrice: entry_price
                                entryDate: entry_date
                                exitAction: exit_action
                                exitPrice: exit_price
                                exitDate: exit_date
                                barsHeld: bars_held
                                volume: exit_executed
                                profit
                            }
                        }
                    }
                }
            `,
            {
                userId: ctx.session.user.id,
                robotId: ctx.scene.state.robot.id
            },
            ctx
        );
        return {
            ...robot,
            userRobots: [],
            userRobot: robot.userRobots[0],
            lastInfoUpdatedAt: dayjs.utc().format("YYYY-MM-DD HH:mm:ss UTC")
        };
    }
}
