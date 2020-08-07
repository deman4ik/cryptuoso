import { capitalize, toCamelCase, fromCamelCase } from "../lib/text";

describe("text utils test", () => {
    describe("'capitalize' test", () => {
        it("Should capitalize 1st char of a string", () => {
            expect(capitalize("string")).toStrictEqual("String");
        });
    });
    describe("'toCamelCase' test", () => {
        it("Should convert underscored string to camelCase", () => {
            expect(toCamelCase("underscore_key")).toStrictEqual("underscoreKey");
        });
    });
    describe("'fromCamelCase' test", () => {
        it("Should convert camelCased string to underscored string", () => {
            expect(fromCamelCase("camelCasedString")).toStrictEqual("camel_cased_string");
        });
        it("Should convert camelCased string to lowercase string", () => {
            expect(fromCamelCase("camelCasedString", "")).toStrictEqual("camelcasedstring");
        });
    });
});
