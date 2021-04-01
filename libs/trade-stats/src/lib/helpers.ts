import dayjs, { UnitType } from "@cryptuoso/dayjs";
import { durationUnit } from "@cryptuoso/helpers";
import { StatsPeriod } from "./types";

export function createDatesPeriod(
    dateFrom: string,
    dateTo: string,
    unit: StatsPeriod
): {
    key: string;
    year: number;
    quarter?: number | null;
    month?: number | null;
    dateFrom: string;
    dateTo: string;
}[] {
    const duration =
        durationUnit(
            dayjs.utc(dateFrom).startOf(unit).toISOString(),
            dayjs.utc(dateTo).endOf(unit).toISOString(),
            1,
            <UnitType>unit
        ) + 1;
    const list = [];
    for (let i = 0; i < duration; i += 1) {
        const date = dayjs.utc(dateFrom).startOf(unit).add(i, unit);
        let key;
        if (unit === "quarter") key = `${date.get("year")}.${date.get(<UnitType>"quarter")}`;
        else if (unit === "month") key = `${date.get("year")}.${date.get(unit) + 1}`;
        else if (unit === "year") key = date.get(unit);
        list.push({
            key: `${key}`,
            year: date.get("year"),
            quarter: unit === "quarter" ? date.get(<UnitType>"quarter") : null,
            month: unit === "month" ? date.get("month") + 1 : null,
            dateFrom: date.toISOString(),
            dateTo: date.endOf(unit).toISOString()
        });
    }
    return list;
}
