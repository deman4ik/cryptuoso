import {
    arraysDiff,
    chunkArray,
    chunkArrayIncrEnd,
    chunkNumberToArray,
    uniqueElementsBy,
    findLastByMaxProp,
    findLastByMinProp,
    flattenArray,
    groupBy
} from "../lib/array";

describe("array utils test", () => {
    describe("arraysDiff test", () => {
        describe("Only unique elements, 1 common element", () => {
            it("Should output left difference", () => {
                const arr1 = [1, 2, 3],
                    arr2 = [3, 4, 5];
                expect(arraysDiff(arr1, arr2)).toStrictEqual([1, 2]);
            });
            it("Should output empty result", () => {
                const arr = [1, 2, 3];
                expect(arraysDiff(arr, arr)).toStrictEqual([]);
            });
        });
        describe("Many common elements, some elements are repeated", () => {
            const arr1 = [9, 2, 8, 5, 5, 3, 0, 6, 1, 9, 1],
                arr2 = [8, 4, 6, 6, 1, 1, 3, 9];
            it("Should output correct difference", () => {
                expect(arraysDiff(arr1, arr2)).toStrictEqual([2, 5, 5, 0]);
            });
        });
    });
});

describe("chunkArray test", () => {
    describe("Array size is a multiple of chunk size", () => {
        it("Should split array into same-sized chunks", () => {
            const arr = [1, 2, 3, 4, 5, 6];

            expect(chunkArray(arr, 2)).toStrictEqual([
                [1, 2],
                [3, 4],
                [5, 6]
            ]);
        });
    });
    describe("Array size is not a multiple of chunk size", () => {
        it("Should split array into chunks of 2 and a chunk of 1", () => {
            const arr = [1, 2, 3, 4, 5];

            expect(chunkArray(arr, 2)).toStrictEqual([[1, 2], [3, 4], [5]]);
        });
    });
});

describe("chunkArrayIncrEnd test", () => {
    const arr = [1, 2, 3, 4, 5, 6];
    it("Should incrementally split array into same-sized chunks", () => {
        expect(chunkArrayIncrEnd(arr, 2)).toStrictEqual([
            [1, 2],
            [2, 3],
            [3, 4],
            [4, 5],
            [5, 6]
        ]);
        expect(chunkArrayIncrEnd(arr, 3)).toStrictEqual([
            [1, 2, 3],
            [2, 3, 4],
            [3, 4, 5],
            [4, 5, 6]
        ]);
    });
});

describe("chunkNumberToArray test", () => {
    describe("Testing with positive values", () => {
        it("Should return a correct array", () => {
            expect(chunkNumberToArray(40, 10)).toStrictEqual([10, 10, 10, 10]);
            expect(chunkNumberToArray(45, 25)).toStrictEqual([25, 20]);
            expect(chunkNumberToArray(15.5, 3)).toStrictEqual([3, 3, 3, 3, 3, 1]);
        });
    });
});

describe("uniqueElementsBy test", () => {
    describe("Testing with numbers", () => {
        it("Should filter out recurrent numbers", () => {
            const numbers = [5, 7, 2, 6, 1, 6, 5, 7, 1, 2];
            expect(uniqueElementsBy(numbers, (a, b) => a == b)).toStrictEqual([5, 7, 2, 6, 1]);
        });
    });

    describe("Testing with object of a custom type", () => {
        interface MyType {
            id: number;
            val: number;
        }

        const objects: MyType[] = [
            { id: 0, val: 0 },
            { id: 1, val: 0 },
            { id: 2, val: 2 },
            { id: 0, val: 4 },
            { id: 2, val: 5 }
        ];

        it("Should filter out objects with recurrent id", () => {
            expect(uniqueElementsBy<MyType>(objects, (a, b) => a.id == b.id)).toStrictEqual([
                { id: 0, val: 0 },
                { id: 1, val: 0 },
                { id: 2, val: 2 }
            ]);
        });
    });

    describe("findLastByMaxProp test", () => {
        it("beb", () => {
            const objects = [
                { mem: 14, beb: 1 },
                { mem: 7, beb: 2 },
                { mem: 12, beb: 3 },
                { mem: 4, beb: 4 },
                { mem: 4, beb: 5 },
                { mem: 12, beb: 6 },
                { mem: 4, beb: 7 },
                { mem: 13, beb: 8 },
                { mem: 13, beb: 9 },
                { mem: 3, beb: 10 },
                { mem: 1, beb: 11 },
                { mem: 4, beb: 12 }
            ];
            console.log(findLastByMaxProp(objects, "mem"));
        });
    });
});
