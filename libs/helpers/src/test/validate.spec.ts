import { ValidationSchema } from "fastest-validator";
import { validate } from "../lib/validate";

describe("validate utils test", () => {
    class MyClass {
        foo = 0;
        bar = "";
    }
    // describe("Validating correct object", () => {
    //     it("Should not throw error", () => {
    //         const obj: MyClass = { foo: 1, bar: "2" };
    //         expect(validate(obj, MySchema)).not.toThrowError();
    //     });
    // });
    // describe("Validating incorrect object", () => {
    //     it("Should throw error", () => {
    //         const obj = { foo: 1, tar: "2" };
    //         expect(validate(obj, MySchema)).toThrowError();
    //     });
    // });
});
