import { GraphQLClient as Client, gql } from "graphql-request";
import logger from "@cryptuoso/logger";
import { GenericObject } from "@cryptuoso/helpers";
export { gql };

export class GraphQLClient {
    #client: Client;
    #refreshToken: (params: { telegramId: number }) => Promise<{ accessToken: string }>;
    constructor({
        refreshToken
    }: {
        refreshToken: (params: { telegramId: number }) => Promise<{ accessToken: string }>;
    }) {
        this.#refreshToken = refreshToken;
        this.#client = new Client(`https://${process.env.HASURA_URL}`);
    }

    get client() {
        return this.#client;
    }

    async request<T = any, V = GenericObject<any>>(
        query: any,
        variables: V,
        user: { telegramId: number; accessToken: string }
    ) {
        try {
            return this.#client.request<T, V>(query, variables, {
                authorization: `Bearer ${user.accessToken}`
            });
        } catch (err) {
            logger.error("GraphQLClient Error:", err);
            const { accessToken } = await this.#refreshToken({ telegramId: user.telegramId });
            return this.#client.request<T, V>(query, variables, {
                authorization: `Bearer ${accessToken}`
            });
        }
    }
}
