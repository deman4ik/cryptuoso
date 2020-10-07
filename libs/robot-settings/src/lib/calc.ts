import { roundFirstSignificant } from "@cryptuoso/helpers";
import { RobotSettings, RobotVolumeType, UserRobotSettings, UserSignalSettings } from "./types";
import { round } from "@cryptuoso/helpers";

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
    const minVolume = initialVolume / 2;
    const mvd = delta * minVolume;

    if (profit < mvd || !profit) return null;

    if (mvd <= profit && profit < mvd * 2) return round(minVolume, 2);

    const lvl = Math.trunc((-1 + Math.sqrt(1 + 8 * (profit / mvd + 1))) / 2);

    //if (lvl < 2 || !lvl) return 0; // Not need

    return round(minVolume * (lvl + 1), 2);
};
