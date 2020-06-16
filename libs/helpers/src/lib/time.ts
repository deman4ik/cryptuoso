import dayjs, { UnitType } from "@cryptuoso/dayjs";

export function durationUnit(dateFrom: string, dateTo: string, amountInUnit = 1, unit: UnitType): number {
    return dayjs.utc(dateTo).diff(dayjs.utc(dateFrom), unit) / amountInUnit;
}

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

export function getValidDate(date: string, unit: UnitType = "minute"): string {
    if (dayjs.utc(date).startOf(unit).valueOf() < dayjs.utc().startOf(unit).valueOf())
        return dayjs.utc(date).startOf(unit).toISOString();

    return dayjs.utc().startOf(unit).toISOString();
}
