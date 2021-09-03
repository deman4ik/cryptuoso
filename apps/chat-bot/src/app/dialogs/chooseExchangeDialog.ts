import logger from "@cryptuoso/logger";
import { ActionTypes, ActivityFactory, CardFactory, StatePropertyAccessor, TurnContext } from "botbuilder";
import {
    Choice,
    ChoiceFactory,
    ChoicePrompt,
    ComponentDialog,
    DialogSet,
    DialogTurnStatus,
    ListStyle,
    TextPrompt,
    WaterfallDialog,
    WaterfallStepContext
} from "botbuilder-dialogs";
import { MultiLanguageLG } from "botbuilder-lg";
import { gql, GraphQLClient } from "../data/graphql-client";

const EXCHANGE_CHOICE_PROMPT = "EXCHANGE_CHOICE_PROMPT";
const CHOOSE_EXCHANGE_WATERFALL_DIALOG = "CHOOSE_EXCHANGE_WATERFALL_DIALOG";
export const CHOOSE_EXCHANGE_DIALOG = "CHOOSE_EXCHANGE_DIALOG";

export class ChooseExchangeDialog extends ComponentDialog {
    private userProps: StatePropertyAccessor<{ exchange: string }>;
    lg: MultiLanguageLG;
    gqlClient: GraphQLClient;

    constructor(userProps: StatePropertyAccessor<{ exchange: string }>, gqlClient: GraphQLClient, lg: MultiLanguageLG) {
        super(CHOOSE_EXCHANGE_DIALOG);
        this.userProps = userProps;
        this.gqlClient = gqlClient;
        this.lg = lg;
        this.addDialog(new ChoicePrompt(EXCHANGE_CHOICE_PROMPT));
        this.addDialog(
            new WaterfallDialog(CHOOSE_EXCHANGE_WATERFALL_DIALOG, [
                this.exchangeStep.bind(this),
                this.confirmStep.bind(this)
            ])
        );

        this.initialDialogId = CHOOSE_EXCHANGE_WATERFALL_DIALOG;
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

    private async exchangeStep(stepContext: WaterfallStepContext<{ saveExchange: boolean }>) {
        if (stepContext.options?.saveExchange) {
            const props = await this.userProps.get(stepContext.context);
            if (props?.exchange) return await stepContext.continueDialog();
        }
        const { exchanges } = await this.gqlClient.request<{ exchanges: { code: string; name: string }[] }>(
            stepContext.context,
            gql`
                query {
                    exchanges {
                        code
                        name
                    }
                }
            `
        );
        const card = CardFactory.heroCard(
            this.lg.generate("ChooseExchange"),
            null,
            CardFactory.actions(
                exchanges.map(({ code, name }) => ({
                    title: name,
                    type: ActionTypes.ImBack,
                    value: code
                }))
            )
        );
        await stepContext.context.sendActivity({ attachments: [card] });
        return await stepContext.prompt(EXCHANGE_CHOICE_PROMPT, {
            choices: exchanges.map(({ code, name }) => ({
                value: code,
                action: {
                    type: ActionTypes.ImBack,
                    title: name,
                    text: name,
                    value: name
                },
                synonyms: [name, code]
            })),
            retryPrompt: ActivityFactory.fromObject(this.lg.generate("RetryPrompt"))
        });
    }

    private async confirmStep(stepContext: WaterfallStepContext<{ saveExchange: boolean }>) {
        if (stepContext.options?.saveExchange)
            await this.userProps.set(stepContext.context, { exchange: stepContext.result.value });
        return await stepContext.endDialog(stepContext.result.value);
    }
}
