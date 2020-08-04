import EquityCalculator from "./equity-calculator";
import positions from "./testData/positionsForStats";
import correctFinalResult from "./testData/correctResultAfterRefactor";
import { invalidStatistics, invalidPosition } from "./testData/invalidData";

describe("equity-calculator test", () => {
    const newPosition = positions[positions.length - 1];
    const correctFinalEquity = correctFinalResult.equity;

    describe("Testing EquityCalculator with valid input", () => {
        const latestStats = correctFinalResult.statistics;
        const equityCalculator = new EquityCalculator(latestStats, newPosition);
        const calculatedEquity = equityCalculator.getEquity();

        describe("Resulting object values test", () => {
            for (const prop in calculatedEquity) {
                it(`Should be equal to  ${prop} of reference object`, () => {
                    expect(calculatedEquity[prop]).toStrictEqual(correctFinalEquity[prop]);
                });
            }
        });
    });

    describe("Testing EquityCalculator with invalid input", () => {
        describe("Testing constructor with no statistics but with position provided", () => {
            it("Should throw error", () => {
                expect(() => {
                    new EquityCalculator(null, newPosition);
                }).toThrowError();
            });
        });

        describe("Testing constructor with nulls provided", () => {
            it("Should throw error", () => {
                expect(() => {
                    new EquityCalculator(null, null);
                }).toThrowError();
            });
        });

        describe("Testing constructor with invalid statistics", () => {
            const validPosition = positions[0];
            it("Should throw error", () => {
                expect(() => {
                    new EquityCalculator(invalidStatistics, validPosition);
                }).toThrowError();
            });
        });

        describe("Testing constructor with invalid position", () => {
            const validStatistics = correctFinalResult.statistics;
            it("Should throw error", () => {
                expect(() => {
                    new EquityCalculator(validStatistics, invalidPosition);
                }).toThrowError();
            });
        });
    });
});
