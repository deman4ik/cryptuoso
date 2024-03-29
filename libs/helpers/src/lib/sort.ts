/**
 * Ascending sort
 *
 * @param {T} a
 * @param {T} b
 * @returns {Number}
 */
export function sortAsc<T>(a: T, b: T): number {
    if (a > b) {
        return 1;
    }
    if (b > a) {
        return -1;
    }
    return 0;
}

/**
 * Descending sort
 *
 * @param {T} a
 * @param {T} b
 * @returns {Number}
 */
export function sortDesc<T>(a: T, b: T): number {
    if (a > b) {
        return -1;
    }
    if (b > a) {
        return 1;
    }
    return 0;
}
