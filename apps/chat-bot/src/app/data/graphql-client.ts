import { GraphQLClient as Client, gql } from "graphql-request";
import logger from "@cryptuoso/logger";
import { GenericObject } from "@cryptuoso/helpers";
import { StatePropertyAccessor, TurnContext } from "botbuilder";
import { ChatUser } from "../types";
import { Auth } from "@cryptuoso/auth-utils";
export { gql };

export class GraphQLClient {
    #client: Client;
    #refreshToken: Auth["refreshTokenChatBot"];
    constructor({ refreshToken }: { refreshToken: Auth["refreshTokenChatBot"] }) {
        this.#refreshToken = refreshToken;
        this.#client = new Client(`https://${process.env.HASURA_URL}`);
    }

    get client() {
        return this.#client;
    }

    async request<T = any, V = GenericObject<any>>(
        query: any,
        variables: V,
        userAccessor: StatePropertyAccessor<ChatUser>,
        context: TurnContext
    ) {
        const user = await userAccessor.get(context);
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
                const { user: existedUser, accessToken } = await this.#refreshToken(user);
                await userAccessor.set(context, { ...existedUser, accessToken });
                return this.#client.request<T, V>(query, variables, {
                    authorization: `Bearer ${accessToken}`
                });
            }
            logger.error("GraphQLClient Error:", err);
            throw err;
        }
    }
}
