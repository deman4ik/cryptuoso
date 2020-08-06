/* eslint-disable @typescript-eslint/camelcase */
import {
    keysToUnderscore,
    keysToCamelCase,
    equals,
    deepMapKeys,
    datesToISOString,
    flattenObject,
    flatten,
    valuesString,
    JSONParse
} from "../lib/object";

describe("Test 'object' utils", () => {
    describe("Test 'deepMapKeys'", () => {
        const obj = {
            foo: "1",
            nested: {
                child: {
                    withArray: [
                        {
                            grandChild: ["hello"]
                        }
                    ]
                }
            }
        };
        expect(deepMapKeys(obj, (key) => key.toUpperCase())).toStrictEqual({
            FOO: "1",
            NESTED: {
                CHILD: {
                    WITHARRAY: [
                        {
                            GRANDCHILD: ["hello"]
                        }
                    ]
                }
            }
        });
    });

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

    describe("Test 'datesToISOString'", () => {
        const arr = [new Date(0), new Date("1998-02-18"), 123, null];
        it("Should convert legal dates to ISO strings", () => {
            expect(datesToISOString(arr)).toStrictEqual([
                "1970-01-01T00:00:00.000Z",
                "1998-02-18T00:00:00.000Z",
                123,
                null
            ]);
        });
    });

    describe("Test 'equals'", () => {
        describe("Test the same object", () => {
            it("Should return true", () => {
                const obj = { a: [2, { e: 3 }], b: [4], c: "foo" };

                expect(equals(obj, obj)).toBe(true);
            });
        });
        describe("Test object and array that are equal", () => {
            it("Should return true", () => {
                expect(equals([1, 2, 3], { 0: 1, 1: 2, 2: 3 })).toBe(true);
            });
        });
        describe("Test two different objects", () => {
            it("Should return false", () => {
                expect(equals({ a: 1, b: 2, c: 3 }, { a: [1], b: "2", c: null })).toBe(false);
            });
        });
    });

    describe("Test 'flattenObject'", () => {
        it("Should flatten provided object", () => {
            expect(flattenObject({ a: { b: { c: 5 } }, b: 5, c: { a: 2 } })).toStrictEqual({
                "a.b.c": 5,
                b: 5,
                "c.a": 2
            });
        });
    });

    describe("Test 'flatten'", () => {
        it("Should flatten provided object", () => {
            expect(flatten({ a: { b: { c: 5 } }, b: 5, c: { a: 2 } })).toStrictEqual({
                "a.b.c": 5,
                b: 5,
                "c.a": 2
            });
        });
    });

    describe("Test 'valuesString'", () => {
        it("Should extract values from the object and return a string", () => {
            expect(valuesString({ a: { b: { c: 5 } }, b: 5, c: { a: 2 } })).toStrictEqual("5 5 2");
            expect(valuesString({ a: { b: { c: 5 } }, b: 5, c: { a: 2 } }, "_")).toStrictEqual("5_5_2");
        });
    });
});
