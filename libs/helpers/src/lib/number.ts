export const round = (n: number, decimals = 0): number => +Number(`${Math.round(+`${n}e${decimals}`)}e-${decimals}`);

export const sum = (...nums: number[]) => nums.reduce((acc, val) => acc + val, 0);

/**
 * Returns the average of two or more numbers.
 *
 * @param nums
 */
export const average = (...nums: number[]) => sum(...nums) / nums.length;

export const averageRound = (...nums: number[]) => +round(average(...nums));

export function divideRound(a: number, b: number): number | 0 {
    if (!a || !b || a === 0 || b === 0) return 0;
    const result = a / b;
    return +round(result, 2);
}

export function addPercent(numb: number, perc: number) {
    const number = +numb || 0;
    const percent = +perc || 0;
    return round(number + (number / 100) * percent, 6);
}
