import round from "./round";

export { round };

/**
 * Returns a number rounded to first significant digit after comma.
 *
 * @param {number} x A number to be rounded
 * @returns {number}
 * @example
 * roundFirstSignificant(100.000234); // 100.0002
 */
export const roundFirstSignificant = (x: number) => {
    const precision = Math.abs(Math.floor(Math.log10(Math.abs(x - round(x)))));
    return round(x, precision);
};

/**
 * Returnts a number rounded to a specified amout of digits.
 *
 * @param n A number to be rounded.
 * @param decimals Number of decimals. Default value is 0.
 * @example
 * round(12.345, 2); // 12.35
 */
export const roundOld = (n: number, decimals = 0): number => +Number(`${Math.round(+`${n}e${decimals}`)}e-${decimals}`);

/**
 * Returns the sum of numbers provided.
 *
 * @param nums
 * @example
 * sum(1,2,3,4,5); // 15
 */
export const sum = (...nums: number[]) => nums.filter((n) => typeof n === "number").reduce((acc, val) => acc + val, 0);

/**
 * Returns the average of numbers provided.
 *
 * @param nums
 * @example
 * average(1,2,3); // 2
 */
export const average = (...nums: number[]) => sum(...nums) / nums.filter((n) => typeof n === "number").length;

/**
 * Returns the average of numbers rounded to 0 decimals.
 *
 * @param nums
 * @example
 * averageRound(2,5,10); // 6
 */
export const averageRound = (...nums: number[]) => +round(average(...nums));

export const max = (...nums: number[]) => Math.max(...nums.filter((n) => typeof n === "number"));
export const min = (...nums: number[]) => Math.min(...nums.filter((n) => typeof n === "number"));

export function divide(a: number, b: number) {
    if (a === 0) return 0;
    if (!a || !b) return null;
    return a / b;
}

/**
 * Returns the ratio of a to b rounded to 2 decimals.
 *
 * @param a
 * @param b
 * @example
 * divideRound(10,3); // 3.33
 */
export function divideRound(a: number, b: number): number | 0 {
    if (!a || !b) return 0;
    const result = a / b;
    return +round(result, 2);
}

export function calcPercentValue(num: number, percent: number) {
    return (percent / 100) * num;
}

/**
 * Returns the number increased by the specified percentage, rounded up to 6 digits.
 *
 * @param num
 * @param perc
 * @example
 * addPercent(10, 50); // 15
 */
export function addPercent(num: number, perc: number) {
    const number = +num || 0;
    const percent = +perc || 0;
    return round(number + (number / 100) * percent, 6);
}

export function getPercentagePos(startPos: number, endPos: number, currentPos: number) {
    const distance = endPos - startPos;
    const displacement = currentPos - startPos;
    const result = (displacement / distance) * 100;
    return result;
}

export function percentBetween(a: number, b: number) {
    if (a === b) return 0;
    else if (a > 0) return ((b - a) * 100) / a;
    else if (a < 0) return ((a - b) * 100) / a;
}

/**
 * Calculates the standard deviation of an array of numbers.
 *
 * @param arr
 * @param usePopulation Omit the second argument, usePopulation, to get the sample standard deviation or set it to true to get the population standard deviation.
 */
export function standardDeviation(arr: number[], usePopulation = false) {
    const mean = arr.reduce((acc, val) => acc + val, 0) / arr.length;
    return Math.sqrt(
        arr.reduce((acc, val) => acc.concat((val - mean) ** 2), []).reduce((acc, val) => acc + val, 0) /
            (arr.length - (usePopulation ? 0 : 1))
    );
}
