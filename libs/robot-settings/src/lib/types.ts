export const enum VolumeSettingsType {
    assetStatic = "assetStatic",
    currencyDynamic = "currencyDynamic",
    balancePercent = "balancePercent",
    assetDynamicDelta = "assetDynamicDelta"
}

export interface BaseSettings {
    initialBalance?: number;
    SMAWindow?: number;
    margin?: number;
}

export interface AssetStaticSettings extends BaseSettings {
    volumeType: VolumeSettingsType.assetStatic;
    volume: number;
}

export interface CurrencyDynamicSettings extends BaseSettings {
    volumeType: VolumeSettingsType.currencyDynamic;
    volumeInCurrency: number;
}

/*export interface AssetDynamicDeltaSettings extends BaseSettings {
    volumeType: VolumeSettingsType.assetDynamicDelta;
    initialVolume: number;
    volume?: number;
    delta?: number;
}*/

export interface BalancePercentSettings extends BaseSettings {
    volumeType: VolumeSettingsType.balancePercent;
    balancePercent: number;
}

export type RobotSettings = AssetStaticSettings | CurrencyDynamicSettings;

export type UserSignalSettings = AssetStaticSettings | CurrencyDynamicSettings;

export type UserRobotSettings = {
    active?: boolean;
    emulated?: boolean;
    share?: number;
} & (RobotSettings | BalancePercentSettings); //| AssetDynamicDeltaSettings;

export interface StrategySettings {
    [key: string]: number | string;
    requiredHistoryMaxBars?: number;
}

export const AssetStaticSettingsSchema = {
    //$$strict: true,
    type: "object",
    props: {
        volumeType: { type: "equal", value: VolumeSettingsType.assetStatic },
        volume: { type: "number" }
    }
};

export const CurrencyDynamicSettingsSchema = {
    //$$strict: true,
    type: "object",
    props: {
        volumeType: { type: "equal", value: VolumeSettingsType.currencyDynamic },
        volumeInCurrency: { type: "number" }
    }
};

/*export const AssetDynamicDeltaSettingsSchema = {
    // $$strict: true,
    type: "object",
    props: {
        volumeType: { type: "equal", value: VolumeSettingsType.assetDynamicDelta },
        initialVolume: { type: "number" },
        volume: { type: "number", optional: true },
        delta: { type: "number", optional: true }
    }
};*/

export const BalancePercentSettingsSchema = {
    // $$strict: true,
    type: "object",
    props: {
        volumeType: { type: "equal", value: VolumeSettingsType.balancePercent },
        balancePercent: { type: "number", integer: true, min: 1 }
    }
};

export const RobotSettingsSchema = [
    AssetStaticSettingsSchema,
    CurrencyDynamicSettingsSchema
    //  AssetDynamicDeltaSettingsSchema
];

export const UserSignalSettingsSchema = [AssetStaticSettingsSchema, CurrencyDynamicSettingsSchema];

export const UserRobotSettingsSchema = [
    AssetStaticSettingsSchema,
    CurrencyDynamicSettingsSchema,
    //  AssetDynamicDeltaSettingsSchema,
    BalancePercentSettingsSchema
];
