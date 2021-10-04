import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { Auth } from "@cryptuoso/auth-utils";
import { gql, GraphQLClient } from "@cryptuoso/graphql-client";
import { Telegraf, Extra, Stage } from "telegraf";
import Validator from "fastest-validator";
import { I18n, match } from "@edjopato/telegraf-i18n";
import { TelegrafSessionRedis } from "@ivaniuk/telegraf-session-redis";
import telegrafThrottler from "telegraf-throttler";
import path from "path";
import { getBackKeyboard, getMainKeyboard, getStartKeyboard } from "./keyboard";
import { formatTgName, UserExchangeAccountInfo, UserSettings, Notification } from "@cryptuoso/user-state";
import { Robot, TelegramScene, TelegramUser } from "./types";
import { sql } from "@cryptuoso/postgres";
import {
    addUserExAccScene,
    addUserRobotScene,
    cancelUserSubScene,
    checkoutUserSubScene,
    createUserSubScene,
    deleteUserRobotScene,
    editSignalsScene,
    editUserExAccScene,
    editUserRobotScene,
    loginScene,
    myRobotsScene,
    mySignalsScene,
    paymentHistoryScene,
    perfRobotsScene,
    perfSignalsScene,
    registrationScene,
    robotsScene,
    robotSignalScene,
    searchRobotScene,
    searchSignalsScene,
    settingsScene,
    signalsScene,
    startScene,
    startUserRobotScene,
    stopUserRobotScene,
    subscribeSignalsScene,
    supportScene,
    topRobotsScene,
    topSignalsScene,
    unsubscribeSignalsScene,
    userExAccScene,
    userExAccsScene,
    userRobotScene,
    userSubScene
} from "./scenes";
import { UserMarketState } from "@cryptuoso/market";
import { SignalEvents } from "@cryptuoso/robot-events";
const { enter, leave } = Stage;
import {
    handleBroadcastMessage,
    handleMessageSupportReply,
    handleOrderError,
    handlePaymentStatus,
    handleSignal,
    handleUserExAccError,
    handleUserRobotError,
    handleUserRobotStatus,
    handleUserRobotTrade,
    handleUserSubError,
    handleUserSubStatus
} from "./notifications";
import { UserRobotStatus } from "@cryptuoso/user-robot-state";
import { GA } from "@cryptuoso/analytics";

export type TelegramBotServiceConfig = BaseServiceConfig;

export default class TelegramBotService extends BaseService {
    bot: any;
    i18n: I18n;
    session: TelegrafSessionRedis;
    validator: Validator;
    authUtils: Auth;
    gqlClient: GraphQLClient;
    notificationsTimer: NodeJS.Timer;
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

            const mainStage = new Stage([
                addUserExAccScene(this),
                addUserRobotScene(this),
                cancelUserSubScene(this),
                checkoutUserSubScene(this),
                createUserSubScene(this),
                deleteUserRobotScene(this),
                editSignalsScene(this),
                editUserExAccScene(this),
                editUserRobotScene(this),
                mySignalsScene(this),
                paymentHistoryScene(this),
                myRobotsScene(this),
                perfRobotsScene(this),
                perfSignalsScene(this),
                robotsScene(this),
                robotSignalScene(this),
                searchRobotScene(this),
                searchSignalsScene(this),
                settingsScene(this),
                signalsScene(this),
                startUserRobotScene(this),
                stopUserRobotScene(this),
                subscribeSignalsScene(this),
                supportScene(this),
                topRobotsScene(this),
                topSignalsScene(this),
                unsubscribeSignalsScene(this),
                userExAccScene(this),
                userExAccsScene(this),
                userRobotScene(this),
                userSubScene(this)
            ]);
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
            this.bot.hears(match("keyboards.mainKeyboard.subscription"), enter(TelegramScene.USER_SUB));
            this.bot.hears(/(.*?)/, this.defaultHandler.bind(this));

            this.addOnStartHandler(this.onServiceStart);

            this.addOnStopHandler(this.onServiceStop);
        } catch (err) {
            this.log.error("Error in TelegramBotService constructor", err);
        }
    }

    async onServiceStart() {
        if (process.env.NODE_ENV === "production") {
            await this.bot.telegram.setWebhook(process.env.BOT_HOST);
            await this.bot.startWebhook("/", null, +process.env.PORT);
            this.notificationsTimer = setTimeout(this.checkNotifications.bind(this), 0);
            this.log.warn("Bot in production mode!");
        } else if (process.env.NODE_ENV === "dev" || process.env.NODE_ENV === "development") {
            await this.bot.telegram.deleteWebhook();
            await this.bot.startPolling();
            this.notificationsTimer = setTimeout(this.checkNotifications.bind(this), 0);
            this.log.warn("Bot in development mode!");
        } else {
            this.log.warn("Bot not started!");
        }
    }

    async onServiceStop() {
        await this.bot.stop();
    }

    async checkNotifications() {
        try {
            const notifications = await this.getNotifations();

            for (const notification of notifications) {
                try {
                    let messageToSend;
                    switch (notification.type) {
                        case SignalEvents.ALERT:
                            messageToSend = handleSignal.call(this, notification);
                            break;
                        case SignalEvents.TRADE:
                            messageToSend = handleSignal.call(this, notification);
                            break;
                        case "user-robot.trade":
                            messageToSend = handleUserRobotTrade.call(this, notification);
                            break;
                        case "user_ex_acc.error":
                            messageToSend = handleUserExAccError.call(this, notification);
                            break;
                        case "user-robot.error":
                            messageToSend = handleUserRobotError.call(this, notification);
                            break;
                        case `user-robot.${UserRobotStatus.paused}`:
                            messageToSend = handleUserRobotStatus.call(this, notification);
                            break;
                        case `user-robot.${UserRobotStatus.started}`:
                            messageToSend = handleUserRobotStatus.call(this, notification);
                            break;
                        case `user-robot.${UserRobotStatus.starting}`:
                            messageToSend = handleUserRobotStatus.call(this, notification);
                            break;
                        case `user-robot.${UserRobotStatus.stopped}`:
                            messageToSend = handleUserRobotStatus.call(this, notification);
                            break;
                        case `user-robot.${UserRobotStatus.stopping}`:
                            messageToSend = handleUserRobotStatus.call(this, notification);
                            break;
                        case "order.error":
                            messageToSend = handleOrderError.call(this, notification);
                            break;
                        case "message.broadcast":
                            messageToSend = handleBroadcastMessage.call(this, notification);
                            break;
                        case "message.support-reply":
                            messageToSend = handleMessageSupportReply.call(this, notification);
                            break;
                        case "user_sub.error":
                            messageToSend = handleUserSubError.call(this, notification);
                            break;
                        case "user_payment.status":
                            messageToSend = handlePaymentStatus.call(this, notification);
                            break;
                        case "user_sub.status":
                            messageToSend = handleUserSubStatus.call(this, notification);
                            break;
                        default:
                            await this.db.pg.query(sql`
                            UPDATE notifications 
                            SET send_telegram = false 
                            WHERE id = ${notification.id};`);
                    }

                    if (messageToSend) {
                        const { success } = await this.sendMessage(messageToSend);
                        if (success) {
                            await this.db.pg.query(sql`
                        UPDATE notifications 
                        SET send_telegram = false 
                        WHERE id = ${notification.id};`);
                        }
                    }
                } catch (err) {
                    this.log.error(`Failed to process notification`, err);
                }
            }
        } catch (error) {
            this.log.error(`Failed to check notifications`, error);
        } finally {
            if (!this.lightship.isServerShuttingDown()) {
                this.notificationsTimer = setTimeout(this.checkNotifications.bind(this), 5000);
            }
        }
    }

    formatName(ctx: any) {
        return formatTgName(ctx.from.username, ctx.from.first_name, ctx.from.last_name);
    }

    async sendMessage({ telegramId, message }: { telegramId: number; message: string }) {
        try {
            this.log.debug(`Sending ${message} to ${telegramId}`);
            await this.bot.telegram.sendMessage(telegramId, message, {
                parse_mode: "HTML"
            });
            return { success: true };
        } catch (err) {
            this.log.error(err);
            return this.blockHandler(telegramId, err.response);
        }
    }

    async blockHandler(telegramId: number, error: { ok: boolean; error_code: number; description: string }) {
        try {
            this.log.warn(`${telegramId}`, error);
            if (error && error.ok === false && (error.error_code === 403 || error.error_code === 400)) {
                const user = await this.db.pg.maybeOne<{ id: string; settings: UserSettings }>(sql`
                                    SELECT id, settings
                                    FROM users 
                                    WHERE telegram_id = ${telegramId};`);

                if (user) {
                    const {
                        id,
                        settings: { notifications }
                    } = user;
                    const newSettings = {
                        ...user.settings,
                        notifications: {
                            signals: {
                                ...notifications.signals,
                                telegram: false
                            },
                            trading: {
                                ...notifications.trading,
                                telegram: false
                            },
                            news: {
                                ...notifications.news,
                                telegram: false
                            }
                        }
                    };
                    await this.db.pg.query(sql`
                        UPDATE users
                        SET settings = ${JSON.stringify(newSettings)}
                        WHERE id = ${id};`);

                    //TODO: set sentTelegram in notifications to false
                }
                return { success: true };
            }
            return { success: false };
        } catch (e) {
            this.log.error(e);
            return { success: false, error: e.message };
        }
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
        }

        if (sessionData && sessionData.user && sessionData.user.access !== 15)
            await ctx.reply("❌  You are not allowed to use this bot. Please contact support");
        else await next();
    }

    async start(ctx: any) {
        try {
            GA.view(null, "start");
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

    async getNotifations() {
        return this.db.pg.any<Notification<any> & { telegramId: number }[]>(sql`
        SELECT u.telegram_id, n.* FROM notifications n, users u
        WHERE n.user_id = u.id 
        AND n.send_telegram = true
        AND u.status > 0
        AND u.telegram_id is not null
        AND u.access = 15
        ORDER BY timestamp; 
        `);
    }

    async getExchanges(ctx: any): Promise<
        {
            code: string;
        }[]
    > {
        await ctx.replyWithChatAction("typing");
        const { exchanges } = await this.gqlClient.request<{
            exchanges: {
                code: string;
            }[];
        }>(
            gql`
                query Exchanges {
                    exchanges {
                        code
                    }
                }
            `,
            {},
            ctx
        );
        return exchanges;
    }

    async getSignalRobot(ctx: any): Promise<Robot> {
        await ctx.replyWithChatAction("typing");
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
                            firstPositionEntryDate: first_position_entry_date
                            lastPositionExitDate: last_position_exit_date
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
                                firstPositionEntryDate: first_position_entry_date
                                lastPositionExitDate: last_position_exit_date
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
                robotId: ctx.scene.state.robot?.id || ctx.scene.state.robotId
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
        await ctx.replyWithChatAction("typing");
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
                            firstPositionEntryDate: first_position_entry_date
                            lastPositionExitDate: last_position_exit_date
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
                            status
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
                                firstPositionEntryDate: first_position_entry_date
                                lastPositionExitDate: last_position_exit_date
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
                robotId: ctx.scene.state.robot?.id || ctx.scene.state.robotId
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

    async getUserMarket(ctx: any): Promise<{
        limits: UserMarketState["limits"];
        precision: UserMarketState["precision"];
    }> {
        await ctx.replyWithChatAction("typing");
        const { markets } = await this.gqlClient.request<
            {
                markets: {
                    limits: UserMarketState["limits"];
                    precision: UserMarketState["precision"];
                }[];
            },
            { userId: string; exchange: string; asset: string; currency: string }
        >(
            gql`
                query UserMarkets($userId: uuid!, $exchange: String!, $asset: String!, $currency: String!) {
                    markets: v_user_markets(
                        where: {
                            user_id: { _eq: $userId }
                            exchange: { _eq: $exchange }
                            asset: { _eq: $asset }
                            currency: { _eq: $currency }
                        }
                    ) {
                        limits
                        precision
                    }
                }
            `,
            {
                userId: ctx.session.user.id,
                exchange: ctx.scene.state.robot.exchange,
                asset: ctx.scene.state.robot.asset,
                currency: ctx.scene.state.robot.currency
            },
            ctx
        );
        return markets[0];
    }

    async getUserAmounts(ctx: any): Promise<{
        balance: number;
        availableBalancePercent: number;
    }> {
        await ctx.replyWithChatAction("typing");
        const { userExAcc } = await this.gqlClient.request<
            {
                userExAcc: {
                    balance: number;
                    amounts: {
                        availableBalancePercent: number;
                    };
                }[];
            },
            { userId: string; userExAccId: string }
        >(
            gql`
                query UserAmounts($userId: uuid!, $userExAccId: uuid!) {
                    userExAcc: v_user_exchange_accs(where: { user_id: { _eq: $userId }, id: { _eq: $userExAccId } }) {
                        balance: total_balance_usd
                        amounts {
                            availableBalancePercent: available_balance_percent
                        }
                    }
                }
            `,
            {
                userId: ctx.session.user.id,
                userExAccId: ctx.scene.state.userExAccId || ctx.scene.state.robot.userRobot.userExAcc.userExAccId
            },
            ctx
        );
        return {
            balance: userExAcc[0]?.balance,
            availableBalancePercent: userExAcc[0]?.amounts.availableBalancePercent
        };
    }

    async getUserExchangeAcc(ctx: any): Promise<UserExchangeAccountInfo> {
        await ctx.replyWithChatAction("typing");
        const { userExAcc } = await this.gqlClient.request<
            {
                userExAcc: UserExchangeAccountInfo;
            },
            { userExAcId: string }
        >(
            gql`
                query UserExchangeAccs($userId: uuid!) {
                    userExAcc: user_exchange_accs_by_pk(id: $userExAcId) {
                        id
                        exchange
                        name
                        status
                    }
                }
            `,
            {
                userExAcId: ctx.scene.state.userExAcc.id
            },
            ctx
        );
        return userExAcc;
    }

    async getUserExchangeAccs(ctx: any): Promise<UserExchangeAccountInfo[]> {
        await ctx.replyWithChatAction("typing");
        const { userExAccs } = await this.gqlClient.request<
            {
                userExAccs: UserExchangeAccountInfo[];
            },
            { userId: string }
        >(
            gql`
                query UserExchangeAccs($userId: uuid!) {
                    userExAccs: user_exchange_accs(where: { user_id: { _eq: $userId } }) {
                        id
                        exchange
                        name
                        status
                    }
                }
            `,
            {
                userId: ctx.session.user.id
            },
            ctx
        );
        return userExAccs;
    }

    async getUserExchangeAccsByExchange(ctx: any): Promise<UserExchangeAccountInfo[]> {
        await ctx.replyWithChatAction("typing");
        const { userExAccs } = await this.gqlClient.request<
            {
                userExAccs: UserExchangeAccountInfo[];
            },
            { userId: string; exchange: string }
        >(
            gql`
                query UserExchangeAccs($userId: uuid!, $exchange: String!) {
                    userExAccs: user_exchange_accs(where: { user_id: { _eq: $userId }, exchange: { _eq: $exchange } }) {
                        id
                        exchange
                        name
                        status
                    }
                }
            `,
            {
                userId: ctx.session.user.id,
                exchange: ctx.scene.state.robot.exchange
            },
            ctx
        );
        return userExAccs;
    }

    async getUserSettings(ctx: any): Promise<UserSettings> {
        await ctx.replyWithChatAction("typing");
        const {
            user: { settings }
        } = await this.gqlClient.request<
            {
                user: {
                    settings: UserSettings;
                };
            },
            { userId: string }
        >(
            gql`
                query User($userId: uuid!) {
                    user: users_by_pk(id: $userId) {
                        settings
                    }
                }
            `,
            {
                userId: ctx.session.user.id
            },
            ctx
        );
        return settings;
    }
}
