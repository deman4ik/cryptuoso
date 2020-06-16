import { logger, Logger } from "./logger";

describe("logger", () => {
    it("should work", () => {
        expect(logger instanceof Logger).toBeTruthy();
    });
});
