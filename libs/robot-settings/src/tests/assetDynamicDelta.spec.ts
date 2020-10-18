import { calcAssetDynamicDelta } from "../lib/calc";

function makeTestFunction(initialVolume: number, delta: number) {
    return (profit: number, expected: number) => {
        const checked = calcAssetDynamicDelta(initialVolume, delta, profit);

        try {
            expect(checked).toBe(expected);
        } catch (err) {
            throw new Error(
                `Different results: ${checked} != ${expected}\r\n` +
                    `On arguments: (${initialVolume}, ${delta}, ${profit})`
            );
        }
    };
}

describe("calcAssetDynamicDelta function test", () => {
    describe("Testing with null / 0 profit provided", () => {
        it("Should return `initialVolume` value`", () => {
            for (let i = 0; i < 100; ++i) {
                const initialVolume = 1 + 5 * Math.random();
                const delta = 3 + 50 * Math.random();

                const checked0 = calcAssetDynamicDelta(initialVolume, delta, 0);
                const checkedNull = calcAssetDynamicDelta(initialVolume, delta, null);

                let profit: number;

                try {
                    profit = 0;
                    expect(checked0).toBe(initialVolume);
                    profit = null;
                    expect(checkedNull).toBe(initialVolume);
                } catch (err) {
                    throw new Error(
                        `Different results: ${checked0} != ${initialVolume}\r\n` +
                            `On arguments: (${initialVolume}, ${delta}, ${profit})`
                    );
                }
            }
        });
    });

    describe("Exact values", () => {
        it("Should return expected results", () => {
            const testFunction = makeTestFunction(2.6, 20);

            testFunction(-2705, 1.3);
            testFunction(-2704, 1.3);
            testFunction(-2703, 1.3);
            testFunction(-2401, 1.3);
            testFunction(-2400, 1.3);
            testFunction(-2339, 1.3);
            testFunction(-131, 1.3);
            testFunction(-130, 1.3);
            testFunction(-129, 1.3);
            testFunction(-53, 1.3);
            testFunction(-52, 1.3);
            testFunction(-51, 2.6);
            testFunction(-27, 2.6);
            testFunction(-26, 2.6);
            testFunction(-25, 2.6);
            testFunction(-1, 2.6);
            testFunction(0, 2.6);
            testFunction(1, 2.6);
            testFunction(25, 2.6);
            testFunction(26, 2.6);
            testFunction(27, 2.6);
            testFunction(51, 2.6);
            testFunction(52, 3.9);
            testFunction(53, 3.9);
            testFunction(129, 3.9);
            testFunction(130, 5.2);
            testFunction(131, 5.2);
            testFunction(2339, 16.9);
            testFunction(2400, 18.2);
            testFunction(2401, 18.2);
            testFunction(2703, 18.2);
            testFunction(2704, 19.5);
            testFunction(2705, 19.5);
        });
    });
});
