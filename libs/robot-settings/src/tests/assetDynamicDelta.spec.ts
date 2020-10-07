import { assetDynamicDelta } from "../lib/calc";
import { round } from "@cryptuoso/helpers";

function assetDynamicDeltaCycled(initialVolume: number, delta: number, profit: number) {
    const minVolume = initialVolume / 2;
    const mvd = delta * minVolume;

    if (profit < mvd || !profit) return null;

    if (mvd <= profit && profit < mvd * 2) return round(minVolume, 2);

    let volume = initialVolume;
    let threshold = delta * volume;

    while (profit >= threshold) {
        volume += minVolume;
        threshold += delta * volume;
    }

    return round(volume, 2);
}

describe("assetDynamicDelta function test", () => {
    describe("Testing edge values", () => {
        describe("Should return nulls", () => {
            it("With null / 0 profit provided", () => {
                expect(assetDynamicDelta(2.6, 20, null)).toBeNull();

                expect(assetDynamicDelta(2.6, 20, 0)).toBeNull();

                expect(assetDynamicDelta(2.6, 20, 0)).toBeNull();
            });
        });

        describe("With profit < minValidProfit provided", () => {
            it("Should return nulls", () => {
                const volume = 2.6;
                const delta = 20;
                const minValidProfit = (volume * delta) / 2;

                for (let i = -10; i < minValidProfit; ++i) {
                    expect(assetDynamicDelta(volume, delta, i)).toBeNull();
                }
            });
        });
    });

    describe("Exact values", () => {
        it("Should return expected results", () => {
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
