/**
 * Delays the execution of an asynchronous function by the specified time in miliseconds
 *
 * @param ms miliseconds
 * @example
 * async function delayedLog() {
 *  console.log("Wait for it...");
 *  await sleep(1000);
 *  console.log("Boo");
 * }
 */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns `true` if provided value is null or undefined
 * and `false` in other case
 * 
 * @param value 
 */
export const isUndefinedOrNull = (value: any): boolean =>
    value === null || value === undefined;

/**
 * Returns default value if provided value is null or undefined
 *
 * @template T
 * @param {T} value
 * @param {T} defaultValue
 */
export const defaultValue = <T>(value: T, defaultValue: T) =>
    value === null || value === undefined ? defaultValue : value;
