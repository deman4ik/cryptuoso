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
        console.error(`\n [onTurnError] unhandled error: ${error}`);

        // Send a trace activity, which will be displayed in Bot Framework Emulator
        await context.sendTraceActivity(
            "OnTurnError Trace",
            `${error}`,
            "https://www.botframework.com/schemas/error",
            "TurnError"
        );

        // Send a message to the user
        await context.sendActivity("The bot encountered an error or bug.");
        await context.sendActivity("To continue to run this bot, please fix the bot source code.");
        // Clear out state
        await this.conversationState.delete(context);
    };
}
