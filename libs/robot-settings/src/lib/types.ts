export const enum VolumeSettingsType {
    assetStatic = "assetStatic",
    currencyDynamic = "currencyDynamic",
    balancePercent = "balancePercent",
    assetDynamicDelta = "assetDynamicDelta"
}

export interface AssetStaticSettings {
    volumeType: VolumeSettingsType.assetStatic;
    volume: number;
}

export interface CurrencyDynamicSettings {
    volumeType: VolumeSettingsType.currencyDynamic;
    volumeInCurrency: number;
}

export interface AssetDynamicDeltaSettings {
    volumeType: VolumeSettingsType.assetDynamicDelta;
    initialVolume: number;
    volume?: number;
    delta: number;
}

export interface BalancePercentSettings {
    volumeType: VolumeSettingsType.balancePercent;
    balancePercent: number;
}

export type RobotSettings = AssetStaticSettings | CurrencyDynamicSettings | AssetDynamicDeltaSettings;

export type UserSignalSettings = AssetStaticSettings | CurrencyDynamicSettings;

export type UserRobotSettings = RobotSettings | BalancePercentSettings;

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

export interface StrategySettings {
    [key: string]: number | string;
    requiredHistoryMaxBars?: number;
}

export const AssetStaticSettingsSchema = {
    $$strict: true,
    type: "object",
    props: {
        volumeType: { type: "equal", value: VolumeSettingsType.assetStatic },
        volume: { type: "number" }
    }
};

export const CurrencyDynamicSettingsSchema = {
    $$strict: true,
    type: "object",
    props: {
        volumeType: { type: "equal", value: VolumeSettingsType.currencyDynamic },
        volumeInCurrency: { type: "number" }
    }
};

export const AssetDynamicDeltaSettingsSchema = {
    $$strict: true,
    type: "object",
    props: {
        volumeType: { type: "equal", value: VolumeSettingsType.assetDynamicDelta },
        initialVolume: { type: "number" },
        volume: { type: "number", optional: true },
        delta: { type: "number", optional: true }
    }
};

export const BalancePercentSettingsSchema = {
    $$strict: true,
    type: "object",
    props: {
        volumeType: { type: "equal", value: VolumeSettingsType.balancePercent },
        balancePercent: { type: "number", integer: true, min: 1, max: 100 }
    }
};

export const RobotSettingsSchema = [
    AssetStaticSettingsSchema,
    CurrencyDynamicSettingsSchema,
    AssetDynamicDeltaSettingsSchema
];

export const UserSignalSettingsSchema = [AssetStaticSettingsSchema, CurrencyDynamicSettingsSchema];

export const UserRobotSettingsSchema = [
    AssetStaticSettingsSchema,
    CurrencyDynamicSettingsSchema,
    AssetDynamicDeltaSettingsSchema,
    BalancePercentSettingsSchema
];
