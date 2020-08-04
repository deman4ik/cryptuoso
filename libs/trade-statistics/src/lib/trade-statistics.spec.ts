import MockDate from "mockdate";
import dayjs from "@cryptuoso/dayjs";
import { calcStatisticsCumulatively } from "./trade-statistics";
import positions from "./testData/positionsForStats";
import correctResult from "./testData/correctResultAfterRefactor";

describe("Test 'tradeStatistics' utils", () => {
    beforeAll(() => {
        MockDate.set(new Date(Date.UTC(2019, 0, 1, 13, 17)));
    });
    afterAll(() => {
        MockDate.reset();
    });

    // Refactored to automatically round every value
    describe("Test calcStatisticsCumulatively with no previous statistics", () => {
        it("Should cumulatively calculate statistics", () => {
            const result = calcStatisticsCumulatively({ statistics: null, equity: null }, positions);

            correctResult.statistics.lastUpdatedAt = dayjs.utc().toISOString();

            expect(result).toStrictEqual(correctResult);
        });
    });
});
