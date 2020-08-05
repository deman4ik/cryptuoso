/**
 * Returnts a number rounded to a specified amout of digits.
 *
 * @param n
 * @param decimals
 * @example
 * round(12.345, 2) -> 12.35
 */
export const round = (n: number, decimals = 0): number => +Number(`${Math.round(+`${n}e${decimals}`)}e-${decimals}`);

/**
 * Returns the sum of numbers provided.
 *
 * @param nums
 * @example
 * sum(1,2,3,4,5) -> 15
 */
export const sum = (...nums: number[]) => nums.reduce((acc, val) => acc + val, 0);

/**
 * Returns the average of numbers provided.
 *
 * @param nums
 * @example
 * average(1,2,3) -> 2
 */
export const average = (...nums: number[]) => sum(...nums) / nums.length;

/**
 * Returns the average of numbers rounded to 0 decimals.
 *
 * @param nums
 * @example
 * averageRound(2,5,10) -> 6
 */
export const averageRound = (...nums: number[]) => +round(average(...nums));

/**
 * Returns the ratio of a to b rounded to 2 decimals.
 *
 * @param a
 * @param b
 * @example
 * divideRound(10,3) -> 3.33
 */
export function divideRound(a: number, b: number): number | 0 {
    if (!a || !b || a === 0 || b === 0) return 0;
    const result = a / b;
    return +round(result, 2);
}

/**
 * Returns the number increased by the specified percentage, rounded up to 6 digits.
 *
 * @param num
 * @param perc
 * @example
 * addPercent(10, 50) -> 15
 */
export function addPercent(num: number, perc: number) {
    const number = +num || 0;
    const percent = +perc || 0;
    return round(number + (number / 100) * percent, 6);
}
