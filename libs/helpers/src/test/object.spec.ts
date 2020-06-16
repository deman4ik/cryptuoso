import { keysToUnderscore, keysToCamelCase } from "../lib/object";

describe("Test 'object' utils", () => {
    describe("Test 'keysToCamelCase'", () => {
        it("Should camel case object keys", () => {
            const obj = {
                foo: "bar",
                foo_tar: "foo_tar",
                bars: "FOOS"
            };

            const result = keysToCamelCase(obj);

            expect(result).toStrictEqual({
                foo: "bar",
                fooTar: "foo_tar",
                bars: "FOOS"
            });
        });
        it("Should camel case object keys in array", () => {
            const obj = {
                foo: "bar",
                foo_tar: "foo_tar",
                bars: "FOOS"
            };
            const arr = [obj, obj];

            const result = keysToCamelCase(arr);
            expect(result).toStrictEqual([
                {
                    foo: "bar",
                    fooTar: "foo_tar",
                    bars: "FOOS"
                },
                {
                    foo: "bar",
                    fooTar: "foo_tar",
                    bars: "FOOS"
                }
            ]);
        });
    });
    describe("Test 'keysToUnderscore'", () => {
        it("Should underscore object keys", () => {
            const obj = {
                foo: "bar",
                fooTar: "foo_tar",
                BARS: "FOOS"
            };

            const result = keysToUnderscore(obj);
            expect(result).toStrictEqual({
                foo: "bar",
                foo_tar: "foo_tar",
                bars: "FOOS"
            });
        });
        it("Should underscore object keys in array", () => {
            const obj = {
                foo: "bar",
                fooTar: "foo_tar",
                BARS: "FOOS"
            };
            const arr = [obj, obj];

            const result = keysToUnderscore(arr);
            expect(result).toStrictEqual([
                {
                    foo: "bar",
                    foo_tar: "foo_tar",
                    bars: "FOOS"
                },
                {
                    foo: "bar",
                    foo_tar: "foo_tar",
                    bars: "FOOS"
                }
            ]);
        });
    });
});
