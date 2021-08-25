import logger from "@cryptuoso/logger";
import { ActionTypes, ActivityFactory, StatePropertyAccessor, TurnContext, UserState } from "botbuilder";
import {
    Choice,
    ChoiceFactory,
    ChoicePrompt,
    ComponentDialog,
    ConfirmPrompt,
    DialogSet,
    DialogTurnStatus,
    ListStyle,
    NumberPrompt,
    PromptValidatorContext,
    TextPrompt,
    WaterfallDialog,
    WaterfallStepContext
} from "botbuilder-dialogs";
import { MultiLanguageLG } from "botbuilder-lg";
import { GraphQLClient } from "../data/graphql-client";
import { ChatUser } from "../types";
import { PublicPortfoliosDialog, PUBLIC_PORTFOLIOS_DIALOG } from "./publicPortfoliosDialog";

export const MAIN_DIALOG = "MAIN_DIALOG";
const MAIN_MENU_WATERFALL_DIALOG = "MAIN_MENU_WATERFALL_DIALOG";
const MENU_PROMPT = "MENU_PROMPT";
export class MainDialog extends ComponentDialog {
    #user: StatePropertyAccessor<ChatUser>;
    lg: MultiLanguageLG;
    gqlClient: GraphQLClient;
    constructor(userState: UserState, gqlClient: GraphQLClient) {
        super(MAIN_DIALOG);
        this.gqlClient = gqlClient;
        this.#user = userState.createProperty<ChatUser>("user");

        const filesPerLocale = new Map();
        filesPerLocale.set("", `${__dirname}/assets/lg/en/mainMenu.lg`);
        filesPerLocale.set("ru", `${__dirname}/assets/lg/ru/mainMenu.lg`);
        this.lg = new MultiLanguageLG(undefined, filesPerLocale);
        this.addDialog(new PublicPortfoliosDialog(userState, this.gqlClient));
        this.addDialog(new ChoicePrompt(MENU_PROMPT));
        this.addDialog(
            new WaterfallDialog(MAIN_MENU_WATERFALL_DIALOG, [
                this.initialStep.bind(this),
                this.routeStep.bind(this),
                this.finalStep.bind(this)
            ])
        );

        this.initialDialogId = MAIN_MENU_WATERFALL_DIALOG;
    }

    async run(turnContext: TurnContext, accessor: StatePropertyAccessor<any>) {
        const dialogSet = new DialogSet(accessor);
        dialogSet.add(this);

        const dialogContext = await dialogSet.createContext(turnContext);
        const results = await dialogContext.continueDialog();
        if (results.status === DialogTurnStatus.empty) {
            await dialogContext.beginDialog(this.id);
        }
    }

    async initialStep(stepContext: WaterfallStepContext) {
        const choices: Choice[] = [
            {
                value: "PublicPortfolios",
                action: {
                    type: ActionTypes.ImBack,
                    title: this.lg.generate("PublicPortfolios"),
                    value: "PublicPortfolios"
                },
                synonyms: ["portfolios", "Portfolios", "Public Portfolios", "public portfolios"]
            }
        ];
        return await stepContext.prompt(
            MENU_PROMPT,
            {
                prompt: ActivityFactory.fromObject(this.lg.generate("MainMenu")),
                retryPrompt: ActivityFactory.fromObject(this.lg.generate("MainMenuRetry"))
                // style: ListStyle.heroCard
            },
            ChoiceFactory.toChoices(choices)
        );
    }

    async routeStep(stepContext: WaterfallStepContext) {
        const choice = stepContext.result.value;
        logger.debug(choice);
        switch (choice) {
            case "PublicPortfolios":
                return await stepContext.beginDialog(PUBLIC_PORTFOLIOS_DIALOG);
            default:
                return await stepContext.replaceDialog(MAIN_DIALOG);
        }
    }

    async finalStep(stepContext: WaterfallStepContext) {
        return await stepContext.replaceDialog(MAIN_DIALOG);
    }
}
