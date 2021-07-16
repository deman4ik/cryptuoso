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

export class MainDialog extends ComponentDialog {
    private user: StatePropertyAccessor<any>;

    constructor(userState: UserState) {
        super("mainDialog");

        this.user = userState.createProperty("user");
    }
}
