import { BaseError } from "@cryptuoso/errors";
import { round, roundFirstSignificant } from "@cryptuoso/helpers";
import { UserRobotDB, UserRobotStateExt } from "./types";
import { calcBalancePercent, calcCurrencyDynamic } from "@cryptuoso/robot-settings";

export function getCurrentUserRobotSettings({
    settings,
    currentPrice,
    totalBalanceUsd,
    userPortfolioId,
    userPortfolio: { settings: userPortfolioSettings },
    limits,
    precision
}: {
    settings: UserRobotStateExt["settings"];
    currentPrice?: UserRobotStateExt["currentPrice"];
    totalBalanceUsd: UserRobotStateExt["totalBalanceUsd"];
    userPortfolioId?: UserRobotStateExt["userPortfolioId"];
    userPortfolio?: UserRobotStateExt["userPortfolio"];
    limits?: UserRobotStateExt["limits"];
    precision?: UserRobotStateExt["precision"];
}): UserRobotDB["settings"] {
    let volume: number;
    let volumeInCurrency: number;
    let balance;

    if (userPortfolioId) {
        balance = totalBalanceUsd;
        if (userPortfolioSettings.tradingAmountType === "balancePercent") {
            const currentPortfolioBalance = (userPortfolioSettings.balancePercent / 100) * balance;

            ({ volume, volumeInCurrency } = calcBalancePercent(settings.share, currentPortfolioBalance, currentPrice));
        } else if (userPortfolioSettings.tradingAmountType === "currencyFixed") {
            ({ volume, volumeInCurrency } = calcBalancePercent(
                settings.share,
                userPortfolioSettings.tradingAmountCurrency,
                currentPrice
            ));
        }
        if (userPortfolioSettings.leverage) {
            volume = roundFirstSignificant(volume * userPortfolioSettings.leverage);
            volumeInCurrency = round(volume * currentPrice, 2);
        }
    }

    let downgrade = false;
    if (volume < limits.min.amount) {
        volume = limits.min.amount;
        volumeInCurrency = limits.min.amountUSD;
        downgrade = true;
    } else if (limits.max?.amount && volume > limits.max?.amount) {
        volume = limits.max?.amount;
        volumeInCurrency = limits.max.amountUSD;
    }

    if (volumeInCurrency < 10) {
        volumeInCurrency = 10;
        volume = calcCurrencyDynamic(volumeInCurrency, currentPrice);
        downgrade = true;
    }

    if (volume > 100) {
        volume = round(volume);
        volumeInCurrency = round(volume * currentPrice, 2);
    }

    if (userPortfolioId && (downgrade || userPortfolioSettings.leverage === 1)) {
        if (balance < volumeInCurrency) throw new Error("Exchange account balance is insufficient");
    }

    volume = round(volume, precision?.amount || 6);

    if (volume <= 0)
        throw new BaseError(
            "Wrong volume value",
            {
                volume
            },
            "ERR_CONFLICT"
        );

    return { ...settings, volume };
}
