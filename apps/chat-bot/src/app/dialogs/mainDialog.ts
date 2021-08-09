import { ActionTypes, StatePropertyAccessor, TurnContext, UserState } from "botbuilder";
import {
    Choice,
    ChoiceFactory,
    ChoicePrompt,
    ComponentDialog,
    ConfirmPrompt,
    DialogSet,
    DialogTurnStatus,
    NumberPrompt,
    PromptValidatorContext,
    TextPrompt,
    WaterfallDialog,
    WaterfallStepContext
} from "botbuilder-dialogs";
import { MultiLanguageLG } from "botbuilder-lg";
import { ChatUser } from "../types";
import { PublicPortfoliosDialog, PUBLIC_PORTFOLIOS_DIALOG } from "./publicPortfoliosDialog";

export const MAIN_DIALOG = "MAIN_DIALOG";
const MAIN_MENU_WATERFALL_DIALOG = "MAIN_MENU_WATERFALL_DIALOG";
const MENU_PROMPT = "MENU_PROMPT";
export class MainDialog extends ComponentDialog {
    private user: StatePropertyAccessor<ChatUser>;
    lg: MultiLanguageLG;
    constructor(userState: UserState) {
        super(MAIN_DIALOG);

        this.user = userState.createProperty("user");
        const filesPerLocale = new Map();
        filesPerLocale.set("", `${__dirname}/assets/lg/en/mainMenu.lg`);
        filesPerLocale.set("ru", `${__dirname}/assets/lg/ru/mainMenu.lg`);
        this.lg = new MultiLanguageLG(undefined, filesPerLocale);
        this.addDialog(new PublicPortfoliosDialog(this.user));
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
                    type: ActionTypes.PostBack,
                    title: this.lg.generate("PublicPortfolios"),
                    value: "PublicPortfolios"
                }
            }
        ];
        return await stepContext.prompt(MENU_PROMPT, {
            prompt: this.lg.generate("MainMenu"),
            retryPrompt: this.lg.generate("MainMenuRetry"),
            choices
        });
    }

    async routeStep(stepContext: WaterfallStepContext) {
        const choice = stepContext.result.value;

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
