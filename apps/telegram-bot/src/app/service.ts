import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { Telegraf, Extra, Stage, BaseScene } from "telegraf";

import { I18n, match, reply } from "@edjopato/telegraf-i18n";
import { TelegrafSessionRedis } from "@ivaniuk/telegraf-session-redis";

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
            this.session = new TelegrafSessionRedis({
                client: this.redis
            });
            this.bot.use(this.session.middleware());

            this.i18n = new I18n({
                defaultLanguage: "en",
                useSession: true,
                defaultLanguageOnMissing: true
                //directory: path.resolve(process.cwd(), "state/telegram/locales")
            });
            this.bot.use(this.i18n.middleware());
            // Create scene manager
            const stage = new Stage([]);
            stage.command("cancel", leave());

            this.bot.use(async (ctx, next) => {
                const start = dayjs.utc();
                await next();
                const ms = dayjs.utc().diff(start, "millisecond");
                this.log.debug("Response time %sms", ms);
            });
            this.bot.use(stage.middleware());

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

    async defaultHandler(ctx: any) {
        await ctx.reply("pong");
    }
}
