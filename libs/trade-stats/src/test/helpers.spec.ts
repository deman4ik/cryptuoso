import { createDatesPeriod } from "../lib/helpers";

describe("Test 'helpers'", () => {
    describe("Test createDatesPeriod", () => {
        it("Should create correct period", async () => {
            const result = createDatesPeriod("2020-03-30T00:00:00.000Z", "2020-05-01T00:00:00.000Z", "month");
            expect(result).toEqual([
                {
                    key: "2020.3",
                    year: 2020,
                    quarter: null,
                    month: 3,
                    dateFrom: "2020-03-01T00:00:00.000Z",
                    dateTo: "2020-03-31T23:59:59.999Z"
                },
                {
                    key: "2020.4",
                    year: 2020,
                    quarter: null,
                    month: 4,
                    dateFrom: "2020-04-01T00:00:00.000Z",
                    dateTo: "2020-04-30T23:59:59.999Z"
                },
                {
                    key: "2020.5",
                    year: 2020,
                    quarter: null,
                    month: 5,
                    dateFrom: "2020-05-01T00:00:00.000Z",
                    dateTo: "2020-05-31T23:59:59.999Z"
                }
            ]);
        });
        it("Should create correct period with same date", async () => {
            const result = createDatesPeriod("2020-05-01T00:00:00.000Z", "2020-05-01T00:00:00.000Z", "month");
            expect(result).toEqual([
                {
                    key: "2020.5",
                    year: 2020,
                    quarter: null,
                    month: 5,
                    dateFrom: "2020-05-01T00:00:00.000Z",
                    dateTo: "2020-05-31T23:59:59.999Z"
                }
            ]);
        });
    });
});
