export const enum RobotVolumeType {
    assetStatic = "assetStatic",
    currencyDynamic = "currencyDynamic",
    assetDynamicDelta = "assetDynamicDelta"
}

export const enum UserRobotVolumeType {
    balancePercent = "balancePercent"
}

export interface RobotSettingsAssetStatic {
    volumeType: RobotVolumeType.assetStatic;
    volume: number;
}

export interface RobotSettingsCurrencyDynamic {
    volumeType: RobotVolumeType.currencyDynamic;
    volumeInCurrency: number;
}

export type RobotSettings = RobotSettingsAssetStatic | RobotSettingsCurrencyDynamic;

export type UserSignalSettings = RobotSettingsAssetStatic | RobotSettingsCurrencyDynamic;

export interface UserRobotSettingsBalancePercent {
    volumeType: UserRobotVolumeType.balancePercent;
    balancePercent: number;
}

export type UserRobotSettings = RobotSettings | UserRobotSettingsBalancePercent;

export interface RobotTradeSettings {
    orderTimeout: number;
    slippage?: {
        entry?: {
            stepPercent: number;
            count?: number;
        };
        exit?: {
            stepPercent: number;
            count?: number;
        };
    };
    deviation?: {
        entry?: number;
        exit?: number;
    };
}
