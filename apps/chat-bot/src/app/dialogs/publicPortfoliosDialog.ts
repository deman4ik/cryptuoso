import logger from "@cryptuoso/logger";
import {
    ActionTypes,
    ActivityFactory,
    MessageFactory,
    StatePropertyAccessor,
    TurnContext,
    UserState
} from "botbuilder";
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
import { gql, GraphQLClient } from "../data/graphql-client";
import { ChatUser } from "../types";

export const PUBLIC_PORTFOLIOS_DIALOG = "PublicPortfolios";
const EXCHANGE_CHOICE_PROMPT = "EXCHANGE_CHOICE_PROMPT";
const OPTIONS_CHOICE_PROMPT = "OPTIONS_CHOICE_PROMPT";
const PORTFOLIO_OPTION_WATERFALL_DIALOG = "PORTFOLIO_OPTION_WATERFALL_DIALOG";
const PORTFOLIO_EXCHANGE_WATERFALL_DIALOG = "PORTFOLIO_EXCHANGE_WATERFALL_DIALOG";
const PUBLIC_PORTFOLIOS_WATERFALL_DIALOG = "PUBLIC_PORTFOLIOS_WATERFALL_DIALOG";

export class PublicPortfoliosDialog extends ComponentDialog {
    private user: StatePropertyAccessor<ChatUser>;
    private userProps: StatePropertyAccessor<{ exchange: string }>;
    lg: MultiLanguageLG;
    gqlClient: GraphQLClient;
    options: string[];

    constructor(userState: UserState, gqlClient: GraphQLClient) {
        super(PUBLIC_PORTFOLIOS_DIALOG);
        this.gqlClient = gqlClient;
        this.user = userState.createProperty<ChatUser>("user");
        this.userProps = userState.createProperty("props");
        const filesPerLocale = new Map();
        filesPerLocale.set("", `${__dirname}/assets/lg/en/portfolio.lg`);
        filesPerLocale.set("ru", `${__dirname}/assets/lg/ru/portfolio.lg`);
        this.lg = new MultiLanguageLG(undefined, filesPerLocale);
        this.options = ["profit", "risk", "moneyManagement", "winRate", "efficiency"];

        this.addDialog(new ChoicePrompt(EXCHANGE_CHOICE_PROMPT));
        this.addDialog(new ChoicePrompt(OPTIONS_CHOICE_PROMPT));
        this.addDialog(
            new WaterfallDialog(PORTFOLIO_OPTION_WATERFALL_DIALOG, [
                this.chooseOptionsStep.bind(this),
                this.chooseOptionsLoopStep.bind(this)
            ])
        );
        this.addDialog(
            new WaterfallDialog(PORTFOLIO_EXCHANGE_WATERFALL_DIALOG, [
                this.exchangeStep.bind(this),
                this.optionsStep.bind(this)
            ])
        );
        this.addDialog(new WaterfallDialog(PUBLIC_PORTFOLIOS_WATERFALL_DIALOG, [this.portfolioStep.bind(this)]));

        this.initialDialogId = PORTFOLIO_EXCHANGE_WATERFALL_DIALOG;
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
        const props = await this.userProps.get(stepContext.context);
        if (props && props?.exchange) return await stepContext.continueDialog();
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
        return await stepContext.prompt(EXCHANGE_CHOICE_PROMPT, {
            choices: ChoiceFactory.toChoices(
                exchanges.map(({ code, name }) => ({
                    value: code,
                    action: {
                        type: ActionTypes.ImBack,
                        title: name,
                        value: code
                    },
                    synonyms: [name]
                }))
            ),
            prompt: ActivityFactory.fromObject(this.lg.generate("ChooseExchange")),
            retryPrompt: ActivityFactory.fromObject(this.lg.generate("RetryPrompt"))
            //  style: ListStyle.heroCard
        });
    }

    private async optionsStep(stepContext: WaterfallStepContext) {
        await this.userProps.set(stepContext.context, { exchange: stepContext.result });
        return await stepContext.replaceDialog(PORTFOLIO_OPTION_WATERFALL_DIALOG);
    }

    private async portfolioStep(stepContext: WaterfallStepContext) {
        logger.debug(stepContext.options);
        logger.debug(stepContext.values);
        return await stepContext.context.sendActivity("Ok portfolio time");
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
        return await stepContext.prompt(OPTIONS_CHOICE_PROMPT, {
            choices,
            prompt: list.length
                ? ActivityFactory.fromObject(
                      this.lg.generate("ChooseOptionsMore", {
                          options: list.map((o) => this.lg.generate(o)).join(", ")
                      })
                  )
                : ActivityFactory.fromObject(this.lg.generate("ChooseOptionsFirst")),
            retryPrompt: ActivityFactory.fromObject(this.lg.generate("RetryPrompt"))
            //   style: ListStyle.heroCard
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
            return await stepContext.replaceDialog(PUBLIC_PORTFOLIOS_WATERFALL_DIALOG, list);
        } else {
            // Otherwise, repeat this dialog, passing in the list from this iteration.
            return await stepContext.replaceDialog(PORTFOLIO_OPTION_WATERFALL_DIALOG, list);
        }
    }
}
