import { assetDynamicDelta } from "../lib/calc";
import { round } from "@cryptuoso/helpers";

function assetDynamicDeltaCycled(initialVolume: number, delta: number, profit: number) {
    const minVolume = initialVolume / 2;
    const mvd = delta * minVolume;

    if (profit < 0 || (!profit && profit !== 0)) return null;
    if (profit < mvd) return round(minVolume, 2);
    if (profit < mvd * 2) return round(initialVolume, 2);

    let volume = initialVolume;
    let threshold = delta * volume;

    while (profit >= threshold) {
        volume += minVolume;
        threshold += delta * volume;
    }

    return round(volume, 2);
}

describe("assetDynamicDelta function test", () => {
    describe("With null / undefined / NaN profit provided", () => {
        it("Should return null", () => {
            expect(assetDynamicDelta(2.6, 20, null)).toBeNull();

            expect(assetDynamicDelta(2.6, 20, undefined)).toBeNull();

            expect(assetDynamicDelta(2.6, 20, NaN)).toBeNull();
        });
    });

    describe("With negative profit provided", () => {
        it("Should return null", () => {
            expect(assetDynamicDelta(2.6, 20, -1)).toBeNull();
        });
    });

    describe("Exact values", () => {
        it("Should return expected results", () => {
            expect(assetDynamicDelta(2.6, 20, 0)).toBe(1.3);
            expect(assetDynamicDelta(2.6, 20, 1)).toBe(1.3);
            expect(assetDynamicDelta(2.6, 20, 25)).toBe(1.3);
            expect(assetDynamicDelta(2.6, 20, 26)).toBe(2.6);
            expect(assetDynamicDelta(2.6, 20, 27)).toBe(2.6);
            expect(assetDynamicDelta(2.6, 20, 51)).toBe(2.6);
            expect(assetDynamicDelta(2.6, 20, 52)).toBe(3.9);
            expect(assetDynamicDelta(2.6, 20, 129)).toBe(3.9);
            expect(assetDynamicDelta(2.6, 20, 130)).toBe(5.2);
            expect(assetDynamicDelta(2.6, 20, 131)).toBe(5.2);
            expect(assetDynamicDelta(2.6, 20, 2339)).toBe(16.9);
            expect(assetDynamicDelta(2.6, 20, 2400)).toBe(18.2);
            expect(assetDynamicDelta(2.6, 20, 2401)).toBe(18.2);
            expect(assetDynamicDelta(2.6, 20, 2703)).toBe(18.2);
            expect(assetDynamicDelta(2.6, 20, 2704)).toBe(19.5);
            expect(assetDynamicDelta(2.6, 20, 2705)).toBe(19.5);
        });
    });

    describe("Comparing results with cycled function", () => {
        it("Should return same results", () => {
            for (let i = 0; i < 100; ++i) {
                const initialVolume = 1 + 5 * Math.random();
                const delta = 5 + 50 * Math.random();
                const profit = 10000 * Math.random();

                const expected = assetDynamicDeltaCycled(initialVolume, delta, profit);
                const checked = assetDynamicDelta(initialVolume, delta, profit);

                try {
                    expect(checked).toBe(expected);
                } catch (err) {
                    throw new Error(
                        `Different results: ${checked} != ${expected}\r\n` +
                            `On arguments: (${initialVolume}, ${delta}, ${profit})`
                    );
                }
            }
        });
    });
});
