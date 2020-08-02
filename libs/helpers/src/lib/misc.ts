/**
 * Sleep
 *
 * @param ms miliseconds
 */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns default value if provided value is null or undefined
 *
 * @template T
 * @param {T} value
 * @param {T} defaultValue
 */
export const defaultValue = <T>(value: T, defaultValue: T) =>
    value === null || value === undefined ? defaultValue : value;
