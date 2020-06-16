import { dayjs } from "./dayjs";

describe("dayjs with utc plugin", () => {
    it("should work", () => {
        expect(dayjs.utc("2020-01-01").toISOString()).toEqual("2020-01-01T00:00:00.000Z");
    });
});
