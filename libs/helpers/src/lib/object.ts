import { toCamelCase, fromCamelCase } from "./text";

/**
 * Flatten an object with the paths for keys.
 *
 * @param obj
 * @param prefix
 * @example
 * flattenObject({ a: { b: { c: 1 } }, d: 1 }); // { 'a.b.c': 1, d: 1 }
 */
export const flattenObject = (obj: { [key: string]: any }, prefix = "") =>
    Object.keys(obj).reduce((acc: { [key: string]: any }, k) => {
        const pre = prefix.length ? prefix + "." : "";
        if (typeof obj[k] === "object") Object.assign(acc, flattenObject(obj[k], pre + k));
        else acc[pre + k] = obj[k];
        return acc;
    }, {});

/**
 * Deep maps an object's keys.
 *
 * @param obj
 * @param f
 * @example
 * const obj = {
 *  foo: '1',
 *  nested: {
 *      child: {
 *          withArray: [
 *              {
 *                  grandChild: ['hello']
 *              }
 *          ]
 *      }
 *   }
 * };
 * const upperKeysObj = deepMapKeys(obj, key => key.toUpperCase()); ->
 * {
 * "FOO":"1",
 * "NESTED":{
 *   "CHILD":{
 *     "WITHARRAY":[
 *       {
 *         "GRANDCHILD":[ 'hello' ]
 *       }
 *     ]
 *   }
 *  }
 * }
 */
export const deepMapKeys = (obj: { [key: string]: any }, f: (key: string) => string): { [key: string]: any } =>
    Array.isArray(obj)
        ? obj.map((val) => deepMapKeys(val, f))
        : typeof obj === "object"
        ? Object.entries(obj).reduce((acc: { [key: string]: any }, [current, val]) => {
              acc[f(current)] = val !== null && typeof val === "object" ? deepMapKeys(val, f) : (acc[f(current)] = val);
              return acc;
          }, {})
        : obj;

/**
 * Converts keys of the object to camelCase.
 * @param obj
 */
export const keysToCamelCase = (obj: { [key: string]: any }): { [key: string]: any } =>
    deepMapKeys(obj, (key) => toCamelCase(key));

/**
 * Converts the object's keys' parts from camelCase to underscore-divided.
 *
 * @param obj
 * @example
 * keysToUnderscore({keyOne: 1, keyTwo:2}); // {key_one:1, key_two:2}
 */
export const keysToUnderscore = (obj: { [key: string]: any }): { [key: string]: any } =>
    deepMapKeys(obj, (key) => fromCamelCase(key));

/**
 * Converts legal date values array to ISO strings.
 * @param date
 */
export const datesToISOString = (date: { [key: string]: any } | any[]) =>
    JSON.parse(JSON.stringify(date), (key, value) => {
        if (value instanceof Date) {
            return value.toISOString();
        } else {
            return value;
        }
    });

/**
 * Performs a deep comparison between two values to determine if they are equivalent.
 *
 * @param {any} a
 * @param {any} b
 * @example
 * equals({ a: [2, { e: 3 }], b: [4], c: 'foo' }, { a: [2, { e: 3 }], b: [4], c: 'foo' }); // true
 * equals([1, 2, 3], { 0: 1, 1: 2, 2: 3 }); // true
 */
export const equals = (a: any, b: any): boolean => {
    if (a === b) return true;
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (!a || !b || (typeof a !== "object" && typeof b !== "object")) return a === b;
    if (a === null || a === undefined || b === null || b === undefined) return false;
    if (a.prototype !== b.prototype) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((k) => equals(a[k], b[k]));
};

/**
 * 
 * @param source 
 * @param flattened 
 * @param keySoFar 
 */
export const flatten = (source: any, flattened: { [key: string]: any } = {}, keySoFar = "") => {
    const getNextKey = (key: string) => `${keySoFar}${keySoFar ? "." : ""}${key}`;

    if (typeof source === "object") {
        for (const key in source) {
            flatten(source[key], flattened, getNextKey(key));
        }
    } else {
        flattened[keySoFar] = source;
    }
    return flattened;
};

/**
 * 
 * @param source 
 * @param delim 
 */
export const valuesString = (source: any, delim = " ") => Object.values(flatten(source)).join(delim);

/**
 * Calls JSON.parse and handles errors.
 * 
 * @param string 
 */
export const JSONParse = (string: string) => {
    try {
        return JSON.parse(string);
    } catch (error) {
        return string;
    }
};
