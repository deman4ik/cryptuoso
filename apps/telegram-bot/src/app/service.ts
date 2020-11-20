import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { Telegraf, Extra } from "telegraf";
import Stage from "telegraf/stage";
const { enter, leave } = Stage;
import Scene from "telegraf/scenes/base";
import TelegrafI18n, { match, reply } from "telegraf-i18n";
import Session from "telegraf-session-redis";

export type TelegramBotServiceConfig = BaseServiceConfig;

export default class TelegramBotService extends BaseService {
    bot: any;
    constructor(config?: TelegramBotServiceConfig) {
        super(config);
        try {
            this.bot = new Telegraf(process.env.BOT_TOKEN);
            this.bot.catch((err: any) => {
                this.log.error(err);
            });
            this.bot.hears(/(.*?)/, this.defaultHandler.bind(this));
        } catch (err) {
            this.log.error("Error in TelegramBotService constructor", err);
        }
    }

    async onServiceStart() {
        if (process.env.NODE_ENV === "production") {
            await this.bot.telegram.setWebhook(process.env.BOT_HOST);
            await this.bot.startWebhook("/", null, process.env.PORT);
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
