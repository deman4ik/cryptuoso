/**
 * Сравнение двух массивов
 *
 * @param {Array} full
 * @param {Array} part
 */
export function arraysDiff<T>(full: T[], part: T[]): T[] {
    return full.filter((v) => !part.includes(v));
}

/**
 * Разделение массива по пачкам
 * @example chunkArray([1,2,3,4,5,6],2) -> [[1,2],[3,4],[5,6]]
 * @param {Array} array
 * @param {number} chunkSize размер пачкм
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const arrayToChunk = [...array];
    const results = [];
    while (arrayToChunk.length) {
        results.push(arrayToChunk.splice(0, chunkSize));
    }
    return results;
}

/**
 * Разделение массива по пачкам инкрементально с конца
 * @example chunkArrayIncrEnd([1,2,3,4,5,6],2) -> [[1,2],[2,3],[3,4],[4,5],[5,6]]
 *
 * @param {Array} array
 * @param {number} chunkSize размер пачкм
 */
export function chunkArrayIncrEnd<T>(array: T[], chunkSize: number): T[][] {
    const arrayToChunk = [...array];
    const results = [];
    let start = arrayToChunk.length - chunkSize;
    let end = arrayToChunk.length;
    while (start >= 0) {
        results.push(arrayToChunk.slice(start, end));
        start -= 1;
        end -= 1;
    }
    return results.reverse();
}

/**
 * Разбивка числа по пачкам
 *
 * @param {number} number
 * @param {number} chunkSize
 * @returns {number[]}
 */
export function chunkNumberToArray(number: number, chunkSize: number): number[] {
    const array = [...Array(number + 1).keys()].slice(1);
    return chunkArray(array, chunkSize).map((val) => val.length);
}

/**
 * Returns all unique values of an array, based on a provided comparator function.
 *
 * @template T
 * @param {T[]} arr
 * @param {(a: T, b: T) => boolean} fn
 * @returns {T[]}
 */
export function uniqueElementsBy<T>(arr: T[], fn: (a: T, b: T) => boolean): T[] {
    return arr.reduce((acc, v) => {
        if (!acc.some((x) => fn(v, x))) acc.push(v);
        return acc;
    }, []);
}

/**
 * Find last element where property is max
 *
 * @param {{ [key: string]: any }[]} arr
 * @param {string} propName
 * @returns
 */
export function findLastByMaxProp(arr: { [key: string]: any }[], propName: string) {
    return arr
        .filter((el) => el[propName] === arr.reduce((max, p) => (p[propName] > max ? p[propName] : max), 0))
        .pop();
}

/**
 * Find last element where property is min
 *
 * @param {{ [key: string]: any }[]} arr
 * @param {string} propName
 * @returns
 */
export function findLastByMinProp(arr: { [key: string]: any }[], propName: string) {
    return arr
        .filter((el) => el[propName] === arr.reduce((min, p) => (p[propName] < min ? p[propName] : min), 0))
        .pop();
}

/**
 * Flattens an array up to the specified depth.
 *
 * @param {any[]} arr
 * @param {number} [depth=1]
 * @returns {any[]}
 */
export function flattenArray(arr: any[], depth = 1): any[] {
    if (!arr || !Array.isArray(arr) || arr.length === 0) return arr;
    return arr.reduce((a, v) => a.concat(depth > 1 && Array.isArray(v) ? flattenArray(v, depth - 1) : v), []);
}

export const groupBy = (arr: { [key: string]: any }[], fn: (...params: any[]) => any | string) =>
    arr.map(typeof fn === "function" ? fn : (val) => val[fn]).reduce((acc, val, i) => {
        acc[val] = (acc[val] || []).concat(arr[i]);
        return acc;
    }, {});
