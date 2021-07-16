// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import {
    BotState,
    CardFactory,
    ActivityHandler,
    StatePropertyAccessor,
    ConversationState,
    UserState,
    TurnContext
} from "botbuilder";
import { Dialog, DialogState } from "botbuilder-dialogs";
import { CardsSampleDialog } from "./dialogs/cardsSampleDialog";
import logger from "@cryptuoso/logger";
import { Auth } from "@cryptuoso/auth-utils";
import { gql, GraphQLClient } from "./graphql-client";
import { UserProfileSampleDialog } from "./dialogs/userProfileSampleDialog";
import { ChatUser } from "./types";
export class Bot extends ActivityHandler {
    private authUtils: Auth;
    private gqlClient: GraphQLClient;
    private conversationState: BotState;
    private userState: UserState;
    private userAccessor: StatePropertyAccessor<ChatUser>;
    private mainDialog: Dialog;
    private dialogState: StatePropertyAccessor<DialogState>;
    /**
     *
     * @param {ConversationState} conversationState
     * @param {UserState} userState
     * @param {Dialog} dialog
     */
    constructor(conversationState: BotState, userState: UserState) {
        super();
        if (!conversationState) throw new Error("[Bot]: Missing parameter. conversationState is required");
        if (!userState) throw new Error("[Bot]: Missing parameter. userState is required");
        this.authUtils = new Auth();
        this.gqlClient = new GraphQLClient({
            refreshToken: this.authUtils.refreshTokenChatBot.bind(this.authUtils)
        });
        this.conversationState = conversationState as ConversationState;
        this.userState = userState;
        //this.mainDialog = new MainDialog();
        this.mainDialog = new UserProfileSampleDialog(this.userState);
        this.dialogState = this.conversationState.createProperty("DialogState");
        this.userAccessor = this.userState.createProperty<ChatUser>("user");
        this.onMessage(async (context, next) => {
            logger.debug("Running dialog with Message Activity.");

            logger.debug(context);
            const from = context.activity.from.id;
            // Run the Dialog with the new message Activity.
            //  if (context.activity.text === "card") await (this.mainDialog as MainDialog).run(context, this.dialogState);
            // else if (context.activity.text === "profile")
            await (this.mainDialog as UserProfileSampleDialog).run(context, this.dialogState);
            //else context.sendActivity("Use card or profile");
            await next();
        });

        this.onDialog(async (context, next) => {
            logger.debug("onDialog");
            // Save any state changes. The load happened during the execution of the Dialog.
            await this.conversationState.saveChanges(context, false);
            await this.userState.saveChanges(context, false);
            await next();
        });
    }

    async auth(context: TurnContext) {
        const user = await this.userAccessor.get(context);
        if (user) return user;

        if (context.activity.channelId === "telegram") {
            const telegramId = context.activity.from.id;
        }
    }

    async run(context: TurnContext) {
        logger.debug("run");
        await super.run(context);

        // Save any state changes. The load happened during the execution of the Dialog.
        await this.conversationState.saveChanges(context, false);
        await this.userState.saveChanges(context, false);
    }
}
