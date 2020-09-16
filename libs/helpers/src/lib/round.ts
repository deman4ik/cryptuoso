function numberToString(x: number): string {
    // avoids scientific notation for too large and too small numbers

    if (typeof x === "string") return x;

    const s = x.toString();
    if (Math.abs(x) < 1.0) {
        // eslint-disable-next-line @typescript-eslint/camelcase
        const n_e = s.split("e-");
        // eslint-disable-next-line @typescript-eslint/camelcase
        const n = n_e[0].replace(".", "");
        // eslint-disable-next-line @typescript-eslint/camelcase
        const e = parseInt(n_e[1]);
        const neg = s[0] === "-";
        if (e) {
            return (neg ? "-" : "") + "0." + new Array(e).join("0") + n.substring(Number(neg));
        }
    } else {
        const parts = s.split("e");
        if (parts[1]) {
            let e = parseInt(parts[1]);
            const m = parts[0].split(".");
            if (m[1]) {
                e -= m[1].length;
            }
            return m[0] + m[1] + new Array(e + 1).join("0");
        }
    }
    return s;
}

/*  ------------------------------------------------------------------------ */

const round = (x: number, numPrecisionDigits = 0) => {
    if (!isFinite(x) || (!x && x !== 0)) return null;
    /* if (numPrecisionDigits == 0) {
        const r = Math.round(x)
        return r === -0 ? 0 : r;
    } */

    /*  Convert to a string (if needed), skip leading minus sign (if any)   */

    const str = numberToString(x),
        isNegative = str[0] === "-",
        strStart = isNegative ? 1 : 0,
        strEnd = str.length;

    /*  Find the dot position in the source buffer   */

    let strDot = 0;
    for (; strDot < strEnd; strDot++) if (str[strDot] === ".") break;

    const hasDot = strDot < str.length;

    /*  Char code constants         */

    const MINUS = 45,
        DOT = 46,
        ZERO = 48,
        ONE = ZERO + 1,
        FIVE = ZERO + 5,
        NINE = ZERO + 9;

    /*  For -123.4567 the `chars` array will hold 01234567 (leading zero is reserved for rounding cases when 099 → 100)    */

    const chars = new Uint8Array(strEnd - strStart + (hasDot ? 0 : 1));
    chars[0] = ZERO;

    /*  Validate & copy digits, determine certain locations in the resulting buffer  */

    let afterDot = chars.length,
        digitsStart = -1, // significant digits
        digitsEnd = -1;

    let i = 1,
        j = strStart;
    for (; j < strEnd; j++, i++) {
        const c = str.charCodeAt(j);

        if (c === DOT) {
            afterDot = i--;
        } else if (c < ZERO || c > NINE) {
            throw new Error(`${str}: invalid number (contains an illegal character '${str[i - 1]}')`);
        } else {
            chars[i] = c;
            if (c !== ZERO && digitsStart < 0) digitsStart = i;
        }
    }

    if (digitsStart < 0) digitsStart = 1;

    /*  Determine the range to cut  */

    const precisionStart = afterDot; // 0.(0)001234567

    /*  Reset the last significant digit index, as it will change during the rounding/truncation.   */

    digitsEnd = -1;

    /*  Perform rounding/truncation per digit, from digitsEnd to digitsStart, by using the following
    algorithm (rounding 999 → 1000, as an example):
        step  =          i=3      i=2      i=1      i=0
        chars =         0999     0999     0900     1000
        memo  =         ---0     --1-     -1--     0---                     */

    let allZeros = true;
    let signNeeded = isNegative;

    for (let i = chars.length - 1, memo = 0; i >= 0; i--) {
        let c = chars[i];

        if (i !== 0) {
            c += memo;

            if (i >= precisionStart + numPrecisionDigits) {
                const ceil = c >= FIVE && !(c === FIVE && memo); // prevents rounding of 1.45 to 2

                c = ceil ? NINE + 1 : ZERO;
            }
            if (c > NINE) {
                c = ZERO;
                memo = 1;
            } else memo = 0;
        } else if (memo) c = ONE; // leading extra digit (0900 → 1000)

        chars[i] = c;

        if (c !== ZERO) {
            allZeros = false;
            digitsStart = i;
            digitsEnd = digitsEnd < 0 ? i + 1 : digitsEnd;
        }
    }

    /*  Update the precision range, as `digitsStart` may have changed... & the need for a negative sign if it is only 0    */

    if (allZeros) {
        signNeeded = false;
    }

    /*  Determine the input character range     */

    const readStart = digitsStart >= afterDot || allZeros ? afterDot - 1 : digitsStart, // 0.000(1)234  ----> (0).0001234
        readEnd = digitsEnd < afterDot ? afterDot : digitsEnd; // 12(3)000     ----> 123000( )

    /*  Compute various sub-ranges       */

    const nSign = signNeeded ? 1 : 0, // (-)123.456
        nBeforeDot = nSign + (afterDot - readStart), // (-123).456
        nAfterDot = Math.max(readEnd - afterDot, 0), // -123.(456)
        actualLength = readEnd - readStart, // -(123.456)
        desiredLength = actualLength,
        pad = Math.max(desiredLength - actualLength, 0), //  -123.456(    )
        padStart = nBeforeDot + 1 + nAfterDot, //  -123.456( )
        padEnd = padStart + pad, //  -123.456     ( )
        isInteger = nAfterDot + pad === 0; //  -123

    /*  Fill the output buffer with characters    */

    const out = new Uint8Array(nBeforeDot + (isInteger ? 0 : 1) + nAfterDot + pad);
    // ------------------------------------------------------------------------------------------ // ---------------------
    if (signNeeded) out[0] = MINUS; // -     minus sign
    for (i = nSign, j = readStart; i < nBeforeDot; i++, j++) out[i] = chars[j]; // 123   before dot
    if (!isInteger) out[nBeforeDot] = DOT; // .     dot
    for (i = nBeforeDot + 1, j = afterDot; i < padStart; i++, j++) out[i] = chars[j]; // 456   after dot
    for (i = padStart; i < padEnd; i++) out[i] = ZERO; // 000   padding

    /*  Build a string from the output buffer     */

    return +String.fromCharCode(...out);
};

export default round;
