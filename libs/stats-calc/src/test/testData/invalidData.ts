import { BasePosition } from "@cryptuoso/market";
import { TradeStats } from "../../lib/types";

export const invalidStatistics: TradeStats = {
    statistics: {
        tradesCount: null,
        tradesWinning: null,
        tradesLosing: null,
        winRate: null,
        lossRate: null,
        avgBarsHeld: null,
        avgBarsHeldWinning: null,
        avgBarsHeldLosing: null,
        netProfit: null,
        localMax: null,
        avgNetProfit: null,
        grossProfit: null,
        avgProfitWinners: null,
        avgProfit: null,
        grossLoss: null,
        avgLoss: null,
        maxConsecWins: null,
        maxConsecLosses: null,
        currentWinSequence: null,
        currentLossSequence: null,
        maxDrawdown: null,
        maxDrawdownDate: null,
        profitFactor: null,
        recoveryFactor: null,
        payoffRatio: null,
        rating: null
    },
    lastUpdatedAt: null,
    firstPositionEntryDate: null,
    lastPositionExitDate: null,
    equity: null,
    equityAvg: null
};

export const invalidPosition: BasePosition = {
    id: null,
    direction: null,
    entryDate: null,
    exitDate: null,
    profit: null,
    barsHeld: null
};
