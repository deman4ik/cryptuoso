import { round, sum, average, averageRound, divideRound, addPercent } from "../lib/number";

describe("'number' utils test", () => {
    describe("round test", () => {
        describe("Positive values test", () => {
            it("Should round a positive decimal", () => {
                expect(round(1.2345, 2)).toBe(1.23);
                expect(round(12.345, 2)).toBe(12.35);
                expect(round(0.4)).toBe(0);
            });
        });

        describe("Negative values test", () => {
            it("Should round a negative decimal", () => {
                expect(round(-1.2345, 2)).toBe(-1.23);
                expect(round(-12.345, 2)).toBe(-12.35); // was -12.34
                expect(round(-0.4)).toBe(0);
                expect(round(-0.6)).toBe(-1);
            });
        });
    });

    describe("sum test", () => {
        it("Should return a sum", () => {
            expect(sum(1, 2, 3, 4, 5)).toBe(15);
            expect(sum(-1, -2, -3, -4, -5)).toBe(-15);
        });
    });

    describe("average test", () => {
        it("Should return an average value", () => {
            expect(average(1, 2, 3)).toBe(2);
            expect(average(-3, -2, -1, 1, 2, 3)).toBe(0);
            expect(average(1, 3, 5, 6)).toBe(3.75);
        });
    });

    describe("averageRound test", () => {
        it("Should return a rounded average", () => {
            expect(averageRound(1, 3, 5, 6)).toBe(4);
            expect(averageRound(1, 2, 10)).toBe(4);
            expect(averageRound(0, 5)).toBe(3);
        });
    });

    describe("divideRound test", () => {
        it("Should return a rounded ratio", () => {
            expect(divideRound(10, 3)).toBe(3.33);
            expect(divideRound(-10, 3)).toBe(-3.33);
            expect(divideRound(-15, -4.2)).toBe(3.57);
        });
    });

    describe("addPercent test", () => {
        it("Should return the value increased by the specified percent", () => {
            expect(addPercent(10, 50)).toBe(15);
            expect(addPercent(10, 125)).toBe(22.5);
            expect(addPercent(58, 10)).toBe(63.8);
            expect(addPercent(0.5, 50)).toBe(0.75);
            expect(addPercent(1000, 0.1)).toBe(1001);
            expect(addPercent(-50, 10)).toBe(-55);
            expect(addPercent(-10, -100)).toBe(0);
        });
    });
});
