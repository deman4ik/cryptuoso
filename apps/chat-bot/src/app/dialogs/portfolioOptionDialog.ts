import { ActionTypes, ActivityFactory, CardFactory, StatePropertyAccessor, TurnContext } from "botbuilder";
import {
    Choice,
    ChoicePrompt,
    ComponentDialog,
    DialogSet,
    DialogTurnStatus,
    ListStyle,
    WaterfallDialog,
    WaterfallStepContext
} from "botbuilder-dialogs";
import { MultiLanguageLG } from "botbuilder-lg";

const OPTIONS_CHOICE_PROMPT = "OPTIONS_CHOICE_PROMPT";
const PORTFOLIO_OPTION_WATERFALL_DIALOG = "PORTFOLIO_OPTION_WATERFALL_DIALOG";
export const PORTFOLIO_OPTION_DIALOG = "PORTFOLIO_OPTION_DIALOG";

export class PortfolioOptionDialog extends ComponentDialog {
    lg: MultiLanguageLG;
    options: string[] = ["profit", "risk", "moneyManagement", "winRate", "efficiency"];

    constructor(lg: MultiLanguageLG) {
        super(PORTFOLIO_OPTION_DIALOG);
        this.lg = lg;
        this.addDialog(new ChoicePrompt(OPTIONS_CHOICE_PROMPT));
        this.addDialog(
            new WaterfallDialog(PORTFOLIO_OPTION_WATERFALL_DIALOG, [
                this.chooseOptionsStep.bind(this),
                this.chooseOptionsLoopStep.bind(this)
            ])
        );

        this.initialDialogId = PORTFOLIO_OPTION_WATERFALL_DIALOG;
    }

    public async run(turnContext: TurnContext, accessor: StatePropertyAccessor) {
        const dialogSet = new DialogSet(accessor);
        dialogSet.add(this);

        const dialogContext = await dialogSet.createContext(turnContext);
        const results = await dialogContext.continueDialog();
        if (results?.status === DialogTurnStatus.empty) {
            await dialogContext.beginDialog(this.id);
        }
    }

    private async chooseOptionsStep(stepContext: WaterfallStepContext) {
        const list = Array.isArray(stepContext.options) ? stepContext.options : [];
        (stepContext as any).values["optionsSelected"] = list;

        const choicesList = list.length ? [...this.options.filter((s) => !list.includes(s)), "done"] : this.options;

        const choices = choicesList.map<Choice>((c) => ({
            value: c,
            action: {
                type: ActionTypes.ImBack,
                title: this.lg.generate(c),
                value: c
            }
        }));

        const card = CardFactory.heroCard(
            list.length
                ? this.lg.generate("ChooseOptionsMore", {
                      options: list.map((o) => this.lg.generate(o)).join(", ")
                  })
                : this.lg.generate("ChooseOptionsFirst"),
            null,
            CardFactory.actions(choices.map((c) => c.action))
        );
        await stepContext.context.sendActivity({ attachments: [card] });
        return await stepContext.prompt(OPTIONS_CHOICE_PROMPT, {
            choices,
            retryPrompt: ActivityFactory.fromObject(this.lg.generate("RetryPrompt"))
        });
    }

    async chooseOptionsLoopStep(stepContext: WaterfallStepContext) {
        // Retrieve their selection list, the choice they made, and whether they chose to finish.
        const list = (stepContext as any).values["optionsSelected"];
        const choice = stepContext.result;
        const done = choice.value === "done";

        if (!done) {
            // If they chose a company, add it to the list.
            list.push(choice.value);
        }

        if (done || list.length === Object.keys(this.options).length) {
            // If they're done, exit and return their list.
            return await stepContext.endDialog(list);
        } else {
            // Otherwise, repeat this dialog, passing in the list from this iteration.
            return await stepContext.replaceDialog(PORTFOLIO_OPTION_WATERFALL_DIALOG, list);
        }
    }
}
