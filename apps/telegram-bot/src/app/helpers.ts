import dayjs from "@cryptuoso/dayjs";
import {
    AssetStaticSettings,
    BalancePercentSettings,
    CurrencyDynamicSettings,
    RobotSettings,
    UserRobotSettings,
    UserSignalSettings
} from "@cryptuoso/robot-settings";
import { BaseStatistics } from "@cryptuoso/stats-calc";

export function getStatisticsText(
    ctx: any,
    statistics: BaseStatistics,
    settings?: RobotSettings | UserSignalSettings | UserRobotSettings,
    asset?: string
) {
    let volumeText = "";
    if (settings && asset) {
        volumeText = getVolumeText(ctx, settings, asset);
    }

    return `${volumeText}${ctx.i18n.t("robot.statsProfit", {
        ...statistics,
        firstPositionEntryDate: statistics.firstPositionEntryDate
            ? dayjs.utc().to(statistics.firstPositionEntryDate)
            : "",
        lastPositionExitDate: statistics.lastPositionExitDate ? dayjs.utc().to(statistics.lastPositionExitDate) : "",
        maxDrawdownDate: statistics.maxDrawdownDate
            ? dayjs.utc(statistics.maxDrawdownDate).format("YYYY-MM-DD HH:mm UTC")
            : "-"
    })}${ctx.i18n.t("robot.statsWinners", statistics)}${ctx.i18n.t("robot.statsLosses", statistics)}${ctx.i18n.t(
        "robot.statsLastUpdatedAt",
        {
            lastUpdatedAt: dayjs.utc(statistics.lastUpdatedAt).format("YYYY-MM-DD HH:mm UTC")
        }
    )}`;
}

export function getVolumeText(
    ctx: any,
    settings: RobotSettings | UserSignalSettings | UserRobotSettings,
    asset: string
) {
    return ctx.i18n.t("robot.volume", getVolumeValueText(ctx, settings, asset));
}

export function getVolumeValueText(
    ctx: any,
    settings: RobotSettings | UserSignalSettings | UserRobotSettings,
    asset: string
) {
    const { volumeType } = settings;
    let volumeValue;
    if (volumeType === "assetStatic") {
        const { volume } = settings as AssetStaticSettings;
        volumeValue = `${volume} ${asset}`;
    } else if (volumeType === "currencyDynamic") {
        const { volumeInCurrency } = settings as CurrencyDynamicSettings;
        volumeValue = `${volumeInCurrency} $`;
    } else if (volumeType === "balancePercent") {
        const { balancePercent } = settings as BalancePercentSettings;
        volumeValue = `${balancePercent} %`;
    }
    return { volume: volumeValue, type: ctx.i18n.t(`volumeType.${settings.volumeType}`) };
}

export function getVolumeValue(settings: RobotSettings | UserSignalSettings | UserRobotSettings) {
    const { volumeType } = settings;
    let volumeValue;
    if (volumeType === "assetStatic") {
        const { volume } = settings as AssetStaticSettings;
        volumeValue = volume;
    } else if (volumeType === "currencyDynamic") {
        const { volumeInCurrency } = settings as CurrencyDynamicSettings;
        volumeValue = volumeInCurrency;
    } else if (volumeType === "balancePercent") {
        const { balancePercent } = settings as BalancePercentSettings;
        volumeValue = balancePercent;
    }
    return volumeValue;
}
