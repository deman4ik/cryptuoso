import { Backtester, BacktesterState, Status } from "./backtester-state";
import dayjs from "@cryptuoso/dayjs";

const config: BacktesterState = {
    id: "some_id",
    robotId: "some_robot_id",
    exchange: "bitfinex",
    asset: "BTC",
    currency: "USD",
    timeframe: 1440,
    strategy: "parabolic",
    dateFrom: dayjs.utc("2017-01-01 00:00").toISOString(),
    dateTo: dayjs.utc("2017-01-30 00:00").toISOString(),
    settings: {},
    status: Status.queued
};

describe("Test 'Backtester' Class", () => {
    describe("Test init", () => {
        it("Should create new instance", () => {
            const backtester = new Backtester(config);
            expect(backtester.state).toStrictEqual({
                id: "some_id",
                robotId: "some_robot_id",
                exchange: "bitfinex",
                asset: "BTC",
                currency: "USD",
                timeframe: 1440,
                strategy: "parabolic",
                dateFrom: "2017-01-01T00:00:00.000Z",
                dateTo: "2017-01-30T00:00:00.000Z",
                settings: {
                    local: false,
                    populateHistory: false,
                    saveSignals: true,
                    savePositions: true,
                    saveLogs: false
                },
                strategySettings: undefined,
                robotSettings: undefined,
                totalBars: 0,
                processedBars: 0,
                leftBars: 0,
                completedPercent: 0,
                status: "queued",
                startedAt: null,
                finishedAt: null,
                robotState: null,
                error: null
            });
        });
    });
});
