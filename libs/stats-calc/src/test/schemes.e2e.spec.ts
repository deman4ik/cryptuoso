import { isPositionForStats, isPositionsForStats } from "../lib/types";
import positions from "./testData/positionsForStats";

describe("Test schemes", () => {
    describe("Test position for stats schema", () => {
        test("", async () => {
            const pos = positions[0];

            expect(isPositionForStats({ ...pos, other: 1 } as any)).toBeTruthy();
            expect(isPositionsForStats(positions)).toBeTruthy();

            positions[10].direction = "123" as any;

            expect(isPositionForStats(positions[10])).toBeFalsy();
            expect(isPositionsForStats(positions)).toBeFalsy();

            expect(isPositionsForStats([{ o: 1 }] as any)).toBeFalsy();
        });
    });
});
