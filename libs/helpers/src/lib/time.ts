import dayjs, { UnitType } from "@cryptuoso/dayjs";

/**
 * Counts how many units of time an interval contains.
 *
 * @param dateFrom Starting date.
 * @param dateTo Ending date.
 * @param amountInUnit How many specified units are considered as one.
 * @param unit Unit of time, e.g. day, hour, minute.
 * @returns {number} A number of units, e.g days, hours, minutes.
 * @example
 * durationUnit(new Date("2010-05-01"), new Date("2010-05-10"), 1, "day"); //9
 */
export function durationUnit(dateFrom: string, dateTo: string, amountInUnit = 1, unit: UnitType): number {
    return dayjs.utc(dateTo).diff(dayjs.utc(dateFrom), unit) / amountInUnit;
}
/**
 * Creates an array of date values based on a time interval.
 *
 * @param dateFrom Starting date.
 * @param dateTo Ending date.
 * @param unit Unit of time, e.g. day, hour, minute.
 * @param amountInUnit How many specified units are considered as one.
 * @param duration How many units of time an interval contains. Default is the given interval, excluding the ending date;
 * @returns {number} Date value in miliseconds.
 * @example
 * const dateFrom = "1970-01-01T00:00:00.000Z",
 *       dateTo = "1970-01-01T00:09:00.000Z";
 * createDatesList(dateFrom, dateTo, "minute", 1, 10);
 * // [ 0, 60000, 120000, 180000, 240000, 300000, 360000, 420000, 480000, 540000 ]
 */
export function createDatesList(
    dateFrom: string,
    dateTo: string,
    unit: UnitType,
    amountInUnit = 1,
    duration: number = durationUnit(dateFrom, dateTo, amountInUnit, unit)
): number[] {
    const list = [];
    for (let i = 0; i < duration; i += 1) {
        list.push(
            dayjs
                .utc(dateFrom)
                .add(i * amountInUnit, unit)
                .valueOf()
        );
    }
    return list;
}

/**
 * Creates an array of time intervals.
 *
 * @param dateFrom Starting date.
 * @param dateTo Ending date.
 * @param unit Unit of time, e.g. day, hour, minute.
 * @param amountInUnit How many specified units are considered as one.
 * @param duration How many units of time an interval contains. Default is the given interval, excluding the ending date;
 * @returns { { dateFrom: number; dateTo: number; }[] } Array of objects where intervals are stored in miliseconds.
 * @example
 * const dateFrom = "1970-01-01T00:00:00.000Z",
 *       dateTo = "1970-01-01T00:10:00.000Z";
 * createDatesListWithRange(dateFrom, dateTo, "minute");
 * //   [ { dateFrom: 0, dateTo: 299999 },
 * //     { dateFrom: 300000, dateTo: 599999 } ]
 */
export function createDatesListWithRange(
    dateFrom: string,
    dateTo: string,
    unit: UnitType,
    amountInUnit = 1,
    duration: number = durationUnit(dateFrom, dateTo, amountInUnit, unit)
): { dateFrom: number; dateTo: number }[] {
    const list = [];
    for (let i = 0; i < duration; i += 1) {
        const date = dayjs.utc(dateFrom).add(i * amountInUnit, unit);
        list.push({
            dateFrom: date.valueOf(),
            dateTo: date
                .add(amountInUnit - 1, unit)
                .endOf(unit)
                .valueOf()
        });
    }
    return list;
}

/**
 *
 * @param dateFrom Starting date.
 * @param dateTo Ending date.
 * @param unit Unit of time, e.g. day, hour, minute.
 * @param amountInUnit How many specified units are considered as one.
 * @param chunkSize How many total units one chunk consists of.
 * @example
 * const dateFrom = "1970-01-01T00:00:00.000Z",
 *       dateTo = "1970-01-01T00:10:00.000Z";
 * const { chunks } = chunkDates(dateFrom, dateTo, "minute", 1, 5);
 * // [ { dateFrom: '1970-01-01T00:00:00.000Z',
 * //     dateTo: '1970-01-01T00:04:59.999Z' },
 * //   { dateFrom: '1970-01-01T00:05:00.000Z',
 * //     dateTo: '1970-01-01T00:09:59.999Z' } ]
 */
export function chunkDates(dateFrom: string, dateTo: string, unit: UnitType, amountInUnit = 1, chunkSize: number) {
    const list = createDatesListWithRange(
        dateFrom,
        dateTo,
        unit,
        amountInUnit,
        durationUnit(dateFrom, dateTo, amountInUnit, unit) + 1
    );
    const arrayToChunk = [...list];
    const chunks = [];
    const endDate = dayjs.utc(dateTo).valueOf();
    while (arrayToChunk.length) {
        const chunk = arrayToChunk.splice(0, chunkSize);
        const chunkDateFrom = dayjs.utc(chunk[0].dateFrom).toISOString();
        const chunkDateTo =
            dayjs.utc(chunk[chunk.length - 1].dateTo).valueOf() > endDate
                ? dateTo
                : dayjs.utc(chunk[chunk.length - 1].dateTo).toISOString();
        if (chunkDateFrom !== chunkDateTo)
            chunks.push({
                dateFrom: chunkDateFrom,
                dateTo: chunkDateTo
            });
    }

    return { chunks, total: list.length };
}

/**
 * Returns valid date for specified units of time
 *
 * @param date Date string.
 * @param unit Unit of time, e.g. day, hour, minute.
 * @example
 * const date = "1970-01-01T01:01:01.000Z";
 * getValidDate(date, "minutes"); // "1970-01-01T01:01:00.000Z"
 */
export function getValidDate(date: string, unit: UnitType = "minute"): string {
    if (dayjs.utc(date).startOf(unit).valueOf() < dayjs.utc().startOf(unit).valueOf())
        return dayjs.utc(date).startOf(unit).toISOString();

    return dayjs.utc().startOf(unit).toISOString();
}
