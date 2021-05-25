import dayjs, { UnitType } from "@cryptuoso/dayjs";
import { durationUnit } from "@cryptuoso/helpers";
import { PeriodStats, StatsPeriod, TradeStats } from "./types";

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

export function periodStatsFromArray(arr: PeriodStats[]) {
    const periodStats: TradeStats["periodStats"] = {
        year: {},
        quarter: {},
        month: {}
    };
    for (const period of arr.filter(({ period }) => period === "year")) {
        periodStats.year[`${period.year}`] = period;
    }
    for (const period of arr.filter(({ period }) => period === "quarter")) {
        periodStats.year[`${period.year}.${period.quarter}`] = period;
    }
    for (const period of arr.filter(({ period }) => period === "month")) {
        periodStats.year[`${period.year}.${period.month}`] = period;
    }
    return periodStats;
}

export function periodStatsToArray(periodStats: TradeStats["periodStats"]) {
    if (!periodStats) return null;
    return [
        ...Object.values(periodStats.year),
        ...Object.values(periodStats.quarter),
        ...Object.values(periodStats.month)
    ];
}

/**
 * zScore
 *
 * @export
 * @param {number} tradesCount
 * @param {number} seriesCount
 * @param {number} winningTrades
 * @param {number} lossingTrades
 * @returns {number}
 */
export function calcZScore(
    tradesCount: number,
    seriesCount: number,
    winningTrades: number,
    lossingTrades: number
): number {
    const P = 2 * winningTrades * lossingTrades;
    return (tradesCount * (seriesCount - 0.5) - P) / Math.sqrt((P * (P - tradesCount)) / (tradesCount - 1));
}
