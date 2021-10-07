import { BaseError, ActionsHandlerError } from "../lib/errors";

describe("errors", () => {
    it("should generate BaseError", () => {
        const error = new BaseError("error message", { foo: "bar" }, "MY_ERROR");
        expect(error instanceof Error).toBeTruthy();
        expect(error.message).toBe("error message");
        expect(error.meta).toStrictEqual({ foo: "bar" });
        expect(error.type).toBe("MY_ERROR");
    });
    it("should generate ActionsHandlerError", () => {
        const error = new ActionsHandlerError("error message", { foo: "bar" }, "MY_ERROR", 400);
        expect(error instanceof Error).toBeTruthy();
        expect(error.message).toBe("error message");
        expect(error.meta).toStrictEqual({ foo: "bar" });
        expect(error.type).toBe("MY_ERROR");
        expect(error.statusCode).toBe(400);
        expect(error.response).toStrictEqual({
            message: "error message",
            code: "MY_ERROR"
        });
    });
});
