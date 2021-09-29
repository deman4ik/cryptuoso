import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { Bot, BotError, GrammyError, HttpError, NextFunction, session } from "grammy";
import { RedisAdapter } from "@satont/grammy-redis-storage";
import { I18n } from "@grammyjs/i18n";
import { hydrateReply, parseMode } from "parse-mode";
import path from "path";
import { auth } from "./middleware/auth";
import { Auth } from "@cryptuoso/auth-utils";
import { GraphQLClient } from "./utils/graphql-client";
import logger from "@cryptuoso/logger";
import { getMainKeyboard, getStartKeyboard } from "./utils/keyboard";
import { dialogs } from "./dialogs";
import { BotContext, SessionData } from "./types";
import { getDialogName } from "./utils/helpers";
import { DialogsRouter } from "./utils/dialogsRouter";
import { tradingActions } from "./dialogs/trading";
import dayjs from "@cryptuoso/dayjs";
import { capitalize, formatExchange, plusNum, round } from "@cryptuoso/helpers";
import { formatTgName, Notification, UserSettings } from "@cryptuoso/user-state";
import { accountActions } from "./dialogs/account";
import { supportActions } from "./dialogs/support";
import { sql } from "@cryptuoso/postgres";
import {
    handleBroadcastMessage,
    handleMessageSupportReply,
    handleOrderError,
    handlePaymentStatus,
    handleUserExAccError,
    handleUserRobotError,
    handleUserTrade,
    handleUserSubError,
    handleUserSubStatus,
    handleUserPortfolioBuilded,
    handleUserPortfolioBuildError,
    handleUserPortfolioStatus
} from "./utils/notifications";

export type TelegramBotServiceConfig = BaseServiceConfig;

const enum JobTypes {
    checkNotifications = "checkNotifications"
}

export default class TelegramBotService extends BaseService {
    bot: Bot;
    authUtils: Auth;
    gqlClient: GraphQLClient;
    i18n: I18n;

    constructor(config?: TelegramBotServiceConfig) {
        super(config);
        this.authUtils = new Auth();
        this.gqlClient = new GraphQLClient({
            refreshToken: this.authUtils.refreshTokenTg.bind(this.authUtils)
        });
        this.i18n = new I18n({
            defaultLanguage: "en",
            defaultLanguageOnMissing: true, // implies allowMissing = true
            directory: path.resolve(__dirname, "assets/locales"),
            useSession: true,
            templateData: {
                round,
                formatCurrency: (value: number) => round(value, 2),
                capitalize,
                formatExchange,
                formatDate: (value: string) => dayjs.utc(value).format("YYYY-MM-DD HH:mm UTC"),
                formatDateSec: (value: string) => dayjs.utc(value).format("YYYY-MM-DD HH:mm:ss UTC"),
                plus: plusNum
            }
        });

        this.bot = new Bot<BotContext>(process.env.BOT_TOKEN);
        // Install familiar reply variants to ctx
        this.bot.use(hydrateReply);

        // Sets default parse_mode for ctx.reply
        this.bot.api.config.use(parseMode("HTML"));
        // Use session
        this.bot.use(
            session({
                initial: (): SessionData => ({
                    dialog: {
                        current: null,
                        move: null
                    }
                }),
                storage: new RedisAdapter({ instance: this.redis.duplicate() })
            })
        );
        this.bot.use(this.i18n.middleware() as any);
        this.bot.use(async (ctx: BotContext, next: NextFunction) => {
            ctx.gql = this.gqlClient;
            ctx.catalog = {
                options: ["profit", "risk", "moneyManagement", "winRate", "efficiency"]
            };
            ctx.utils = {
                formatName: (ctx: BotContext) =>
                    formatTgName(ctx.from.username, ctx.from.first_name, ctx.from.last_name)
            };
            ctx.authUtils = this.authUtils;
            await next();
        });
        this.bot.use(auth(this.authUtils));
        const dialogsRouter = new DialogsRouter();
        for (const dialog of Object.values(dialogs)) {
            dialogsRouter.addDialog(dialog.router);
        }
        dialogsRouter.otherwise(this.defaultHandler);
        this.bot.use(dialogsRouter.init());
        this.bot.on("callback_query:data", async (ctx: any, next: NextFunction) => {
            const data: { d: string; a: string; p?: string | number | boolean } = JSON.parse(ctx.callbackQuery.data);

            if (data && data.a && data.d) {
                if (data.a === "back" && ctx.session.dialog.current && ctx.session.dialog.prev) {
                    ctx.dialog.return();
                    await next();
                    return;
                }
                if (
                    ctx.session.dialog.current &&
                    getDialogName(data.a) === ctx.session.dialog.current.name &&
                    data.d === ctx.session.dialog.current.id
                ) {
                    ctx.session.dialog.current.action = data.a;
                    if (data.p) ctx.session.dialog.current.data.payload = data.p;
                    await next();
                    return;
                }
            }
            await ctx.answerCallbackQuery();
            await this.mainMenu(ctx);
        });

        this.bot.command("start", this.startHandler.bind(this));

        this.bot.hears(this.i18n.t("en", "keyboards.mainKeyboard.trading"), async (ctx: any, next: NextFunction) => {
            ctx.session.dialog.current = null;
            ctx.dialog.enter(tradingActions.enter, { reload: true, edit: false });
            await next();
        });
        this.bot.hears(this.i18n.t("en", "keyboards.mainKeyboard.account"), async (ctx: any, next: NextFunction) => {
            ctx.session.dialog.current = null;
            ctx.dialog.enter(accountActions.enter);
            await next();
        });
        this.bot.hears(this.i18n.t("en", "keyboards.mainKeyboard.support"), async (ctx: any, next: NextFunction) => {
            ctx.session.dialog.current = null;
            ctx.dialog.enter(supportActions.enter);
            await next();
        });
        this.bot.hears(this.i18n.t("en", "keyboards.backKeyboard.menu"), async (ctx: any, next: NextFunction) => {
            ctx.session.dialog.current = null;
            await this.mainMenu(ctx);
            await next();
        });
        this.bot.hears(this.i18n.t("en", "keyboards.backKeyboard.back"), async (ctx: any, next: NextFunction) => {
            const current = ctx.session.dialog.current;

            if (!current.prev) {
                await this.mainMenu(ctx);
            } else ctx.session.dialog.current = current.prev;
            await next();
        });
        this.bot.hears(this.i18n.t("en", "keyboards.startKeybord.start"), this.startHandler.bind(this));
        this.bot.hears(this.i18n.t("en", "keyboards.startKeybord.info"), async (ctx: any, next: NextFunction) => {
            await ctx.reply(`${ctx.i18n.t("dialogs.support.info1alt")}${ctx.i18n.t("dialogs.support.info2")}`);
            await next();
        });
        this.bot.on("msg:text", async (ctx: any, next: NextFunction) => {
            if (ctx.session.dialog.current?.data?.expectInput) {
                ctx.session.dialog.current.data.payload = ctx.msg.text;
            }
            await next();
        });
        this.bot.use(dialogsRouter.middleware());
        this.bot.catch(async (err: BotError<BotContext>) => {
            const ctx = err.ctx;
            console.error(`Error while handling update ${ctx.update.update_id}:`);
            const e = err.error;
            if (e instanceof GrammyError) {
                logger.error("Error in request:", e.description);
            } else if (e instanceof HttpError) {
                logger.error("Could not contact Telegram:", e);
            } else {
                logger.error("Unknown error:", e);
            }
            await ctx.reply(ctx.i18n.t("failed", { error: err.message ?? "" }));
        });
        this.addOnStartedHandler(this.onStarted);
    }

    async onStarted() {
        /* const queueKey = this.name;

        this.createQueue(queueKey);

        this.createWorker(queueKey, this.checkNotifications);

        await this.addJob(queueKey, JobTypes.checkNotifications, null, {
            repeat: {
                //cron: "*/ //5 * * * * *"
        /*      },
            attempts: 10,
            backoff: { type: "exponential", delay: 60000 },
            removeOnComplete: 1,
            removeOnFail: 10
        }); */

        await this.bot.start();
    }

    async checkNotifications() {
        try {
            const notifications = await this.db.pg.any<Notification<any> & { telegramId: number }[]>(sql`
            SELECT u.telegram_id, n.* FROM notifications n, users u
            WHERE n.user_id = u.id 
            AND n.send_telegram = true
            AND u.status > 0
            AND u.telegram_id is not null
            ORDER BY timestamp; 
            `);

            for (const notification of notifications) {
                try {
                    let messageToSend;
                    switch (notification.type) {
                        case "user.trade":
                            messageToSend = handleUserTrade.call(this, notification);
                            break;
                        case "user_portfolio.builded":
                            messageToSend = handleUserPortfolioBuilded.call(this, notification);
                            break;
                        case "user_portfolio.build_error":
                            messageToSend = handleUserPortfolioBuildError.call(this, notification);
                            break;
                        case "user_portfolio.status":
                            messageToSend = handleUserPortfolioStatus.call(this, notification);
                            break;
                        case "user_ex_acc.error":
                            messageToSend = handleUserExAccError.call(this, notification);
                            break;
                        case "user-robot.error":
                            messageToSend = handleUserRobotError.call(this, notification);
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
                            continue;
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
        }
    }

    async sendMessage({ telegramId, message }: { telegramId: number; message: string }) {
        try {
            this.log.debug(`Sending ${message} to ${telegramId}`);
            await this.bot.api.sendMessage(telegramId, message, {
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
                }
                return { success: true };
            }
            return { success: false };
        } catch (e) {
            this.log.error(e);
            return { success: false, error: e.message };
        }
    }

    async startHandler(ctx: any, next: NextFunction) {
        logger.debug("start");
        ctx.session.dialog.current = null;

        await this.mainMenu(ctx);
        await next();
        // return this.mainMenu(ctx);
    }

    async mainMenu(ctx: BotContext) {
        ctx.session.dialog.current = null;
        if (!ctx.session?.user) {
            await ctx.reply(ctx.i18n.t("menu"), {
                reply_markup: getStartKeyboard(ctx)
            });
        } else {
            await ctx.reply(ctx.i18n.t("menu"), { reply_markup: getMainKeyboard(ctx) });
        }
    }

    async defaultHandler(ctx: BotContext) {
        if (!ctx.session?.user) {
            await ctx.reply(ctx.i18n.t("defaultHandler"), {
                reply_markup: getStartKeyboard(ctx)
            });
        } else {
            await ctx.reply(ctx.i18n.t("defaultHandler"), { reply_markup: getMainKeyboard(ctx) });
        }
    }
}
