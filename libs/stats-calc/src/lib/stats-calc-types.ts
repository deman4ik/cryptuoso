import Validator, { ValidationSchema, ValidationError } from "fastest-validator";
import { BasePosition, PositionDirection } from "@cryptuoso/market";
import { Statistics } from "./stats-calc";

const validator = new Validator();

function makeValidateFunc<T>(schema: ValidationSchema) {
    const validate = validator.compile(schema);

    return (obj: T) => validate(obj) === true;
}

export const isPositionForStats = makeValidateFunc<BasePosition>({
    id: "uuid",
    direction: {
        type: "string",
        values: [PositionDirection.short, PositionDirection.long]
    },
    exitDate: "date",
    profit: "number",
    barsHeld: "number"
});

const StatsNumberValueSchemes: { [key: string]: ValidationSchema } = {
    strict: {
        type: "object",
        props: {
            all: "number",
            long: "number",
            short: "number",
            $$strict: true
        }
    },
    withNulls: {
        type: "object",
        props: {
            all: {
                type: "number",
                optional: true
            },
            long: {
                type: "number",
                optional: true
            },
            short: {
                type: "number",
                optional: true
            },
            $$strict: true
        }
    }
};

const StatsStringValueSchema: ValidationSchema = {
    type: "object",
    props: {
        all: "string",
        long: "string",
        short: "string",
        $$strict: true
    }
};

const StatisticsSchema: ValidationSchema = {
    tradesCount: StatsNumberValueSchemes.strict,
    tradesWinning: StatsNumberValueSchemes.strict,
    tradesLosing: StatsNumberValueSchemes.strict,
    winRate: StatsNumberValueSchemes.withNulls,
    lossRate: StatsNumberValueSchemes.withNulls,
    avgBarsHeld: StatsNumberValueSchemes.withNulls,
    avgBarsHeldWinning: StatsNumberValueSchemes.withNulls,
    avgBarsHeldLosing: StatsNumberValueSchemes.withNulls,
    netProfit: StatsNumberValueSchemes.withNulls,
    localMax: StatsNumberValueSchemes.strict,
    avgNetProfit: StatsNumberValueSchemes.withNulls,
    grossProfit: StatsNumberValueSchemes.withNulls,
    avgProfit: StatsNumberValueSchemes.withNulls,
    avgProfitWinners: StatsNumberValueSchemes.withNulls,
    grossLoss: StatsNumberValueSchemes.withNulls,
    avgLoss: StatsNumberValueSchemes.withNulls,
    maxConsecWins: StatsNumberValueSchemes.strict,
    maxConsecLosses: StatsNumberValueSchemes.strict,
    currentWinSequence: StatsNumberValueSchemes.strict,
    currentLossSequence: StatsNumberValueSchemes.strict,
    maxDrawdown: StatsNumberValueSchemes.withNulls,
    maxDrawdownDate: StatsStringValueSchema,
    profitFactor: StatsNumberValueSchemes.withNulls,
    recoveryFactor: StatsNumberValueSchemes.withNulls,
    payoffRatio: StatsNumberValueSchemes.withNulls,
    rating: StatsNumberValueSchemes.withNulls
};

export const isStatistics = makeValidateFunc<Statistics>(StatisticsSchema);

const PerformanceValueSchema: ValidationSchema = {
    type: "object",
    props: {
        x: "number",
        y: "number",
        $$strict: true
    }
};

const PerformanceValsSchema: ValidationSchema = {
    type: "array",
    items: PerformanceValueSchema
};

export const isTradeStats = makeValidateFunc<Statistics>({
    statistics: StatisticsSchema,
    lastPositionExitDate: "date",
    lastUpdatedAt: "date",
    equity: PerformanceValsSchema,
    equityAvg: PerformanceValsSchema
});
