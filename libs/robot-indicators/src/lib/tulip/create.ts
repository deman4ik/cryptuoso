/* from https://github.com/askmike/gekko/ */
import tulind from "tulind";
import { CandleProps } from "@cryptuoso/market";

function isNumeric(obj: any) {
    return !Array.isArray(obj) && obj - parseFloat(obj) + 1 >= 0;
}
const methods: {
    [key: string]: {
        requires: string[];
        create: (params: { [key: string]: number }) => any;
    };
} = {};
// Wrapper that executes a tulip indicator
async function execute(params: {
    indicator: {
        indicator: (inputs: number[][], options: number[]) => { [key: string]: number | number[] };
    };
    inputs: number[][];
    options: number[];
    results: string[];
}) {
    try {
        const result = await params.indicator.indicator(params.inputs, params.options);
        const results: { [key: string]: number } = {};
        for (let i = 0; i < params.results.length; i += 1) {
            const arr = result[i];
            if (arr && Array.isArray(arr) && arr.length > 0) {
                results[params.results[i]] = arr[arr.length - 1];
            } else if (arr && !Array.isArray(arr)) {
                results[params.results[i]] = arr;
            } else {
                results[params.results[i]] = null;
            }
        }
        return results;
    } catch (error) {
        throw new Error(`Failed to execute Tulip indicator ${params.indicator.indicator}`);
    }
}

// Helper that makes sure all required parameters
// for a specific talib indicator are present.
const verifyParams = (methodName: string, params: { [key: string]: number }) => {
    const requiredParams: string[] = methods[methodName].requires;

    requiredParams.forEach((paramName) => {
        if (!Object.prototype.hasOwnProperty.call(params, paramName)) {
            throw new Error(`Can't configure tulip ${methodName} requires ${paramName}`);
        }

        const val = params[paramName];

        if (!isNumeric(val)) {
            throw new Error(`Can't configure tulip ${methodName} - ${paramName} needs to be a number`);
        }
    });
};

methods.ad = {
    requires: [],
    create: (params: { [key: string]: number }) => {
        verifyParams("ad", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.ad,
                inputs: [data.high, data.low, data.close, data.volume],
                options: [],
                results: ["result"]
            });
    }
};

methods.adosc = {
    requires: ["optInFastPeriod", "optInSlowPeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("adosc", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.adosc,
                inputs: [data.high, data.low, data.close, data.volume],
                options: [params.optInFastPeriod, params.optInSlowPeriod],
                results: ["result"]
            });
    }
};

methods.adx = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("adx", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.adx,
                inputs: [data.high, data.low, data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.adxr = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("adxr", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.adxr,
                inputs: [data.high, data.low, data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.ao = {
    requires: [],
    create: (params: { [key: string]: number }) => {
        verifyParams("ao", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.ao,
                inputs: [data.high, data.low],
                options: [],
                results: ["result"]
            });
    }
};

methods.apo = {
    requires: ["optInFastPeriod", "optInSlowPeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("apo", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.apo,
                inputs: [data.close],
                options: [params.optInFastPeriod, params.optInSlowPeriod],
                results: ["result"]
            });
    }
};

methods.aroon = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("aroon", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.aroon,
                inputs: [data.high, data.low],
                options: [params.optInTimePeriod],
                results: ["aroonDown", "aroonUp"]
            });
    }
};

methods.aroonosc = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("aroonosc", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.aroonosc,
                inputs: [data.high, data.low],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.atr = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("atr", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.atr,
                inputs: [data.high, data.low, data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.avgprice = {
    requires: [],
    create: (params: { [key: string]: number }) => {
        verifyParams("avgprice", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.avgprice,
                inputs: [data.open, data.high, data.low, data.close],
                options: [],
                results: ["result"]
            });
    }
};

methods.bbands = {
    requires: ["optInTimePeriod", "optInNbStdDevs"],
    create: (params: { [key: string]: number }) => {
        verifyParams("bbands", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.bbands,
                inputs: [data.close],
                options: [params.optInTimePeriod, params.optInNbStdDevs],
                results: ["bbandsLower", "bbandsMiddle", "bbandsUpper"]
            });
    }
};

methods.bop = {
    requires: [],
    create: (params: { [key: string]: number }) => {
        verifyParams("bop", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.bop,
                inputs: [data.open, data.high, data.low, data.close],
                options: [],
                results: ["result"]
            });
    }
};

methods.cci = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("cci", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.cci,
                inputs: [data.high, data.low, data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.cmo = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("cmo", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.cmo,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.cvi = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("cvi", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.cvi,
                inputs: [data.high, data.low],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.dema = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("dema", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.dema,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.di = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("di", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.di,
                inputs: [data.high, data.low, data.close],
                options: [params.optInTimePeriod],
                results: ["diPlus", "diMinus"]
            });
    }
};

methods.dm = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("dm", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.dm,
                inputs: [data.high, data.low],
                options: [params.optInTimePeriod],
                results: ["dmPlus", "dmLow"]
            });
    }
};

methods.dpo = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("dpo", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.dpo,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.dx = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("dx", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.dx,
                inputs: [data.high, data.low, data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.ema = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("ema", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.ema,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.emv = {
    requires: [],
    create: (params: { [key: string]: number }) => {
        verifyParams("emv", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.emv,
                inputs: [data.high, data.low, data.volume],
                options: [params.optInTimePeriod],
                results: []
            });
    }
};

methods.fisher = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("fisher", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.fisher,
                inputs: [data.high, data.low],
                options: [params.optInTimePeriod],
                results: ["fisher", "fisherPeriod"]
            });
    }
};

methods.fosc = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("fosc", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.fosc,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.hma = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("hma", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.hma,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.kama = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("kama", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.kama,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.kvo = {
    requires: ["optInFastPeriod", "optInSlowPeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("kvo", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.kvo,
                inputs: [data.high, data.low, data.close, data.volume],
                options: [params.optInFastPeriod, params.optInSlowPeriod],
                results: ["result"]
            });
    }
};

methods.linreg = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("linreg", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.linreg,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.linregintercept = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("linregintercept", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.linregintercept,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.linregslope = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("linregslope", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.linregslope,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.macd = {
    requires: ["optInFastPeriod", "optInSlowPeriod", "optInSignalPeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("macd", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.macd,
                inputs: [data.close],
                options: [params.optInFastPeriod, params.optInSlowPeriod, params.optInSignalPeriod],
                results: ["macd", "macdSignal", "macdHistogram"]
            });
    }
};

methods.marketfi = {
    requires: [],
    create: (params: { [key: string]: number }) => {
        verifyParams("marketfi", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.marketfi,
                inputs: [data.high, data.low, data.volume],
                options: [],
                results: ["result"]
            });
    }
};

methods.mass = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("mass", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.mass,
                inputs: [data.high, data.low],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.medprice = {
    requires: [],
    create: (params: { [key: string]: number }) => {
        verifyParams("medprice", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.medprice,
                inputs: [data.high, data.low],
                options: [],
                results: ["result"]
            });
    }
};

methods.mfi = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("mfi", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.mfi,
                inputs: [data.high, data.low, data.close, data.volume],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.msw = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("msw", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.msw,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["mswSine", "mswLead"]
            });
    }
};

methods.natr = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("natr", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.natr,
                inputs: [data.high, data.low, data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.nvi = {
    requires: [],
    create: (params: { [key: string]: number }) => {
        verifyParams("nvi", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.nvi,
                inputs: [data.close, data.volume],
                options: [],
                results: ["result"]
            });
    }
};

methods.obv = {
    requires: [],
    create: (params: { [key: string]: number }) => {
        verifyParams("obv", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.obv,
                inputs: [data.close, data.volume],
                options: [],
                results: ["result"]
            });
    }
};

methods.ppo = {
    requires: ["optInFastPeriod", "optInSlowPeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("ppo", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.ppo,
                inputs: [data.close],
                options: [params.optInFastPeriod, params.optInSlowPeriod],
                results: ["result"]
            });
    }
};

methods.psar = {
    requires: ["optInAcceleration", "optInMaximum"],
    create: (params: { [key: string]: number }) => {
        verifyParams("psar", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.psar,
                inputs: [data.high, data.low],
                options: [params.optInAcceleration, params.optInMaximum],
                results: ["result"]
            });
    }
};

methods.pvi = {
    requires: [],
    create: (params: { [key: string]: number }) => {
        verifyParams("pvi", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.pvi,
                inputs: [data.close, data.volume],
                options: [],
                results: ["result"]
            });
    }
};

methods.qstick = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("qstick", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.qstick,
                inputs: [data.open, data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.roc = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("roc", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.roc,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.rocr = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("rocr", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.rocr,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.rsi = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("rsi", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.rsi,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.sma = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("sma", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.sma,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.stddev = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("stddev", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.stddev,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.stoch = {
    requires: ["optInFastKPeriod", "optInSlowKPeriod", "optInSlowDPeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("stoch", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.stoch,
                inputs: [data.high, data.low, data.close],
                options: [params.optInFastKPeriod, params.optInSlowKPeriod, params.optInSlowDPeriod],
                results: ["stochK", "stochD"]
            });
    }
};

methods.sum = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("sum", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.sum,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.tema = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("tema", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.tema,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.tr = {
    requires: [],
    create: (params: { [key: string]: number }) => {
        verifyParams("tr", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.tr,
                inputs: [data.high, data.low, data.close],
                options: [],
                results: ["result"]
            });
    }
};

methods.trima = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("trima", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.trima,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.trix = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("trix", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.trix,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.tsf = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("tsf", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.tsf,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.typprice = {
    requires: [],
    create: (params: { [key: string]: number }) => {
        verifyParams("typprice", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.typprice,
                inputs: [data.high, data.low, data.close],
                options: [],
                results: ["result"]
            });
    }
};

methods.ultosc = {
    requires: ["optInTimePeriod1", "optInTimePeriod2", "optInTimePeriod3"],
    create: (params: { [key: string]: number }) => {
        verifyParams("ultosc", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.ultosc,
                inputs: [data.high, data.low, data.close],
                options: [params.optInTimePeriod1, params.optInTimePeriod2, params.optInTimePeriod3],
                results: ["result"]
            });
    }
};

methods.vhf = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("vhf", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.vhf,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.vidya = {
    requires: ["optInFastPeriod", "optInSlowPeriod", "optInAlpha"],
    create: (params: { [key: string]: number }) => {
        verifyParams("vidya", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.vidya,
                inputs: [data.close],
                options: [params.optInFastPeriod, params.optInSlowPeriod, params.optInAlpha],
                results: ["result"]
            });
    }
};

methods.volatility = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("volatility", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.volatility,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.vosc = {
    requires: ["optInFastPeriod", "optInSlowPeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("vosc", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.vosc,
                inputs: [data.volume],
                options: [params.optInFastPeriod, params.optInSlowPeriod],
                results: ["result"]
            });
    }
};

methods.vwma = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("vwma", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.vwma,
                inputs: [data.close, data.volume],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.wad = {
    requires: [],
    create: (params: { [key: string]: number }) => {
        verifyParams("wad", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.wad,
                inputs: [data.high, data.low, data.close],
                options: [],
                results: ["result"]
            });
    }
};

methods.wcprice = {
    requires: [],
    create: (params: { [key: string]: number }) => {
        verifyParams("wcprice", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.wcprice,
                inputs: [data.high, data.low, data.close],
                options: [],
                results: ["result"]
            });
    }
};

methods.wilders = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("wilders", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.wilders,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.willr = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("willr", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.willr,
                inputs: [data.high, data.low, data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.wma = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("wma", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.wma,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

methods.zlema = {
    requires: ["optInTimePeriod"],
    create: (params: { [key: string]: number }) => {
        verifyParams("zlema", params);

        return (data: CandleProps) =>
            execute({
                indicator: tulind.indicators.zlema,
                inputs: [data.close],
                options: [params.optInTimePeriod],
                results: ["result"]
            });
    }
};

export default methods;
