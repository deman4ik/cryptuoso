import {
    arraysDiff,
    chunkArray,
    chunkArrayIncrEnd,
    chunkNumberToArray,
    uniqueElementsBy,
    flattenArray,
    groupBy
} from "../lib/array";

describe("array utils test", () => {
    type FooBar = { foo: any; bar: number };

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
                expect(chunkNumberToArray(16, 3.9)).toStrictEqual([3, 4, 4, 4, 1]);
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
    });

    describe("flattenArray test", () => {
        describe("Flattening an array of numbers", () => {
            const arr = [[1, 2], [3, 4], 5, [6]];
            it("Should return a one-dimentional array", () => {
                const expectedArr = [1, 2, 3, 4, 5, 6];
                expect(flattenArray(arr)).toStrictEqual(expectedArr);
                expect(flattenArray([...arr], 2)).toStrictEqual(expectedArr);
            });
            it("Should return original array", () => {
                expect([...arr]).toStrictEqual(arr);
            });
        });
        describe("Flattening an array of objects", () => {
            const arr = [[{ foo: 1 }, { foo: 2 }, [{ foo: 3, bar: [[1, 2], 3] }]], { foo: 4, bar: [[4, 5, 6]] }];
            it("Should not affect arrays inside objects", () => {
                expect(flattenArray(arr, 3)).toStrictEqual([
                    { foo: 1 },
                    { foo: 2 },
                    { foo: 3, bar: [[1, 2], 3] },
                    { foo: 4, bar: [[4, 5, 6]] }
                ]);
            });
        });
    });

    describe("groupBy test", () => {
        it("Should group an array by provided map function", () => {
            expect(
                groupBy(
                    [
                        { a: 1, b: 2, c: 3 },
                        { a: 2, b: 4 },
                        { b: 4, c: 6 }
                    ],
                    (p) => p.b
                )
            ).toStrictEqual({
                2: [{ a: 1, b: 2, c: 3 }],
                4: [
                    { a: 2, b: 4 },
                    { b: 4, c: 6 }
                ]
            });
            expect(
                groupBy([{ val: 4 }, { val: 5 }, { val: 6 }, { val: 7 }, { val: 8 }], (el) => el.val > 5)
            ).toStrictEqual({
                true: [{ val: 6 }, { val: 7 }, { val: 8 }],
                false: [{ val: 4 }, { val: 5 }]
            });
        });
    });
});
