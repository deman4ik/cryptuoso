import StatisticsCalculator, { roundRobotStatVals } from "../lib/statistics-calculator";
import positions from "./testData/positionsForStats";
import correctFinalResult from "./testData/correctResult";
import statsWithoutLastPos from "./testData/correctWithoutLastPos";
//import dayjs from "@cryptuoso/dayjs";
import { TradeStats, TradeStatsClass, Statistics } from "../lib/types";
import { invalidStatistics, invalidPosition } from "./testData/invalidData";
import { BasePosition } from "@cryptuoso/market";

describe("statistics-calculator test", () => {
    const newPosition = positions[positions.length - 1];

    describe("Testing StatisticsCalculator with valid input", () => {
        describe("Resulting object values test", () => {
            const statsCalculator = new StatisticsCalculator(statsWithoutLastPos, [newPosition]);
            const calculatedStats = statsCalculator.getStats();
            correctFinalResult.lastUpdatedAt = calculatedStats.lastPositionExitDate;

            for (const prop in calculatedStats) {
                it(`Should be equal to  ${prop} of reference object`, () => {
                    if (prop != "lastUpdatedAt") {
                        expect((calculatedStats as any)[prop]).toStrictEqual((correctFinalResult as any)[prop]);
                    }
                });
            }
        });

        describe("Test with position provided, simulating creation of new statistics", () => {
            it("Should not throw error", () => {
                expect(() => {
                    const statsCalculator = new StatisticsCalculator(null, [newPosition]);
                    statsCalculator.getStats();
                }).not.toThrowError();
            });
        });
    });

    describe("Testing StatisticsCalculator with invalid input", () => {
        describe("Testing constructor with nulls prodived", () => {
            it("Should throw error", () => {
                expect(() => {
                    new StatisticsCalculator(null, null);
                }).toThrowError();
            });
        });

        describe("Data integrity validation test", () => {
            const validObject = new TradeStatsClass();
            validObject.statistics.profitFactor = null;
            validObject.statistics.recoveryFactor = null;
            validObject.statistics.payoffRatio = null;

            const validPosition: BasePosition = positions[0];
            describe("Testing constructor with semi-valid statistics and valid position", () => {
                it("Should not throw error", () => {
                    expect(() => {
                        new StatisticsCalculator(validObject, [validPosition]);
                    }).not.toThrowError();
                });
            });

            describe("Testing constructor with invalid statistics and valid position", () => {
                it("Should throw error", () => {
                    expect(() => {
                        new StatisticsCalculator(invalidStatistics, [validPosition]);
                    }).toThrowError();
                });
            });

            describe("Testing constructor with valid statistics and invalid position", () => {
                it("Should throw error", () => {
                    const validStatistics: TradeStats = correctFinalResult;

                    expect(() => {
                        new StatisticsCalculator(validStatistics, [invalidPosition]);
                    }).toThrowError();
                });
            });
        });
    });
});

describe("Statistics functions test", () => {
    const prevTradeStatsObject = statsWithoutLastPos,
        prevStatisticsObject = statsWithoutLastPos.statistics;
    const referenceTradeStatsObject = correctFinalResult,
        referenceStatisticsObject = referenceTradeStatsObject.statistics;

    const currentTradeStatsObject: TradeStats = JSON.parse(JSON.stringify(prevTradeStatsObject));
    const currentStatisticsObject: Statistics = currentTradeStatsObject.statistics;

    const newPos: BasePosition = positions[positions.length - 1],
        profit = newPos.profit;

    const sc = new StatisticsCalculator(prevTradeStatsObject, [newPos]);

    describe("incrementTradesCount test", () => {
        it("Should increment tradesCount, tradesWinning, tradesLosing", () => {
            const tradesCount = prevStatisticsObject.tradesCount,
                tradesWinning = prevStatisticsObject.tradesWinning,
                tradesLosing = prevStatisticsObject.tradesLosing;

            currentStatisticsObject.tradesCount = sc.incrementTradesCount(tradesCount);
            expect(currentStatisticsObject.tradesCount).toStrictEqual(referenceStatisticsObject.tradesCount);

            if (profit > 0) currentStatisticsObject.tradesWinning = sc.incrementTradesCount(tradesWinning);
            expect(currentStatisticsObject.tradesWinning).toStrictEqual(referenceStatisticsObject.tradesWinning);

            if (profit < 0) currentStatisticsObject.tradesLosing = sc.incrementTradesCount(tradesLosing);
            expect(currentStatisticsObject.tradesLosing).toStrictEqual(referenceStatisticsObject.tradesLosing);
        });
    });

    describe("calculateRate test", () => {
        it("Should calculate winRate and lossRate", () => {
            const prevWinRate = prevStatisticsObject.winRate,
                prevLossRate = prevStatisticsObject.lossRate,
                winningTrades = currentStatisticsObject.tradesWinning,
                losingTrades = currentStatisticsObject.tradesLosing,
                allTrades = currentStatisticsObject.tradesCount;

            currentStatisticsObject.winRate = roundRobotStatVals(
                sc.calculateRate(prevWinRate, winningTrades, allTrades)
            );
            currentStatisticsObject.lossRate = roundRobotStatVals(
                sc.calculateRate(prevLossRate, losingTrades, allTrades)
            );

            expect(currentStatisticsObject.winRate).toStrictEqual(referenceStatisticsObject.winRate);
            expect(currentStatisticsObject.lossRate).toStrictEqual(referenceStatisticsObject.lossRate);
        });
    });

    describe("calculateAverageBarsHeld test", () => {
        it("Should calculate avgBarsHeld, avgBarsHeldWinning, avgBarsHeldLosing", () => {
            const prevAvgBarsHeld = prevStatisticsObject.avgBarsHeld,
                prevTradesCount = prevStatisticsObject.tradesCount,
                currTradesCount = currentStatisticsObject.tradesCount;
            const prevAvgBarsWinning = prevStatisticsObject.avgBarsHeldWinning,
                prevTradesWinning = prevStatisticsObject.tradesWinning,
                currTradesWinning = prevStatisticsObject.tradesWinning;
            const prevAvgBarsLosing = prevStatisticsObject.avgBarsHeldLosing,
                prevTradesLosing = prevStatisticsObject.tradesLosing,
                currTradesLosing = currentStatisticsObject.tradesLosing;
            const newBars = newPos.barsHeld;

            currentStatisticsObject.avgBarsHeld = roundRobotStatVals(
                sc.calculateAverageBarsHeld(prevAvgBarsHeld, prevTradesCount, currTradesCount, newBars),
                2
            );
            if (profit > 0)
                currentStatisticsObject.avgBarsHeldWinning = roundRobotStatVals(
                    sc.calculateAverageBarsHeld(prevAvgBarsWinning, prevTradesWinning, currTradesWinning, newBars),
                    2
                );
            if (profit < 0)
                currentStatisticsObject.avgBarsHeldLosing = roundRobotStatVals(
                    sc.calculateAverageBarsHeld(prevAvgBarsLosing, prevTradesLosing, currTradesLosing, newBars),
                    2
                );

            expect(currentStatisticsObject.avgBarsHeldLosing).toStrictEqual(
                referenceStatisticsObject.avgBarsHeldLosing
            );
            expect(currentStatisticsObject.avgBarsHeldWinning).toStrictEqual(
                referenceStatisticsObject.avgBarsHeldWinning
            );
            expect(currentStatisticsObject.avgBarsHeld).toStrictEqual(referenceStatisticsObject.avgBarsHeld);
        });
    });

    describe("calculateProfit test", () => {
        it("Should calculate netProfit, grossProfit, grossLoss", () => {
            const prevNetProfit = prevStatisticsObject.netProfit,
                prevGrossProfit = prevStatisticsObject.grossProfit,
                prevGrossLoss = prevStatisticsObject.grossLoss;

            currentStatisticsObject.netProfit = roundRobotStatVals(sc.calculateProfit(prevNetProfit, profit), 2);
            if (profit > 0)
                currentStatisticsObject.grossProfit = roundRobotStatVals(
                    sc.calculateProfit(prevGrossProfit, profit),
                    2
                );
            if (profit < 0)
                currentStatisticsObject.grossLoss = roundRobotStatVals(sc.calculateProfit(prevGrossLoss, profit), 2);

            expect(currentStatisticsObject.netProfit).toStrictEqual(referenceStatisticsObject.netProfit);
            expect(currentStatisticsObject.grossProfit).toStrictEqual(referenceStatisticsObject.grossProfit);
            expect(currentStatisticsObject.grossLoss).toStrictEqual(referenceStatisticsObject.grossLoss);
        });
    });

    describe("calculateAverageMark test", () => {
        it("Should calculate avgNetProfit, avgProfit, avgLoss", () => {
            const prevAvgNetProfit = prevStatisticsObject.avgNetProfit,
                currNetProfit = currentStatisticsObject.netProfit,
                currTradesCount = currentStatisticsObject.tradesCount;
            const prevAvgWinnersProfit = prevStatisticsObject.avgProfit,
                currGrossProfit = currentStatisticsObject.grossProfit,
                currTradesWinning = currentStatisticsObject.tradesWinning;
            const prevAvgLoss = prevStatisticsObject.avgLoss,
                currGrossLoss = currentStatisticsObject.grossLoss,
                currTradesLosing = currentStatisticsObject.tradesLosing;

            currentStatisticsObject.avgNetProfit = roundRobotStatVals(
                sc.calculateAverageMark(prevAvgNetProfit, currNetProfit, currTradesCount),
                2
            );
            if (profit > 0)
                currentStatisticsObject.avgProfitWinners = roundRobotStatVals(
                    sc.calculateAverageMark(prevAvgWinnersProfit, currGrossProfit, currTradesWinning),
                    2
                );
            if (profit < 0)
                currentStatisticsObject.avgLoss = roundRobotStatVals(
                    sc.calculateAverageMark(prevAvgLoss, currGrossLoss, currTradesLosing),
                    2
                );

            expect(currentStatisticsObject.avgNetProfit).toStrictEqual(referenceStatisticsObject.avgNetProfit);
            expect(currentStatisticsObject.avgProfitWinners).toStrictEqual(referenceStatisticsObject.avgProfitWinners);
            expect(currentStatisticsObject.avgLoss).toStrictEqual(referenceStatisticsObject.avgLoss);
        });
    });

    describe("calculateAverageProfit test", () => {
        it("Should calculate avgNetProfit, avgProfit, avgLoss", () => {
            const currTradesCount = currentStatisticsObject.tradesCount;
            const prevAvgProfit = prevStatisticsObject.avgProfit;
            const currGrossProfit = currentStatisticsObject.grossProfit;
            const currGrossLoss = currentStatisticsObject.grossLoss;

            if (profit > 0)
                currentStatisticsObject.avgProfit = roundRobotStatVals(
                    sc.calculateAverageProfit(prevAvgProfit, currGrossProfit, currGrossLoss, currTradesCount),
                    2
                );

            expect(currentStatisticsObject.avgProfit).toStrictEqual(referenceStatisticsObject.avgProfit);
        });
    });

    describe("calculateLocalMax test", () => {
        it("Should calculate localMax", () => {
            const prevLocalMax = prevStatisticsObject.localMax,
                currNetProfit = currentStatisticsObject.netProfit;

            currentStatisticsObject.localMax = sc.calculateLocalMax(prevLocalMax, currNetProfit);

            expect(currentStatisticsObject.localMax).toStrictEqual(referenceStatisticsObject.localMax);
        });
    });

    describe("calculateRatio test", () => {
        it("Should calculate profitFactor and payoffRatio", () => {
            const currGrossProfit = currentStatisticsObject.grossProfit,
                currGrossLoss = currentStatisticsObject.grossLoss;
            const currAvgProfit = currentStatisticsObject.avgProfit,
                currAvgLoss = currentStatisticsObject.avgLoss;

            currentStatisticsObject.profitFactor = roundRobotStatVals(
                sc.calculateRatio(currGrossProfit, currGrossLoss),
                2
            );
            currentStatisticsObject.payoffRatio = roundRobotStatVals(sc.calculateRatio(currAvgProfit, currAvgLoss), 2);

            expect(currentStatisticsObject.profitFactor).toStrictEqual(referenceStatisticsObject.profitFactor);
            expect(currentStatisticsObject.payoffRatio).toStrictEqual(referenceStatisticsObject.payoffRatio);
        });
    });

    describe("nullifySequence, incrementSequence, incrementMaxSequence test", () => {
        it("Should update currentWinSequence, maxConsecWinc, currentLossSequence, maxConsecLosses", () => {
            const prevWinSeq = prevStatisticsObject.currentWinSequence,
                prevMaxConsecWins = prevStatisticsObject.maxConsecWins;
            const prevLossSeq = prevStatisticsObject.currentLossSequence,
                prevMaxConsecLosses = prevStatisticsObject.maxConsecLosses;

            if (profit < 0) {
                currentStatisticsObject.currentWinSequence = sc.nullifySequence(prevWinSeq);
                currentStatisticsObject.currentLossSequence = sc.incrementSequence(prevLossSeq);
                currentStatisticsObject.maxConsecLosses = sc.incrementMaxSequence(prevLossSeq, prevMaxConsecLosses);
            } else {
                currentStatisticsObject.currentLossSequence = sc.nullifySequence(prevLossSeq);
                currentStatisticsObject.currentWinSequence = sc.incrementSequence(prevWinSeq);
                currentStatisticsObject.maxConsecWins = sc.incrementMaxSequence(prevWinSeq, prevMaxConsecWins);
            }

            expect(currentStatisticsObject.currentWinSequence).toStrictEqual(
                referenceStatisticsObject.currentWinSequence
            );
            expect(currentStatisticsObject.currentLossSequence).toStrictEqual(
                referenceStatisticsObject.currentLossSequence
            );
            expect(currentStatisticsObject.maxConsecWins).toStrictEqual(referenceStatisticsObject.maxConsecWins);
            expect(currentStatisticsObject.maxConsecLosses).toStrictEqual(referenceStatisticsObject.maxConsecLosses);
        });
    });

    describe("calculateMaxDrawdown test", () => {
        it("Should calculate maxDrawdown", () => {
            const prevMaxDrawdown = prevStatisticsObject.maxDrawdown,
                currNetProfit = currentStatisticsObject.netProfit,
                localMax = currentStatisticsObject.localMax;

            currentStatisticsObject.maxDrawdown = roundRobotStatVals(
                sc.calculateMaxDrawdown(prevMaxDrawdown, currNetProfit, localMax),
                2
            );

            expect(currentStatisticsObject.maxDrawdown).toStrictEqual(referenceStatisticsObject.maxDrawdown);
        });
    });

    describe("calculateMaxDrawdownDate test", () => {
        it("Should update maxDrawdownDate", () => {
            const prevDate = prevStatisticsObject.maxDrawdownDate,
                exitDate = newPos.exitDate;

            currentStatisticsObject.maxDrawdownDate = sc.calculateMaxDrawdownDate(prevDate, exitDate);

            expect(currentStatisticsObject.maxDrawdownDate).toStrictEqual(referenceStatisticsObject.maxDrawdownDate);
        });
    });

    describe("calculateEquity test", () => {
        it("Should update equity", () => {
            const prevEquity = prevTradeStatsObject.equity,
                exitDate = newPos.exitDate;

            currentTradeStatsObject.equity = sc.calculateEquity(prevEquity, profit, exitDate);

            expect(currentTradeStatsObject.equity).toStrictEqual(referenceTradeStatsObject.equity);
        });
    });

    describe("calculateEquityAvg test", () => {
        it(`Should be equal to equityAvg of reference object`, () => {
            currentTradeStatsObject.equityAvg = sc.calculateEquityAvg(currentTradeStatsObject.equity);
            expect(currentTradeStatsObject.equityAvg).toStrictEqual(referenceTradeStatsObject.equityAvg);
        });
    });

    describe("calculateRecoveryFactor test", () => {
        it("Should calculate recoveryFactor", () => {
            const prevRecoveryFactor = prevStatisticsObject.recoveryFactor,
                currNetProfit = currentStatisticsObject.netProfit,
                currDrawdown = currentStatisticsObject.maxDrawdown;

            currentStatisticsObject.recoveryFactor = roundRobotStatVals(
                sc.calculateRecoveryFactor(prevRecoveryFactor, currNetProfit, currDrawdown),
                2
            );

            expect(currentStatisticsObject.recoveryFactor).toStrictEqual(referenceStatisticsObject.recoveryFactor);
        });
    });

    describe("calculateRating test", () => {
        const profitFactor = currentStatisticsObject.profitFactor,
            payoffRatio = currentStatisticsObject.payoffRatio,
            recoveryFactor = currentStatisticsObject.recoveryFactor;
        describe("Testing calculateRating method with sum of weights close to being equal 1", () => {
            it("Should not throw error", () => {
                expect(() => {
                    sc.calculateRating(profitFactor, payoffRatio, recoveryFactor, 1 / 3, 1 / 2, 1 / 6); // sum equals to 0.(9)
                }).not.toThrowError();
            });
        });

        describe("Testing calculateRating method with undefined prodived", () => {
            it("Should throw error", () => {
                expect(() => {
                    sc.calculateRating(profitFactor, payoffRatio, recoveryFactor, 0.1, undefined, 0.1);
                }).toThrowError();
            });
        });

        describe("Testing calculateRating method with null prodived", () => {
            it("Should throw error", () => {
                expect(() => {
                    sc.calculateRating(profitFactor, payoffRatio, recoveryFactor, 0.1, 0.1, null);
                }).toThrowError();
            });
        });

        describe("Testing calculateRating method with Infinity prodived", () => {
            it("Should throw error", () => {
                expect(() => {
                    sc.calculateRating(profitFactor, payoffRatio, recoveryFactor, Infinity, 0.1, 0.1);
                }).toThrowError();
            });
        });

        describe("Testing calculateRating method with NaN prodived", () => {
            it("Should throw error", () => {
                expect(() => {
                    sc.calculateRating(profitFactor, payoffRatio, recoveryFactor, NaN, 0.1, NaN);
                }).toThrowError();
            });
        });

        describe("Testing calculateRating method with sum of weights not equal to 1", () => {
            it("Should throw error", () => {
                expect(() => {
                    sc.calculateRating(profitFactor, payoffRatio, recoveryFactor, 0.1, 0.1, 0.1);
                }).toThrowError();
            });
        });
    });
});
