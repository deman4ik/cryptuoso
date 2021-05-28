import { roundFirstSignificant } from "@cryptuoso/helpers";
import { RobotSettings, UserSignalSettings } from "./types";

export const calcCurrencyDynamic = (volumeInCurrency: number, price: number) =>
    roundFirstSignificant(volumeInCurrency / price);

/*export const calcAssetDynamicDelta = (initialVolume: number, delta: number, profit: number) => {
    if (!profit) return initialVolume;

    const baseVolume = initialVolume / 2;

    if (profit <= -initialVolume * delta) return roundFirstSignificant(baseVolume);
    if (profit < initialVolume * delta) return initialVolume;

    const lvl = Math.trunc((-1 + Math.sqrt(1 + 8 * (profit / (baseVolume * delta) + 1))) / 2);

    return roundFirstSignificant(baseVolume * (lvl + 1));
}; */

export const calcBalancePercent = (percent: number, balance: number, price: number) => {
    return calcCurrencyDynamic((percent / 100) * balance, price);
};

export const getRobotPositionVolume = (settings: RobotSettings | UserSignalSettings, price?: number): number => {
    if (settings.volumeType === "assetStatic") {
        return settings.volume;
    } else if (settings.volumeType === "currencyDynamic") {
        if (!price) return null;
        return calcCurrencyDynamic(settings.volumeInCurrency, price);
    } else return null;
};

/* with levels down 
const calcAssetDynamicDelta = (initialVolume: number, delta: number, profit: number) => {
    const baseVolume = initialVolume / 2;
    const mvd = delta * baseVolume;

    if (!profit) return initialVolume;
    if (-2 * mvd < profit && profit < 2 * mvd) return initialVolume;

    const isNegative = profit < 0;

    const absoluteLevel = Math.trunc((-1 + Math.sqrt(1 + 8 * (Math.abs(profit) / mvd + 1))) / 2);

    let result = isNegative ? baseVolume / (absoluteLevel - 1) : baseVolume * (absoluteLevel + 1);

    return roundFirstSignificant(result);
}; */
