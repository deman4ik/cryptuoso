import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { Telegraf, Extra, Stage, BaseScene } from "telegraf";

import { I18n, match, reply } from "@edjopato/telegraf-i18n";
import { TelegrafSessionRedis } from "@ivaniuk/telegraf-session-redis";
import telegrafThrottler from "telegraf-throttler";
import path from "path";
import { getBackKeyboard, getMainKeyboard } from "./keyboard";
import { formatTgName } from "@cryptuoso/user-state";
import { TelegramScene, TelegramUser } from "./types";
import { sql } from "@cryptuoso/postgres";
import { registrationScene } from "./scenes/registration";

const { enter, leave } = Stage;

export type TelegramBotServiceConfig = BaseServiceConfig;

export default class TelegramBotService extends BaseService {
    bot: Telegraf<any>;
    i18n: I18n;
    session: TelegrafSessionRedis;
    constructor(config?: TelegramBotServiceConfig) {
        super(config);
        try {
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
            this.bot.use(async (ctx, next) => {
                const start = dayjs.utc();
                await next();
                const ms = dayjs.utc().diff(start, "millisecond");
                this.log.debug("Response time %sms", ms);
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
            const stage = new Stage([registrationScene(this)]);
            stage.command("cancel", leave());

            this.bot.use(stage.middleware());
            this.bot.use(this.auth.bind(this));
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
        const sessionData = ctx.session;
        if (!sessionData || !sessionData.user) {
            //   const userExists = await this.getUser(ctx.from.id);

            //*  if (userExists) ctx.session.user = userExists;
            //  else {
            await ctx.scene.leave();
            await ctx.scene.enter(TelegramScene.REGISTRATION);
            //  }
        }
        await next();
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
