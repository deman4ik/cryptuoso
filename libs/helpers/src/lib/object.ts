import { toCamelCase, fromCamelCase } from "./text";

const flattenObject = (obj: { [key: string]: any }, prefix = "") =>
    Object.keys(obj).reduce((acc: { [key: string]: any }, k) => {
        const pre = prefix.length ? prefix + "." : "";
        if (typeof obj[k] === "object") Object.assign(acc, flattenObject(obj[k], pre + k));
        else acc[pre + k] = obj[k];
        return acc;
    }, {});

export const deepMapKeys = (obj: { [key: string]: any }, f: (key: string) => string): { [key: string]: any } =>
    Array.isArray(obj)
        ? obj.map((val) => deepMapKeys(val, f))
        : typeof obj === "object"
        ? Object.entries(obj).reduce((acc: { [key: string]: any }, [current, val]) => {
              acc[f(current)] = val !== null && typeof val === "object" ? deepMapKeys(val, f) : (acc[f(current)] = val);
              return acc;
          }, {})
        : obj;

export const keysToCamelCase = (obj: { [key: string]: any }): { [key: string]: any } =>
    deepMapKeys(obj, (key) => toCamelCase(key));

export const keysToUnderscore = (obj: { [key: string]: any }): { [key: string]: any } =>
    deepMapKeys(obj, (key) => fromCamelCase(key));

export const datesToISOString = (data: { [key: string]: any } | any[]) =>
    JSON.parse(JSON.stringify(data), (key, value) => {
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

export const valuesString = (source: any, delim = " ") => Object.values(flatten(source)).join(delim);

export const JSONParse = (string: string) => {
    try {
        return JSON.parse(string);
    } catch (error) {
        return string;
    }
};
