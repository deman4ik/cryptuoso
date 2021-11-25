import dayjs, { UnitType } from "@cryptuoso/dayjs";
import { sortAsc, getValidDate, durationUnit, createDatesListWithRange } from "@cryptuoso/helpers";

export const enum ValidTimeframe {
    "1m" = 1,
    "5m" = 5,
    "15m" = 15,
    "30m" = 30,
    "1h" = 60,
    "2h" = 120,
    "4h" = 240,
    "8h" = 480,
    "12h" = 720,
    "1d" = 1440
}

export type TimeframeInfo = {
    str: string;
    value: ValidTimeframe;
    unit: UnitType;
    amountInUnit: number;
};

export type TimeframesInfo = {
    [key: string]: TimeframeInfo;
};

export class Timeframe {
    private static _timeframes: TimeframesInfo = {
        /*  1: {
      str: "1m",
      value: 1,
      unit: "minute",
      amountInUnit: 1
    },*/ // exclude 1 minute
        5: {
            str: "5m",
            value: 5,
            unit: "minute",
            amountInUnit: 5
        },
        15: {
            str: "15m",
            value: 15,
            unit: "minute",
            amountInUnit: 15
        },
        30: {
            str: "30m",
            value: 30,
            unit: "minute",
            amountInUnit: 30
        },
        60: {
            str: "1h",
            value: 60,
            unit: "hour",
            amountInUnit: 1
        },
        120: {
            str: "2h",
            value: 120,
            unit: "hour",
            amountInUnit: 2
        },
        240: {
            str: "4h",
            value: 240,
            unit: "hour",
            amountInUnit: 4
        },
        480: {
            str: "8h",
            value: 480,
            unit: "hour",
            amountInUnit: 8
        },
        720: {
            str: "12h",
            value: 720,
            unit: "hour",
            amountInUnit: 12
        },
        1440: {
            str: "1d",
            value: 1440,
            unit: "day",
            amountInUnit: 1
        }
    };

    public static get timeframes(): TimeframesInfo {
        return this._timeframes;
    }

    public static get(timeframe: ValidTimeframe): TimeframeInfo {
        if (!this.exists(timeframe)) throw new Error("Invalid timeframe");
        return this._timeframes[timeframe];
    }

    public static get validArray(): ValidTimeframe[] {
        return Object.keys(this.timeframes).map((t) => +t);
    }

    static exists(timeframe: ValidTimeframe | string): boolean {
        if (typeof timeframe === "number") return !!this.timeframes[timeframe];
        return Object.values(this.timeframes).filter((t) => t.str === timeframe).length === 1;
    }

    static toString(timeframe: ValidTimeframe): string {
        const { str } = this.get(timeframe);
        return str;
    }

    static stringToTimeframe(str: string): ValidTimeframe {
        const timeframe = Object.values(this.timeframes).find((t) => t.str === str);
        if (timeframe) return timeframe.value;
        return null;
    }

    static inList(timeframes: { [key: string]: Timeframe }, str: string): boolean {
        return str in timeframes;
    }

    static timeframeAmountToTimeUnit(amount: number, timeframe: ValidTimeframe): { amount: number; unit: UnitType } {
        const { amountInUnit, unit } = this.get(timeframe);
        return {
            amount: Math.floor(amount * amountInUnit),
            unit
        };
    }

    static checkTimeframeByDate(hour: number, minute: number, timeframe: ValidTimeframe): boolean {
        /* Если одна минута */
        if (timeframe === 1) {
            /* Минимально возможный таймфрейм */
            return true;
        }
        /* Если меньше часа */
        if (timeframe < 60) {
            /* Проверяем текущую минуту */
            if (minute % timeframe === 0) return true;
            /* В остальных случаях проверяем текущий час и минуту */
        } else if (hour % (timeframe / 60) === 0 && minute % timeframe === 0) return true;

        return false;
    }

    static isTimeframeByDate(inputDate: string | number, timeframe: ValidTimeframe): boolean {
        const date = dayjs.utc(inputDate || undefined);
        if (date.second() !== 0) return false;
        /* Количество часов 0-23 */
        const hour = date.hour();
        /* Количество минут 0-59 */
        const minute = date.minute();
        return this.checkTimeframeByDate(hour, minute, timeframe);
    }

    static validTimeframeDatePrev(inputDate: string, timeframe: ValidTimeframe): string {
        const { amountInUnit, unit } = Timeframe.get(timeframe);
        let date = dayjs.utc(inputDate || undefined);
        let newDate;
        if (timeframe > 1 && timeframe < 60) {
            const minute = date.minute();
            const diff = minute % timeframe;

            if (diff === 0) newDate = date.startOf(unit).toISOString();
            else newDate = date.add(-diff, "minute").startOf(unit).toISOString();
        } else if (timeframe >= 60 && timeframe < 1440) {
            const minute = date.minute();
            if (minute !== 0) date = date.startOf("hour");
            const hour = date.hour();
            const diff = hour % amountInUnit;
            if (diff === 0) newDate = date.startOf(unit).toISOString();
            else newDate = date.add(-diff, "hour").startOf(unit).toISOString();
        } else {
            newDate = date.startOf(unit).toISOString();
        }

        return getValidDate(newDate, unit);
    }

    static validTimeframeDateNext(inputDate: string, timeframe: ValidTimeframe): string {
        const { amountInUnit, unit } = Timeframe.get(timeframe);
        let date = dayjs.utc(inputDate || undefined);
        let newDate;
        if (timeframe > 1 && timeframe < 60) {
            const minute = date.minute();
            const diff = minute % timeframe;

            if (diff === 0) newDate = date.startOf(unit).toISOString();
            else
                newDate = date
                    .add(timeframe - diff, "minute")
                    .startOf(unit)
                    .toISOString();
        } else if (timeframe >= 60 && timeframe < 1440) {
            const minute = date.minute();
            if (minute !== 0) date = date.add(1, "hour").startOf("hour");
            const hour = date.hour();
            const diff = hour % amountInUnit;
            if (diff === 0) newDate = date.startOf(unit).toISOString();
            else
                newDate = date
                    .add(amountInUnit - diff, "hour")
                    .startOf(unit)
                    .toISOString();
        } else if (timeframe === 1440) {
            const hour = date.hour();
            const minute = date.minute();
            newDate = date.startOf(unit).toISOString();
            if (hour !== 0 || minute !== 0) {
                newDate = date.add(1, unit).startOf(unit).toISOString();
            }
        } else {
            newDate = date.startOf(unit).toISOString();
        }

        return getValidDate(newDate, unit);
    }

    static timeframesByDate(inputDate: string): ValidTimeframe[] {
        const date = dayjs.utc(inputDate || undefined);

        if (date.second() !== 0) return [];

        /* Количество часов 0-23 */
        const hour = date.hour();
        /* Количество минут 0-59 */
        const minute = date.minute();

        /* Проверяем все таймфреймы */
        let currentTimeframes: ValidTimeframe[] = this.validArray.filter((timeframe) =>
            this.checkTimeframeByDate(hour, minute, timeframe)
        );
        /* Если есть хотя бы один подходящий таймфрейм */
        if (currentTimeframes.length > 0)
            /* Сортируем в порядке убывания */
            currentTimeframes = currentTimeframes.sort(sortAsc);
        /* Возвращаем массив доступных таймфреймов */
        return currentTimeframes;
    }

    static durationTimeframe(dateFrom: string, dateTo: string, timeframe: ValidTimeframe): number {
        const { amountInUnit, unit } = this.get(timeframe);
        const duration = dayjs.utc(dateTo).add(1, "millisecond").diff(dayjs.utc(dateFrom), unit);
        return Math.floor(duration / amountInUnit);
    }

    static getPrevSince(inputDate: string, timeframe: ValidTimeframe): number {
        const currentDate = Timeframe.validTimeframeDatePrev(inputDate, timeframe);
        const { amountInUnit, unit } = Timeframe.get(timeframe);
        return dayjs.utc(currentDate).add(-amountInUnit, unit).valueOf();
    }

    static getCurrentSince(amount: number, timeframe: ValidTimeframe): number {
        const currentDate = dayjs.utc();
        const { amountInUnit, unit } = this.get(timeframe);

        if (amount === 1 && (timeframe === 1 || timeframe === 60 || timeframe === 1440))
            return currentDate.startOf(unit).valueOf();

        if (timeframe === 1) {
            return currentDate.add(-amount, unit).startOf(unit).valueOf();
        }

        return currentDate
            .add(-currentDate.get(unit) % (amount * amountInUnit), unit)
            .startOf(unit)
            .valueOf();
    }

    static createDatesListWithRange(
        inputDateFrom: string,
        inputDateTo: string,
        timeframe: ValidTimeframe
    ): { dateFrom: number; dateTo: number }[] {
        const { amountInUnit, unit } = Timeframe.get(timeframe);
        const dateFrom = Timeframe.validTimeframeDatePrev(inputDateFrom, timeframe);
        const dateTo = Timeframe.validTimeframeDatePrev(inputDateTo, timeframe);
        const duration = durationUnit(dateFrom, dateTo, amountInUnit, unit);
        const list = [];
        for (let i = 0; i < duration; i += 1) {
            const date = dayjs.utc(dateFrom).add(i * amountInUnit, unit);
            list.push({
                dateFrom: date.valueOf(),
                dateTo: dayjs
                    .utc(
                        Timeframe.validTimeframeDateNext(
                            date
                                .add(amountInUnit - 1, unit)
                                .endOf(unit)
                                .toISOString(),
                            timeframe
                        )
                    )
                    .valueOf()
            });
        }
        return list;
    }

    static chunkDates(inputDateFrom: string, inputDateTo: string, timeframe: ValidTimeframe, chunkSize: number) {
        const dateFrom = Timeframe.validTimeframeDatePrev(inputDateFrom, timeframe);
        const dateTo = Timeframe.validTimeframeDatePrev(inputDateTo, timeframe);
        const { amountInUnit, unit } = Timeframe.get(timeframe);
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
            const chunkDateToTimeframe = Timeframe.validTimeframeDatePrev(
                dayjs.utc(chunk[chunk.length - 1].dateTo).toISOString(),
                timeframe
            );
            const chunkDateTo = dayjs.utc(chunkDateToTimeframe).valueOf() > endDate ? dateTo : chunkDateToTimeframe;
            // if (chunkDateFrom !== chunkDateTo)
            chunks.push({
                dateFrom: chunkDateFrom,
                dateTo: chunkDateTo
            });
        }

        return { chunks, total: list.length };
    }
}
