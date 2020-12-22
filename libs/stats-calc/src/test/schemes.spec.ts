import { checkPositionForStats, checkPositionsForStats } from "../lib/statistics-calculator";
import positions from "./testData/positionsForStats";

describe("Test schemes", () => {
    describe("Test position for stats schema", () => {
        test("", async () => {
            const pos = positions[0];

            expect(checkPositionForStats({ ...pos, other: 1 } as any)).toBeTruthy();
            expect(checkPositionsForStats(positions)).toBeTruthy();

            positions[10].direction = "123" as any;

            expect(Array.isArray(checkPositionForStats(positions[10]))).toBeTruthy();
            expect(Array.isArray(checkPositionsForStats(positions))).toBeTruthy();

            expect(Array.isArray(checkPositionsForStats([{ o: 1 }] as any))).toBeTruthy();
        });
    });
});
