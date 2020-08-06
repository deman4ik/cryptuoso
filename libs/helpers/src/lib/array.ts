import { round } from "./number";

/**
 * Returns an array of elements contained in the first array that are not contained in the second.
 *
 * @param {Array} first
 * @param {Array} second
 * @example
 * arraysDiff([1,2,3],[3,4,5]); // [1,2]
 */
export function arraysDiff<T>(first: T[], second: T[]): T[] {
    return first.filter((v) => !second.includes(v));
}

/**
 * Splits an array into chunks of specified size.
 *
 * @param {Array} array
 * @param {number} chunkSize
 * @example
 * chunkArray([1,2,3,4,5,6],2); // [[1,2],[3,4],[5,6]]
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
 * Incrementally splits an array into chunks of specified size until the last element is met.
 *
 * @param {Array} array
 * @param {number} chunkSize
 * @example
 * chunkArrayIncrEnd([1,2,3,4,5,6],2); // [[1,2],[2,3],[3,4],[4,5],[5,6]]
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
 * Iteratively decreases an integer by the provided value untill possible.
 * The value is pushed into an array on each iteration.
 * If there is a remainder, it's pushed into the array last.
 *
 * @param {number} number The integer being decreased. If the value is decimal, it's rounded first.
 * @param {number} reducer The value by which the number is decreased. Only the integer part of the value is used.
 * @returns {number[]}
 * @example
 * chunkNumberToArray(6, 2); // [2,2,2]
 * chunkNumberToArray(15,6); // [6,6,3]
 * chunkNumberToArray(45, 25); // [25, 20]
 */
export function chunkNumberToArray(number: number, reducer: number): number[] {
    const array = [...Array(round(number) + 1).keys()].slice(1);
    return chunkArray(array, reducer).map((val) => val.length);
}

/**
 * Returns all unique values of an array, based on a provided comparator function.
 *
 * @template T
 * @param {T[]} arr
 * @param {(a: T, b: T) => boolean} fn Comparator function
 * @returns {T[]}
 * @example
 * const objects: MyType[] = [{id: 1, value: "a"},
 *                            {id: 2, value: "b"},
 *                            {id: 1, value: "c"},
 *                            {id: 3, value: "d"}];
 * // [{id:1, value: "a"}, {id: 2, value: "b"}, {id: 3, value: "d"}]
 * uniqueElementsBy<MyType>(objects, (a,b) => a.id == b.id);
 */
export function uniqueElementsBy<T>(arr: T[], fn: (a: T, b: T) => boolean): T[] {
    return arr.reduce((acc, v) => {
        if (!acc.some((x) => fn(v, x))) acc.push(v);
        return acc;
    }, []);
}

/**
 * Returns the last element in the array with max property value.
 *
 * @param {{ [key: string]: any }[]} arr Array of objects
 * @param {string} propName Name of the property
 * @returns {Object} The object with max property value
 * @example
 * const objects = [{key: 1, val: 5},
 *                  {key: 2, val: 6},
 *                  {key: 3, val: 6}];
 * findLastByMaxProp(objects, "val"); // {key:3, val:6}
 */
export function findLastByMaxProp(arr: { [key: string]: any }[], propName: string) {
    return arr
        .filter((el) => el[propName] === arr.reduce((max, p) => (p[propName] > max ? p[propName] : max), 0))
        .pop();
}

/**
 * Returns the last element in the array with min property value.
 *
 * @param {{ [key: string]: any }[]} arr Array of objects
 * @param {string} propName Name of the property
 * @returns {Object} The object with min property value
 * @example
 * const objects = [{key: 1, val: 5},
 *                  {key: 2, val: 4},
 *                  {key: 3, val: 4}];
 * findLastByMinProp(objects, "val"); // {key: 3, val: 4}
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
 * @param {number} [depth=1] The depth of the targer array. Default value is 1.
 * @returns {any[]}
 * @example
 * flattenArray([1, [2], 3, 4]); // [1, 2, 3, 4]
 * flattenArray([1, [2, [3, [4, 5], 6], 7], 8], 2); // [1, 2, 3, [4, 5], 6, 7, 8]
 */
export function flattenArray(arr: any[], depth = 1): any[] {
    if (!arr || !Array.isArray(arr) || arr.length === 0) return arr;
    return arr.reduce((a, v) => a.concat(depth > 1 && Array.isArray(v) ? flattenArray(v, depth - 1) : v), []);
}

/**
 * Groups an array of objects based on the output of the given function.
 *
 * @param arr
 * @param fn A mapping function.
 * @returns {Object} An object where the keys are produced from the mapped results.
 * @example
 * const objects = [{foo:1, bar:2}, {foo:1, bar:3, tar:5}, {foo: 5, tar: 1}]
 * groupBy(objects, (el)=>el.foo); // {1: [{foo:1, bar:2}, {foo:1, bar:3, tar:5}], 5: [{foo: 5, tar: 1}]}
 */
export const groupBy = (arr: { [key: string]: any }[], fn: (...params: any[]) => any | string) =>
    arr.map(typeof fn === "function" ? fn : (val) => val[fn]).reduce((acc, val, i) => {
        acc[val] = (acc[val] || []).concat(arr[i]);
        return acc;
    }, {});
