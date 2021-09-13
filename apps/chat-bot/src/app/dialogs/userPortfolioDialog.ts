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
import { PortfolioSettings, UserPortfolioState } from "@cryptuoso/portfolio-state";
import { formatExchange } from "@cryptuoso/helpers";

export const USER_PORTFOLIO_DIALOG = "MyPortfolio";
const USER_PORTFOLIO_ACTION_PROMPT = "USER_PORTFOLIO_ACTION_PROMPT";
const USER_PORTFOLIO_WATERFALL_DIALOG = "USER_PORTFOLIO_WATERFALL_DIALOG";

export class UserPortfolioDialog extends ComponentDialog {
    private user: StatePropertyAccessor<ChatUser>;
    private userProps: StatePropertyAccessor<{ exchange: string }>;
    lg: MultiLanguageLG;
    gqlClient: GraphQLClient;

    constructor(userState: UserState, gqlClient: GraphQLClient) {
        super(USER_PORTFOLIO_DIALOG);
        this.gqlClient = gqlClient;
        this.user = userState.createProperty<ChatUser>("user");
        this.userProps = userState.createProperty("props");
        const filesPerLocale = new Map();
        filesPerLocale.set("", `${__dirname}/assets/lg/en/portfolio.lg`);
        filesPerLocale.set("ru", `${__dirname}/assets/lg/ru/portfolio.lg`);
        this.lg = new MultiLanguageLG(undefined, filesPerLocale);

        this.addDialog(new ChoicePrompt(USER_PORTFOLIO_ACTION_PROMPT));
        this.addDialog(
            new WaterfallDialog(USER_PORTFOLIO_WATERFALL_DIALOG, [
                this.userPortfolioStep.bind(this),
                this.userPortfolioActionsStep.bind(this)
            ])
        );

        this.initialDialogId = USER_PORTFOLIO_WATERFALL_DIALOG;
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

    private async userPortfolioStep(stepContext: WaterfallStepContext) {
        const user = await this.user.get(stepContext.context);
        const { myPortfolio } = await this.gqlClient.request<{
            myPortfolio: {
                exchange: UserPortfolioState["exchange"];
                type: UserPortfolioState["type"];
                status: UserPortfolioState["status"];
                startedAt: UserPortfolioState["startedAt"];
                stoppedAt: UserPortfolioState["stoppedAt"];
                message: UserPortfolioState["message"];
                settings: PortfolioSettings;
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
                    recommendedBalance: number;
                };
            }[];
        }>(
            stepContext.context,
            gql`
                query myPortfolio($userId: uuid!) {
                    myPortfolio: v_user_portfolios(where: { user_id: { _eq: $userId } }) {
                        exchange
                        type
                        status
                        startedAt: started_at
                        stoppedAt: stopped_at
                        message
                        settings: user_portfolio_settings
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
                    }
                }
            `,
            {
                userId: user.id
            }
        );
        const [portfolio] = myPortfolio;

        const choices = [
            {
                value: "start",
                action: {
                    type: ActionTypes.ImBack,
                    title: this.lg.generate("Start"),
                    value: "start"
                }
            },
            {
                value: "stop",
                action: {
                    type: ActionTypes.ImBack,
                    title: this.lg.generate("Stop"),
                    value: "stop"
                }
            },
            {
                value: "Edit",
                action: {
                    type: ActionTypes.ImBack,
                    title: this.lg.generate("Edit"),
                    value: "edit"
                }
            },
            {
                value: "delete",
                action: {
                    type: ActionTypes.ImBack,
                    title: this.lg.generate("Delete"),
                    value: "delete"
                }
            }
        ];

        const card = CardFactory.heroCard(
            this.lg.generate("MyPortfolioInfo", {
                exchange: formatExchange(portfolio.exchange),
                options: Object.entries(portfolio.settings.options)
                    .filter(([, value]) => !!value)
                    .map(([key]) => this.lg.generate(key))
                    .join(", ")
            }),
            CardFactory.images([await getEquityChartUrl(portfolio.stats.equityAvg)]),
            CardFactory.actions(choices.map((c) => c.action)),
            {
                text: this.lg.generate("MyPortfolioInfo", {
                    exchange: formatExchange(portfolio.exchange),
                    options: Object.entries(portfolio.settings.options)
                        .filter(([, value]) => !!value)
                        .map(([key]) => this.lg.generate(key))
                        .join(", ")
                })
            }
        );
        await stepContext.context.sendActivity({ attachments: [card] });
        return await stepContext.prompt(USER_PORTFOLIO_ACTION_PROMPT, {
            choices,

            style: ListStyle.none
        });
    }

    private async userPortfolioActionsStep(stepContext: WaterfallStepContext) {
        logger.debug(stepContext.options);
        logger.debug(stepContext.values);
        logger.debug(stepContext.result);
        return await stepContext.endDialog();
    }
}
