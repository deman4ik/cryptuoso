import { GraphQLClient as Client, gql } from "graphql-request";
import logger from "@cryptuoso/logger";
import { GenericObject } from "@cryptuoso/helpers";
import { StatePropertyAccessor, TurnContext, UserState } from "botbuilder";
import { ChatUser } from "../types";
import { Auth } from "@cryptuoso/auth-utils";
export { gql };

export class GraphQLClient {
    #client: Client;
    #refreshTokenFunction: Auth["refreshTokenChatBot"];
    #user: StatePropertyAccessor<ChatUser>;
    constructor({
        refreshTokenFunction,
        userState
    }: {
        refreshTokenFunction: Auth["refreshTokenChatBot"];
        userState: UserState;
    }) {
        this.#refreshTokenFunction = refreshTokenFunction;
        this.#user = userState.createProperty<ChatUser>("user");
        this.#client = new Client(`https://${process.env.HASURA_URL}`);
    }

    get client() {
        return this.#client;
    }

    async request<T = any, V = GenericObject<any>>(context: TurnContext, query: any, variables: V = null) {
        const user = await this.#user.get(context);
        try {
            logger.debug("GraphQLClient.request vars", variables);

            const response = await this.#client.request<T, V>(query, variables, {
                authorization: `Bearer ${user?.accessToken}`
            });
            logger.debug("GraphQLClient.request response", response);
            return response;
        } catch (err) {
            if (err.message.includes("JWT")) {
                logger.info(`Retrying to get refresh token for ${user?.telegramId}`);
                const { user: existedUser, accessToken } = await this.#refreshTokenFunction(user);
                await this.#user.set(context, { ...existedUser, accessToken });
                return this.#client.request<T, V>(query, variables, {
                    authorization: `Bearer ${accessToken}`
                });
            }
            logger.error("GraphQLClient Error:", err);
            throw err;
        }
    }
}
