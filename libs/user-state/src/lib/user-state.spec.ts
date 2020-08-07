import { userState } from "./user-state";

describe("userState", () => {
    it("should work", () => {
        expect(userState()).toEqual("user-state");
    });
});
