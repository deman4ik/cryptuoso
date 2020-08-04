import {RobotStats, PositionDataForStats} from "../trade-statistics"

export const invalidStatistics: RobotStats = {
    lastUpdatedAt: null,
    performance: null,
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
    lastPositionExitDate: null
}

export const invalidPosition: PositionDataForStats = {
    id: null,
    direction: null,
    exitDate: null,
    profit: null,
    barsHeld: null
};