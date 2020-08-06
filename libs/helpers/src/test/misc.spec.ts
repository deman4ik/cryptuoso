import { sleep, defaultValue } from "../lib/misc";

describe("'misc' utils test", () => {
    describe("'sleep' test", () => {
        it("Should delay execution by specified time", async () => {
            const timeBefore = new Date().getTime();
            await sleep(1000);
            const timeAfter = new Date().getTime();
            expect(timeAfter - timeBefore >= 1000).toBe(true);
        });
    });
    describe("'defaultValue' test", () => {
        it("Should return default value if value is not valid", () => {
            expect(defaultValue(null, 0)).toBe(0);
            expect(defaultValue(1, 0)).toBe(1);
            expect(defaultValue(undefined, "defined")).toStrictEqual("defined");
        });
    });
});
