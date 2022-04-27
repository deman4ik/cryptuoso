import { GraphQLClient as Client, gql } from "graphql-request";
import logger from "@cryptuoso/logger";
import { GenericObject } from "@cryptuoso/helpers";
import { BotContext } from "../types";

export { gql };

export class GraphQLClient {
    #client: Client;
    #refreshToken: (params: { telegramId: string }) => Promise<{ user: any; accessToken: string }>;
    constructor({
        refreshToken
    }: {
        refreshToken: (params: { telegramId: string }) => Promise<{ user: any; accessToken: string }>;
    }) {
        this.#refreshToken = refreshToken;
        this.#client = new Client(`https://${process.env.HASURA_URL}`);
    }

    get client() {
        return this.#client;
    }

    async request<T = any, V = GenericObject<any>>(ctx: BotContext, query: any, variables?: V) {
        try {
            const response = await this.#client.request<T, V>(query, variables, {
                authorization: `Bearer ${ctx.session?.user?.accessToken}`
            });
            logger.debug("GraphQLClient.request response", response);
            return response;
        } catch (err) {
            if (err.message.includes("JWT")) {
                //logger.info(`Retrying to get refresh token for ${ctx.session?.user?.telegramId}`);
                const { user, accessToken } = await this.#refreshToken({ telegramId: ctx.session?.user?.telegramId });
                ctx.session.user = { ...user, accessToken };
                return this.#client.request<T, V>(query, variables, {
                    authorization: `Bearer ${accessToken}`
                });
            }
            logger.error("GraphQLClient Error:", err);
            throw new Error(JSON.parse(JSON.stringify(err))?.response?.errors[0]?.message || err.message);
        }
    }
}
