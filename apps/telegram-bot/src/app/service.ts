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

export type TelegramBotServiceConfig = BaseServiceConfig;

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

            logger.debug(data);
            logger.debug(ctx.session.dialog.current);
            if (data && data.a && data.d) {
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
        this.bot.hears(this.i18n.t("en", "keyboards.mainKeyboard.settings"), async (ctx: any, next: NextFunction) => {
            ctx.session.dialog.current = null;
            ctx.dialog.enter(tradingActions.enter); //TODO!
            await next();
        });
        this.bot.hears(this.i18n.t("en", "keyboards.mainKeyboard.support"), async (ctx: any, next: NextFunction) => {
            ctx.session.dialog.current = null;
            ctx.dialog.enter(tradingActions.enter); //TODO!
            await next();
        });
        this.bot.hears(
            this.i18n.t("en", "keyboards.mainKeyboard.subscription"),
            async (ctx: any, next: NextFunction) => {
                ctx.session.dialog.current = null;
                ctx.dialog.enter(tradingActions.enter); //TODO!
                await next();
            }
        );
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
            //TODO!
            ctx.session.dialog.current = null;
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
        await this.bot.start();
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
