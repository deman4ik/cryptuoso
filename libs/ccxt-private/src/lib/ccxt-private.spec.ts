import { ccxtPrivate } from "./ccxt-private";

describe("ccxtPrivate", () => {
    it("should work", () => {
        expect(ccxtPrivate()).toEqual("ccxt-private");
    });
});
