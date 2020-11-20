import { graphqlClient } from "./graphql-client";

describe("graphqlClient", () => {
    it("should work", () => {
        expect(graphqlClient()).toEqual("graphql-client");
    });
});
