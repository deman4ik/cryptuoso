/**
 * Returns the given string with 1st character capitalized.
 *
 * @param {string} string
 * @example
 * capitalize("lowercasekey"); //Lowercasekey
 */
export const capitalize = (string: string) => string.charAt(0).toUpperCase() + string.slice(1);

/**
 * Converts an underscored string to camelcase.
 *
 * @param str
 * @example
 * toCamelCase("underscore_key"); // underscoreKey
 */
export const toCamelCase = (str: string) => {
    const s =
        str &&
        str
            .match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)
            .map((x) => x.slice(0, 1).toUpperCase() + x.slice(1).toLowerCase())
            .join("");
    return s.slice(0, 1).toLowerCase() + s.slice(1);
};

/**
 * Adds a separator to a camelCased string and converts it to lower case.
 *
 * @param str
 * @param separator The separator. Default is '_'.
 * @example
 * fromCamelCase("camelCasedKey"); // camel_cased_key
 * fromCamelCase("anotherKey", ".") // another.key
 */
export const fromCamelCase = (str: string, separator = "_") =>
    str
        .replace(/([a-z\d])([A-Z])/g, "$1" + separator + "$2")
        .replace(/([A-Z]+)([A-Z][a-z\d]+)/g, "$1" + separator + "$2")
        .toLowerCase();
