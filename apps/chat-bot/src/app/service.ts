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
import { getEquityChartUrl } from "@cryptuoso/quickchart";

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
        this.log.debug(
            getEquityChartUrl([
                {
                    x: 1628278279174,
                    y: 8981.69
                },
                {
                    x: 1628290888124,
                    y: 8852.71
                },
                {
                    x: 1628300297261,
                    y: 8716.44
                },
                {
                    x: 1628309405140,
                    y: 9135.34
                },
                {
                    x: 1628321731195,
                    y: 9643.79
                },
                {
                    x: 1628331660322,
                    y: 9347.35
                },
                {
                    x: 1628339415270,
                    y: 9604.05
                },
                {
                    x: 1628352307215,
                    y: 10745.3
                },
                {
                    x: 1628363704478,
                    y: 10833.94
                },
                {
                    x: 1628376699144,
                    y: 12030.52
                },
                {
                    x: 1628389997158,
                    y: 12467.59
                },
                {
                    x: 1628396105297,
                    y: 12358.5
                },
                {
                    x: 1628406305418,
                    y: 12775.72
                },
                {
                    x: 1628415667235,
                    y: 12474.72
                },
                {
                    x: 1628426113196,
                    y: 12346.98
                },
                {
                    x: 1628435113274,
                    y: 11579.43
                },
                {
                    x: 1628445725338,
                    y: 11014.41
                },
                {
                    x: 1628457467316,
                    y: 11055.49
                },
                {
                    x: 1628466604348,
                    y: 11249.15
                },
                {
                    x: 1628478227241,
                    y: 11202.18
                },
                {
                    x: 1628491157174,
                    y: 11522.38
                },
                {
                    x: 1628499656169,
                    y: 11181.45
                },
                {
                    x: 1628512671169,
                    y: 13847.71
                },
                {
                    x: 1628524706218,
                    y: 14297.34
                },
                {
                    x: 1628535336207,
                    y: 13500.7
                },
                {
                    x: 1629206939310,
                    y: 12802.59
                },
                {
                    x: 1629216377508,
                    y: 12829.43
                },
                {
                    x: 1629227403144,
                    y: 13220.02
                },
                {
                    x: 1629239418232,
                    y: 13511.61
                },
                {
                    x: 1629254070236,
                    y: 13084.39
                },
                {
                    x: 1629264005140,
                    y: 13774.75
                },
                {
                    x: 1629272767286,
                    y: 13512.15
                },
                {
                    x: 1629282648158,
                    y: 13728.66
                },
                {
                    x: 1629292490163,
                    y: 13937.29
                },
                {
                    x: 1629302405116,
                    y: 14817.83
                },
                {
                    x: 1629311146271,
                    y: 14105.35
                },
                {
                    x: 1629320145400,
                    y: 14718.54
                },
                {
                    x: 1629330057259,
                    y: 14332.2
                },
                {
                    x: 1629340832259,
                    y: 15154.63
                },
                {
                    x: 1629352013368,
                    y: 15503.71
                },
                {
                    x: 1629360002405,
                    y: 15350.97
                },
                {
                    x: 1629375264138,
                    y: 16109.51
                },
                {
                    x: 1629385028203,
                    y: 17484.36
                },
                {
                    x: 1629397204125,
                    y: 18721.12
                },
                {
                    x: 1629411918300,
                    y: 18924.1
                },
                {
                    x: 1629424387317,
                    y: 19929.91
                },
                {
                    x: 1629436634083,
                    y: 19853.39
                },
                {
                    x: 1629447032187,
                    y: 20016.58
                },
                {
                    x: 1629457542173,
                    y: 19992.98
                },
                {
                    x: 1629472254112,
                    y: 22006.28
                },
                {
                    x: 1629472254226,
                    y: 22032.56
                }
            ])
        );
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
