import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { Auth } from "@cryptuoso/auth-utils";
import { Telegraf, Extra, Stage } from "telegraf";
import Validator from "fastest-validator";
import { I18n, match, reply } from "@edjopato/telegraf-i18n";
import { TelegrafSessionRedis } from "@ivaniuk/telegraf-session-redis";
import telegrafThrottler from "telegraf-throttler";
import path from "path";
import { getBackKeyboard, getMainKeyboard } from "./keyboard";
import { formatTgName } from "@cryptuoso/user-state";
import { TelegramScene, TelegramUser } from "./types";
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
    constructor(config?: TelegramBotServiceConfig) {
        super(config);
        try {
            this.authUtils = new Auth();
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
            this.bot.use(this.auth.bind(this));

            const mainStage = new Stage([signalsScene(this)]);
            mainStage.command("cancel", leave());
            this.bot.use(mainStage.middleware());
            this.bot.start(this.start.bind(this));
            this.bot.command("menu", this.mainMenu.bind(this));
            // Main menu
            this.bot.command("menu", enter(TelegramScene.SIGNALS));
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
            ctx.scene.current.id === TelegramScene.REGISTRATION ||
            ctx.scene.current.id === TelegramScene.LOGIN ||
            ctx.scene.current.id === TelegramScene.START
        )
            return;
        const sessionData = ctx.session;
        if (!sessionData || !sessionData.user || !sessionData.accessToken) {
            try {
                const { user, accessToken } = await this.authUtils.refreshTokenTg({ telegramId: ctx.from.id });
                ctx.session.user = user;
                ctx.session.accessToken = accessToken;
            } catch (err) {
                this.log.warn("No user", err.message);
                await ctx.scene.leave();
                await ctx.scene.enter(TelegramScene.START);
            }
        } else await next();
    }

    async start(ctx: any) {
        try {
            const params = ctx.update.message.text.replace("/start ", "");
            if (params && params !== "") {
                //TODO: check registration, save scene, redirect after registration
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
            return ctx.reply(
                ctx.i18n.t("welcome", {
                    username: this.formatName(ctx)
                }),
                getMainKeyboard(ctx)
            );
        } catch (e) {
            this.log.error(e);
            return ctx.reply(ctx.i18n.t("failed"));
        }
    }

    async mainMenu(ctx: any) {
        await ctx.reply(ctx.i18n.t("menu"), getMainKeyboard(ctx));
    }

    async defaultHandler(ctx: any) {
        await ctx.reply(ctx.i18n.t("defaultHandler"), getMainKeyboard(ctx));
    }
}
