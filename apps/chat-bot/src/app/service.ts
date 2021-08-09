import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import {
    BotFrameworkAdapter,
    ConversationState,
    MemoryStorage,
    UserState,
    TurnContext,
    ActivityHandler
} from "botbuilder";
import * as restify from "restify";
import { MultiLanguageLG } from "botbuilder-lg";
import { Bot } from "./bot";

export type ChatBotServiceConfig = BaseServiceConfig;

export default class ChatBotService extends BaseService {
    bot: ActivityHandler;
    adapter: BotFrameworkAdapter;
    storage: MemoryStorage;
    conversationState: ConversationState;
    userState: UserState;
    port = 3978;
    server: restify.Server;
    lg: MultiLanguageLG;
    constructor(config?: ChatBotServiceConfig) {
        super(config);
        try {
            this.adapter = new BotFrameworkAdapter({
                appId: process.env.MicrosoftAppId,
                appPassword: process.env.MicrosoftAppPassword
            });
            this.adapter.onTurnError = this.onTurnErrorHandler;
            this.storage = new MemoryStorage(); //TODO: update to redis/pg storage
            this.conversationState = new ConversationState(this.storage);
            this.userState = new UserState(this.storage);
            const filesPerLocale = new Map();
            filesPerLocale.set("", `${__dirname}/assets/lg/en/defaultErrorHandler.lg`);
            filesPerLocale.set("ru", `${__dirname}/assets/lg/ru/defaultErrorHandler.lg`);

            this.lg = new MultiLanguageLG(undefined, filesPerLocale);
            this.bot = new Bot(this.conversationState, this.userState);
            this.server = restify.createServer();

            this.server.post("/api/messages", (req, res) => {
                // Route received a request to adapter for processing
                this.adapter.processActivity(req, res, async (turnContext) => {
                    // route to bot activity handler.
                    await this.bot.run(turnContext);
                });
            });
            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error("Error in ChatBotService constructor", err);
        }
    }
    async onServiceStart() {
        this.server.listen(this.port, "0.0.0.0", () => {
            this.log.info(`HTTP listening on ${this.port}`);
        });
    }

    onTurnErrorHandler = async (context: TurnContext, error: Error) => {
        // This check writes out errors to console log .vs. app insights.
        // NOTE: In production environment, you should consider logging this to Azure
        //       application insights.
        this.log.error(`[onTurnError] unhandled error: ${error}`);

        // Send a trace activity, which will be displayed in Bot Framework Emulator
        await context.sendTraceActivity(
            "OnTurnError Trace",
            `${error}`,
            "https://www.botframework.com/schemas/error",
            "TurnError"
        );

        // Send a message to the user
        await context.sendActivity(this.lg.generate("UnknownError", { error }));
        // Clear out state
        await this.conversationState.delete(context);
    };
}
