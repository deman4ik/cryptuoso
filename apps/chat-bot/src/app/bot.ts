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
import { gql, GraphQLClient } from "./data/graphql-client";
import { UserProfileSampleDialog } from "./dialogs/userProfileSampleDialog";
import { MainDialog } from "./dialogs/mainDialog";
import { ChatUser } from "./types";
import { pg, sql } from "@cryptuoso/postgres";
export class Bot extends ActivityHandler {
    private authUtils: Auth;
    private gqlClient: GraphQLClient;
    private conversationState: BotState;
    private userState: UserState;
    private userAccessor: StatePropertyAccessor<ChatUser>;
    private mainDialog: MainDialog;
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
        this.mainDialog = new MainDialog(this.userState);
        this.dialogState = this.conversationState.createProperty("DialogState");
        this.userAccessor = this.userState.createProperty<ChatUser>("user");
        this.onMessage(async (context, next) => {
            //   logger.debug("Running dialog with Message Activity.");

            //  logger.debug(context);
            await this.auth(context);
            // Run the Dialog with the new message Activity.
            //  if (context.activity.text === "card") await (this.mainDialog as MainDialog).run(context, this.dialogState);
            // else if (context.activity.text === "profile")
            await this.mainDialog.run(context, this.dialogState);
            //else context.sendActivity("Use card or profile");
            await next();
        });

        this.onMembersAdded(async (context, next) => {
            for (const idx in context.activity.membersAdded) {
                if (context.activity.membersAdded[idx].id !== context.activity.recipient.id) {
                    await this.auth(context);
                    await this.mainDialog.run(context, this.dialogState);
                }
            }
            await next();
        });
        this.onDialog(async (context, next) => {
            // logger.debug("onDialog");
            // Save any state changes. The load happened during the execution of the Dialog.
            await this.conversationState.saveChanges(context, false);
            await this.userState.saveChanges(context, false);
            await next();
        });
    }

    async auth(context: TurnContext) {
        const userExists = await this.userAccessor.get(context);
        if (userExists) return;

        let telegramId, userId;
        if (context.activity.channelId === "telegram") {
            telegramId = +context.activity.from.id;
        } else {
            userId = context.activity.from.id;
        }
        try {
            const { user: existedUser, accessToken } = await this.authUtils.refreshTokenChatBot({ telegramId, userId });
            await this.userAccessor.set(context, { ...existedUser, accessToken });
            logger.info(`User ${existedUser.id} authenticated with ${context.activity.channelId}`);
        } catch (err) {
            //TODO: login/register
            logger.error(err);
            await context.sendActivity(err.message);
            throw err;
        }
    }

    async run(context: TurnContext) {
        // logger.debug("run");
        await super.run(context);

        // Save any state changes. The load happened during the execution of the Dialog.
        await this.conversationState.saveChanges(context, false);
        await this.userState.saveChanges(context, false);
    }
}
