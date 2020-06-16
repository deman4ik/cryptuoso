import { durationUnit, createDatesList, createDatesListWithRange, chunkDates, getValidDate } from "../lib/time";
import dayjs from "@cryptuoso/dayjs";

describe("Test 'time' utils", () => {
    describe("Test 'durationUnit'", () => {
        it("Should return correct duration for minutes", () => {
            const dateFrom = dayjs.utc("2019-07-05T02:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-07-05T02:09:00.000Z").toISOString();
            const result = durationUnit(dateFrom, dateTo, 1, "minute");
            expect(result).toBe(9);
        });
        it("Should return correct duration for hours", () => {
            const dateFrom = dayjs.utc("2019-07-05T02:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-07-05T04:09:00.000Z").toISOString();
            const result = durationUnit(dateFrom, dateTo, 1, "hour");
            expect(result).toBe(2);
        });
        it("Should return correct duration for days", () => {
            const dateFrom = dayjs.utc("2019-07-05T02:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-07-15T12:09:00.000Z").toISOString();
            const result = durationUnit(dateFrom, dateTo, 1, "day");
            expect(result).toBe(10);
        });
    });
    describe("Test 'createDatesList'", () => {
        it("Should create list with default params", () => {
            const dateFrom = dayjs.utc("2019-07-05T02:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-07-05T02:09:00.000Z").toISOString();
            const result = createDatesList(dateFrom, dateTo, "minute");
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(9);
            expect(dayjs.utc(result[0]).toISOString()).toBe("2019-07-05T02:00:00.000Z");
            expect(dayjs.utc(result[result.length - 1]).toISOString()).toBe("2019-07-05T02:08:00.000Z");
        });
        it("Should create list with duration + 1", () => {
            const dateFrom = dayjs.utc("2019-07-05T02:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-07-05T02:09:00.000Z").toISOString();
            const result = createDatesList(dateFrom, dateTo, "minute", 1, 10);
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(10);
            expect(dayjs.utc(result[0]).toISOString()).toBe("2019-07-05T02:00:00.000Z");
            expect(dayjs.utc(result[result.length - 1]).toISOString()).toBe("2019-07-05T02:09:00.000Z");
        });
        it("Should create list with corrected amount", () => {
            const dateFrom = dayjs.utc("2019-07-05T02:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-07-05T02:09:00.000Z").toISOString();
            const result = createDatesList(dateFrom, dateTo, "minute", 5);
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(2);
            expect(dayjs.utc(result[0]).toISOString()).toBe("2019-07-05T02:00:00.000Z");
            expect(dayjs.utc(result[result.length - 1]).toISOString()).toBe("2019-07-05T02:05:00.000Z");
        });
    });
    describe("Test 'createDatesListWithRange'", () => {
        it("Should create list with default params", () => {
            const dateFrom = dayjs.utc("2019-07-05T02:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-07-05T02:09:00.000Z").toISOString();
            const result = createDatesListWithRange(dateFrom, dateTo, "minute");
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(9);
            expect(dayjs.utc(result[0].dateFrom).toISOString()).toBe("2019-07-05T02:00:00.000Z");
            expect(dayjs.utc(result[result.length - 1].dateTo).toISOString()).toBe("2019-07-05T02:08:59.999Z");
        });
        it("Should create list with duration + 1", () => {
            const dateFrom = dayjs.utc("2019-07-05T02:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-07-05T02:09:00.000Z").toISOString();
            const result = createDatesListWithRange(dateFrom, dateTo, "minute", 1, 10);
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(10);
            expect(dayjs.utc(result[0].dateFrom).toISOString()).toBe("2019-07-05T02:00:00.000Z");
            expect(dayjs.utc(result[result.length - 1].dateTo).toISOString()).toBe("2019-07-05T02:09:59.999Z");
        });
        it("Should create list with corrected amount", () => {
            const dateFrom = dayjs.utc("2019-07-05T02:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-07-05T02:09:00.000Z").toISOString();
            const result = createDatesListWithRange(dateFrom, dateTo, "minute", 5);
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(2);
            expect(dayjs.utc(result[0].dateFrom).toISOString()).toBe("2019-07-05T02:00:00.000Z");
            expect(dayjs.utc(result[result.length - 1].dateTo).toISOString()).toBe("2019-07-05T02:09:59.999Z");
        });
    });
    describe("Test 'chunkDates'", () => {
        it("Should return chunks with default params", () => {
            const dateFrom = dayjs.utc("2019-07-05T02:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-07-05T02:09:00.000Z").toISOString();
            const { chunks, total } = chunkDates(dateFrom, dateTo, "minute", 1, 5);
            expect(Array.isArray(chunks)).toBe(true);
            expect(total).toBe(10);
            expect(chunks.length).toBe(2);
            expect(chunks[0].dateFrom).toBe("2019-07-05T02:00:00.000Z");
            expect(chunks[0].dateTo).toBe("2019-07-05T02:04:59.999Z");
            expect(chunks[chunks.length - 1].dateFrom).toBe("2019-07-05T02:05:00.000Z");
            expect(chunks[chunks.length - 1].dateTo).toBe("2019-07-05T02:09:00.000Z");
        });
        it("Should return chunks with corrected amount", () => {
            const dateFrom = dayjs.utc("2019-07-05T02:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-07-05T02:09:00.000Z").toISOString();
            const { chunks, total } = chunkDates(dateFrom, dateTo, "minute", 5, 5);
            expect(Array.isArray(chunks)).toBe(true);
            expect(total).toBe(3);
            expect(chunks.length).toBe(1);
            expect(chunks[0].dateFrom).toBe("2019-07-05T02:00:00.000Z");
            expect(chunks[0].dateTo).toBe("2019-07-05T02:09:00.000Z");
        });
        it("Should return chunks for 4 hours", () => {
            const dateFrom = dayjs.utc("2019-06-17T06:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-07-28T22:00:00.000Z").toISOString();
            const { chunks } = chunkDates(dateFrom, dateTo, "hour", 4, 500 / 4);
            expect(Array.isArray(chunks)).toBe(true);
            expect(chunks.length).toBe(2);
        });
        it("Should return chunks for 1 hour", () => {
            const dateFrom = dayjs.utc("2019-06-17T00:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-06-17T06:00:00.000Z").toISOString();
            const { chunks } = chunkDates(dateFrom, dateTo, "hour", 1, 1);
            expect(Array.isArray(chunks)).toBe(true);
            expect(chunks.length).toBe(6);
        });
        it("Should return chunks for 1 day", () => {
            const dateFrom = dayjs.utc("2019-06-17T00:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-06-19T06:00:00.000Z").toISOString();
            const { chunks } = chunkDates(dateFrom, dateTo, "day", 1, 1);
            expect(Array.isArray(chunks)).toBe(true);
            expect(chunks.length).toBe(3);
        });
        it("Should return chunks for 1 day with next", () => {
            const dateFrom = dayjs.utc("2019-06-17T00:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-06-18T00:00:00.000Z").toISOString();
            const { chunks } = chunkDates(dateFrom, dateTo, "day", 1, 1);
            expect(Array.isArray(chunks)).toBe(true);
            expect(chunks.length).toBe(1);
        });

        it("Should return chunks for 1 day full", () => {
            const dateFrom = dayjs.utc("2019-06-17T00:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-06-17T23:59:59.999Z").toISOString();
            const { chunks } = chunkDates(dateFrom, dateTo, "day", 1, 1);
            expect(Array.isArray(chunks)).toBe(true);
            expect(chunks.length).toBe(1);
        });
        it("Should return chunks for 30 days", () => {
            const dateFrom = dayjs.utc("2019-06-17T00:00:00.000Z").toISOString();
            const dateTo = dayjs.utc("2019-09-19T06:00:00.000Z").toISOString();
            const { chunks } = chunkDates(dateFrom, dateTo, "day", 30, 1);
            expect(Array.isArray(chunks)).toBe(true);
            expect(chunks.length).toBe(5);
        });
    });
    describe("Test 'getValidDate'", () => {
        it("Should return valid date", () => {
            const date = dayjs.utc("2019-07-05T02:00:01.000Z").toISOString();
            const validDate = getValidDate(date);
            expect(validDate).toBe("2019-07-05T02:00:00.000Z");
        });
    });
});
