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
