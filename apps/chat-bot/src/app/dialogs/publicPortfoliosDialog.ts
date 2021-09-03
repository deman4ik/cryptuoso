import logger from "@cryptuoso/logger";
import {
    ActionTypes,
    ActivityFactory,
    CardFactory,
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
import PortfolioCard from "./portfolioCard.json";
import * as ACData from "adaptivecards-templating";
import { PortfolioOptionDialog, PORTFOLIO_OPTION_DIALOG } from "./portfolioOptionDialog";
import { ChooseExchangeDialog, CHOOSE_EXCHANGE_DIALOG } from "./chooseExchangeDialog";
import { PerformanceVals } from "@cryptuoso/trade-stats";
import { getEquityChartUrl } from "@cryptuoso/quickchart";
import { PortfolioSettings } from "@cryptuoso/portfolio-state";

export const PUBLIC_PORTFOLIOS_DIALOG = "PublicPortfolios";
const PORTFOLIO_ACTION_PROMPT = "PORTFOLIO_ACTION_PROMPT";
const PORTFOLIO_WATERFALL_DIALOG = "PORTFOLIO_WATERFALL_DIALOG";

export class PublicPortfoliosDialog extends ComponentDialog {
    private user: StatePropertyAccessor<ChatUser>;
    private userProps: StatePropertyAccessor<{ exchange: string }>;
    lg: MultiLanguageLG;
    gqlClient: GraphQLClient;

    constructor(userState: UserState, gqlClient: GraphQLClient) {
        super(PUBLIC_PORTFOLIOS_DIALOG);
        this.gqlClient = gqlClient;
        this.user = userState.createProperty<ChatUser>("user");
        this.userProps = userState.createProperty("props");
        const filesPerLocale = new Map();
        filesPerLocale.set("", `${__dirname}/assets/lg/en/portfolio.lg`);
        filesPerLocale.set("ru", `${__dirname}/assets/lg/ru/portfolio.lg`);
        this.lg = new MultiLanguageLG(undefined, filesPerLocale);

        this.addDialog(new ChoicePrompt(PORTFOLIO_ACTION_PROMPT));
        this.addDialog(new PortfolioOptionDialog(this.lg));
        this.addDialog(new ChooseExchangeDialog(this.userProps, this.gqlClient, this.lg));
        this.addDialog(
            new WaterfallDialog(PORTFOLIO_WATERFALL_DIALOG, [
                this.exchangeStep.bind(this),
                this.optionsStep.bind(this),
                this.portfolioStep.bind(this),
                this.portfolioActionsStep.bind(this)
            ])
        );

        this.initialDialogId = PORTFOLIO_WATERFALL_DIALOG;
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

    private async exchangeStep(stepContext: WaterfallStepContext) {
        return await stepContext.beginDialog(CHOOSE_EXCHANGE_DIALOG, { saveExchange: false });
    }

    private async optionsStep(stepContext: WaterfallStepContext) {
        await this.userProps.set(stepContext.context, { exchange: stepContext.result });
        return await stepContext.beginDialog(PORTFOLIO_OPTION_DIALOG);
    }

    private async portfolioStep(stepContext: WaterfallStepContext) {
        //await stepContext.context.sendActivity("ok");
        //
        const props = await this.userProps.get(stepContext.context);
        const options: { [key: string]: boolean } = {
            profit: false,
            risk: false,
            moneyManagement: false,
            winRate: false,
            efficiency: false
        };

        for (const option of stepContext.result as string[]) {
            options[option] = true;
        }
        const params = {
            exchange: props.exchange,
            ...options
        };
        const { portfolios } = await this.gqlClient.request<{
            portfolios: {
                exchange: string;
                stats: {
                    netProfit: number;
                    percentNetProfit: number;
                    winRate: number;
                    maxDrawdown: number;
                    maxDrawdownDate: string;
                    payoffRatio: number;
                    sharpeRatio: number;
                    recoveyFactor: number;
                    avgTradesCount: number;
                    equityAvg: PerformanceVals;
                    firstPosition: {
                        entryDate: string;
                    };
                };
                limits: {
                    minBalance: number;
                };
                settings: PortfolioSettings;
            }[];
        }>(
            stepContext.context,
            gql`
                query publicPortfolios(
                    $exchange: String!
                    $risk: Boolean!
                    $profit: Boolean!
                    $winRate: Boolean!
                    $efficiency: Boolean!
                    $moneyManagement: Boolean!
                ) {
                    portfolios: v_portfolios(
                        where: {
                            exchange: { _eq: $exchange }
                            option_risk: { _eq: $risk }
                            option_profit: { _eq: $profit }
                            option_win_rate: { _eq: $winRate }
                            option_efficiency: { _eq: $efficiency }
                            option_money_management: { _eq: $moneyManagement }
                            status: { _eq: "started" }
                            base: { _eq: true }
                        }
                        limit: 1
                    ) {
                        exchange
                        stats {
                            netProfit: net_profit
                            percentNetProfit: percent_net_profit
                            winRate: win_rate
                            maxDrawdown: max_drawdown
                            maxDrawdownDate: max_drawdown_date
                            payoffRatio: payoff_ratio
                            sharpeRatio: sharpe_ratio
                            recoveyFactor: recovery_factor
                            avgTradesCount: avg_trades_count_years
                            equityAvg: equity_avg
                            firstPosition: first_position
                        }
                        limits
                        settings
                    }
                }
            `,
            params
        );
        const [portfolio] = portfolios;

        const choices = [
            {
                value: "subscribe",
                action: {
                    type: ActionTypes.ImBack,
                    title: this.lg.generate("Subscribe"),
                    value: "subscribe"
                }
            }
        ];

        const card = CardFactory.heroCard(
            this.lg.generate("PortfolioInfo", {
                exchange: portfolio.exchange,
                options: Object.entries(portfolio.settings.options)
                    .filter(([, value]) => !!value)
                    .map(([key]) => this.lg.generate(key))
                    .join(", ")
            }),
            CardFactory.images([await getEquityChartUrl(portfolio.stats.equityAvg)]),
            CardFactory.actions(choices.map((c) => c.action))
        );
        await stepContext.context.sendActivity({ attachments: [card] });
        return await stepContext.prompt(PORTFOLIO_ACTION_PROMPT, {
            choices
        });
    }

    private async portfolioActionsStep(stepContext: WaterfallStepContext) {
        logger.debug(stepContext.options);
        logger.debug(stepContext.values);
        logger.debug(stepContext.result);
        return await stepContext.endDialog();
    }
}
