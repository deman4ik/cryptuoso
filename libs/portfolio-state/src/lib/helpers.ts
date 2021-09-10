import { calcPercentValue, nvl, round } from "@cryptuoso/helpers";
import { PortfolioSettings } from "./types";

export function getPortfolioBalance(
    initialBalance: PortfolioSettings["initialBalance"],
    tradingAmountType: PortfolioSettings["tradingAmountType"],
    balancePercent?: PortfolioSettings["balancePercent"],
    tradingAmountCurrency?: PortfolioSettings["tradingAmountCurrency"]
) {
    if (!initialBalance || initialBalance < 0) throw new Error("Initial balance is insufficient");
    if (tradingAmountType === "balancePercent") {
        if (!balancePercent) throw new Error("Balance percent is required");
        return calcPercentValue(initialBalance, balancePercent);
    } else if (tradingAmountType === "currencyFixed") {
        if (!tradingAmountCurrency) throw new Error("Trading amount in currency is required");
        return tradingAmountCurrency;
    } else throw new Error("Unsupported trading amount type");
}

export function getPortfolioRobotsCount(balance: number, minTradeAmount: number) {
    return round(balance / minTradeAmount);
}

export function getPortfolioMinBalance(
    portfolioBalance: number,
    minTradeAmount: number,
    minRobotsCount = nvl(process.env.MIN_PORTFOLIO_ROBOTS, 5),
    leverage = 2,
    throwError = true
) {
    const minBalance = round((minTradeAmount * minRobotsCount) / leverage);
    if (portfolioBalance < minBalance && throwError)
        throw new Error(`Portfolio balance is insufficient. Mininum Balance: ${minBalance}$`);
    return minBalance;
}

export function calcUserLeverage(
    recommendedBalance: number,
    defaultLeverage: number,
    maxLeverage: number,
    userBalance: number
) {
    const minBalance = recommendedBalance / maxLeverage;

    if (userBalance < minBalance) throw new Error("Portfolio balance is insufficient");
    else if (userBalance >= recommendedBalance) return defaultLeverage;
    else {
        const levelLeverage = 100 / defaultLeverage / 100;
        const leverageLevels = [...Array(defaultLeverage).keys()].reverse().map((k) => {
            if (k + 1 === defaultLeverage)
                return {
                    leverage: defaultLeverage,
                    limit: recommendedBalance
                };
            if (k === 0)
                return {
                    leverage: 1,
                    limit: minBalance
                };
            return {
                leverage: k + 1,
                limit: recommendedBalance * levelLeverage * k + 1
            };
        });

        const { leverage } = leverageLevels.find(({ limit }) => {
            return limit < userBalance;
        });
        return leverage;
    }
}
