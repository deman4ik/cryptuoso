import { assetDynamicDelta } from "../lib/calc";
import { roundFirstSignificant } from "@cryptuoso/helpers";

function makeTestFunction(initialVolume: number, delta: number) {
    const baseProfit = initialVolume / 2;

    return (profit: number, multOrDiv = 1) => {
        if (!multOrDiv) throw new Error("`multOrDiv` argument must differ from `0`");

        const checked = assetDynamicDelta(initialVolume, delta, profit);

        let expected: number;

        if (Math.abs(multOrDiv) === 1) {
            expected = baseProfit;
        } else if (multOrDiv > 0) {
            expected = baseProfit * multOrDiv;
        } else if (multOrDiv < 0) {
            expected = baseProfit / Math.abs(multOrDiv);
        }

        try {
            expect(checked).toBe(roundFirstSignificant(expected));
        } catch (err) {
            err.message =
                `Different results: ${checked} != ${expected}\r\n` +
                `On arguments: (${initialVolume}, ${delta}, ${profit})`;
            throw err;
        }
    };
}

describe("assetDynamicDelta function test", () => {
    describe("Exact values", () => {
        it("Should return expected results", () => {
            const expectDynamicDelta = makeTestFunction(2.6, 20);

            expectDynamicDelta(-2705, 1);
            expectDynamicDelta(-2704, 1);
            expectDynamicDelta(-2703, 1);
            expectDynamicDelta(-2401, 1);
            expectDynamicDelta(-2400, 1);
            expectDynamicDelta(-2339, 1);
            expectDynamicDelta(-131, 1);
            expectDynamicDelta(-130, 1);
            expectDynamicDelta(-129, 1);
            expectDynamicDelta(-53, 1);
            expectDynamicDelta(-52, 1);
            expectDynamicDelta(-51, 2);
            expectDynamicDelta(-27, 2);
            expectDynamicDelta(-26, 2);
            expectDynamicDelta(-25, 2);
            expectDynamicDelta(-1, 2);
            expectDynamicDelta(0, 2);
            expectDynamicDelta(1, 2);
            expectDynamicDelta(25, 2);
            expectDynamicDelta(26, 2);
            expectDynamicDelta(27, 2);
            expectDynamicDelta(51, 2);
            expectDynamicDelta(52, 3);
            expectDynamicDelta(53, 3);
            expectDynamicDelta(129, 3);
            expectDynamicDelta(130, 4);
            expectDynamicDelta(131, 4);
            expectDynamicDelta(2339, 13);
            expectDynamicDelta(2400, 14);
            expectDynamicDelta(2401, 14);
            expectDynamicDelta(2703, 14);
            expectDynamicDelta(2704, 15);
            expectDynamicDelta(2705, 15);
        });
    });
});
