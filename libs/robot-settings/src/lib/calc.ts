import { roundFirstSignificant } from "@cryptuoso/helpers";
import { RobotSettings, RobotVolumeType, UserRobotSettings, UserSignalSettings } from "./types";

const calcCurrencyDynamic = (volumeInCurrency: number, price: number) =>
    roundFirstSignificant(volumeInCurrency / price);

export const getRobotPositionVolume = (settings: RobotSettings | UserSignalSettings, price?: number): number => {
    if (settings.volumeType === RobotVolumeType.assetStatic) {
        return settings.volume;
    } else if (settings.volumeType === RobotVolumeType.currencyDynamic) {
        if (!price) return null;
        return calcCurrencyDynamic(settings.volumeInCurrency, price);
    } else return null;
};

export const getUserRobotPositionVolume = (settings: UserRobotSettings, price?: number): number => {
    if (settings.volumeType === RobotVolumeType.assetStatic) {
        return settings.volume;
    } else if (settings.volumeType === RobotVolumeType.currencyDynamic) {
        if (!price) return null;
        return calcCurrencyDynamic(settings.volumeInCurrency, price);
    } else return null;
};

export const assetDynamicDelta = (initialVolume: number, delta: number, profit: number) => {
    const baseVolume = initialVolume / 2;
    const mvd = delta * baseVolume;

    if (!profit) return initialVolume;
    if (profit <= -2 * mvd) return roundFirstSignificant(baseVolume);
    if (profit < 2 * mvd) return initialVolume;

    const lvl = Math.trunc((-1 + Math.sqrt(1 + 8 * (profit / mvd + 1))) / 2);

    return roundFirstSignificant(baseVolume * (lvl + 1));
};

/* export const assetDynamicDelta = (initialVolume: number, delta: number, profit: number) => {
    const baseVolume = initialVolume / 2;
    const mvd = delta * baseVolume;

    if (!profit) return initialVolume;
    if (-2 * mvd < profit && profit < 2 * mvd) return initialVolume;

    const isNegative = profit < 0;

    const absoluteLevel = Math.trunc((-1 + Math.sqrt(1 + 8 * (Math.abs(profit) / mvd + 1))) / 2);

    let result = isNegative ? baseVolume / (absoluteLevel - 1) : baseVolume * (absoluteLevel + 1);

    return roundFirstSignificant(result);
}; */
