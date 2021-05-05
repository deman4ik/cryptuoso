import { sleep, nvl } from "../lib/misc";

describe("'misc' utils test", () => {
    describe("'sleep' test", () => {
        it("Should delay execution by specified time", async () => {
            const timeBefore = new Date().getTime();
            await sleep(1000);
            const timeAfter = new Date().getTime();
            expect(timeAfter - timeBefore >= 1000).toBe(true);
        });
    });
    describe("'nvl' test", () => {
        it("Should return default value if value is not valid", () => {
            expect(nvl(null, 0)).toBe(0);
            expect(nvl(1, 0)).toBe(1);
            expect(nvl(undefined, "defined")).toStrictEqual("defined");
        });
    });
});
