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
 * Returns default value or null if provided value is null or undefined
 *
 * @template T
 * @param {any} value
 * @param {any} [defaultValue=null]
 */
export const nvl = (value: any, defaultValue: any = null) => value ?? defaultValue; //TODO: deprecate
