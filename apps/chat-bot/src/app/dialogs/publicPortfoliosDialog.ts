import { StatePropertyAccessor, TurnContext, UserState } from "botbuilder";
import {
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
import { ChatUser } from "../types";

export const PUBLIC_PORTFOLIOS_DIALOG = "PublicPortfolios";
const EXCHANGE_CHOICE_PROMPT = "EXCHANGE_CHOICE_PROMPT";
const OPTIONS_CHOICE_PROMPT = "OPTIONS_CHOICE_PROMPT";
const PUBLIC_PORTFOLIOS_WATERFALL_DIALOG = "PUBLIC_PORTFOLIOS_WATERFALL_DIALOG";

export class PublicPortfoliosDialog extends ComponentDialog {
    private user: StatePropertyAccessor<ChatUser>;

    constructor(user: StatePropertyAccessor<ChatUser>) {
        super(PUBLIC_PORTFOLIOS_DIALOG);
        this.user = user;
        this.addDialog(new ChoicePrompt(EXCHANGE_CHOICE_PROMPT));

        this.addDialog(new WaterfallDialog(PUBLIC_PORTFOLIOS_WATERFALL_DIALOG, [this.exchangeStep.bind(this)]));

        this.initialDialogId = PUBLIC_PORTFOLIOS_WATERFALL_DIALOG;
    }

    public async run(turnContext: TurnContext, accessor: StatePropertyAccessor) {
        const dialogSet = new DialogSet(accessor);
        dialogSet.add(this);

        const dialogContext = await dialogSet.createContext(turnContext);
        const results = await dialogContext.continueDialog();
        if (results.status === DialogTurnStatus.empty) {
            await dialogContext.beginDialog(this.id);
        }
    }

    private async exchangeStep(stepContext: WaterfallStepContext) {
        return await stepContext.prompt(EXCHANGE_CHOICE_PROMPT, {
            choices: ChoiceFactory.toChoices(["Car", "Bus", "Bicycle"]),
            prompt: "Please enter your mode of transport."
        });
    }
}
