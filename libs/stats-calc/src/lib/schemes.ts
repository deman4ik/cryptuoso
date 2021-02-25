import Validator, { ValidationSchema } from "fastest-validator";

const validator = new Validator();

export function makeValidateFunc<T>(schema: ValidationSchema) {
    const validate = validator.compile(schema);

    return (obj: T) => validate(obj);
}

export const PositionForStatsSchema: ValidationSchema = {
    $$root: true,
    type: "object",
    props: {
        id: "uuid",
        direction: {
            type: "enum",
            values: ["short", "long"]
        },
        exitDate: "string",
        profit: "number",
        barsHeld: "number"
    }
};

export const PositionsForStatsSchema: ValidationSchema = {
    $$root: true,
    type: "array",
    items: PositionForStatsSchema
};

const StatsValueInnerSchemes: { [key: string]: ValidationSchema } = {
    NumberStrict: {
        $$root: true,
        $$strict: true,
        type: "object",
        props: {
            all: "number",
            long: "number",
            short: "number"
        }
    },
    NumberWithNulls: {
        $$root: true,
        $$strict: true,
        type: "object",
        optional: true,
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
            }
        }
    },
    String: {
        $$root: true,
        $$strict: true,
        type: "object",
        props: {
            all: "string",
            long: "string",
            short: "string"
        }
    }
};

export const StatisticsSchema: ValidationSchema = {
    $$root: true,
    $$strict: true,
    type: "object",
    props: {
        tradesCount: StatsValueInnerSchemes.NumberStrict,
        tradesWinning: StatsValueInnerSchemes.NumberStrict,
        tradesLosing: StatsValueInnerSchemes.NumberStrict,
        winRate: StatsValueInnerSchemes.NumberWithNulls,
        lossRate: StatsValueInnerSchemes.NumberWithNulls,
        avgBarsHeld: StatsValueInnerSchemes.NumberWithNulls,
        avgBarsHeldWinning: StatsValueInnerSchemes.NumberWithNulls,
        avgBarsHeldLosing: StatsValueInnerSchemes.NumberWithNulls,
        netProfit: StatsValueInnerSchemes.NumberWithNulls,
        localMax: StatsValueInnerSchemes.NumberStrict,
        avgNetProfit: StatsValueInnerSchemes.NumberWithNulls,
        grossProfit: StatsValueInnerSchemes.NumberWithNulls,
        avgProfit: StatsValueInnerSchemes.NumberWithNulls,
        avgProfitWinners: StatsValueInnerSchemes.NumberWithNulls,
        grossLoss: StatsValueInnerSchemes.NumberWithNulls,
        avgLoss: StatsValueInnerSchemes.NumberWithNulls,
        maxConsecWins: StatsValueInnerSchemes.NumberStrict,
        maxConsecLosses: StatsValueInnerSchemes.NumberStrict,
        currentWinSequence: StatsValueInnerSchemes.NumberStrict,
        currentLossSequence: StatsValueInnerSchemes.NumberStrict,
        maxDrawdown: StatsValueInnerSchemes.NumberWithNulls,
        maxDrawdownDate: StatsValueInnerSchemes.String,
        profitFactor: StatsValueInnerSchemes.NumberWithNulls,
        recoveryFactor: StatsValueInnerSchemes.NumberWithNulls,
        payoffRatio: StatsValueInnerSchemes.NumberWithNulls,
        rating: StatsValueInnerSchemes.NumberWithNulls
    }
};

const PerformanceValueInnerSchema: ValidationSchema = {
    $$root: true,
    $$strict: true,
    type: "object",
    props: {
        x: "number",
        y: "number"
    }
};

const PerformanceValsInnerSchema: ValidationSchema = {
    $$root: true,
    $$strict: true,
    type: "array",
    items: PerformanceValueInnerSchema
};

export const TradeStatsSchema: ValidationSchema = {
    $$root: true,
    type: "object",
    props: {
        statistics: StatisticsSchema,
        firstPositionEntryDate: "string",
        lastPositionExitDate: {
            type: "string" /* ,
            optional: true */
        },
        lastUpdatedAt: {
            type: "string" /* ,
            optional: true */
        },
        equity: PerformanceValsInnerSchema,
        equityAvg: PerformanceValsInnerSchema
    }
};
