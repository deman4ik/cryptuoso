import { ValidationSchema } from "fastest-validator";
import { validate } from "../lib/validate";

describe("validate utils test", () => {
    const Schema: ValidationSchema = {
        foo: "number",
        bar: "string",
        tar: { type: "object", optional: true }
    };
    describe("Validating correct object", () => {
        it("Should not throw error", () => {
            const obj = { foo: 123, bar: "string" };
            expect(() => validate(obj, Schema)).not.toThrowError();
        });
        it("Should not throw error", () => {
            const obj = { foo: 0, bar: "", tar: {} };
            expect(() => validate(obj, Schema)).not.toThrowError();
        });
    });
    describe("Validating incorrect object", () => {
        const obj = { foo: 1, tar: "2" };
        it("Should throw error", () => {
            expect(() => validate(obj, Schema)).toThrowError();
        });
        it("Should catch an error and return an error message", () => {
            try {
                validate(obj, Schema);
            } catch (err) {
                expect(err && err.message.length > 0);
            }
        });
    });
});
