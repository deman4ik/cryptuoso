import { TradeStats, SettingsVolumes } from "@cryptuoso/trade-statistics";

export interface UserSignal {
    id: string;
    robotId?: string;
    userId?: string;
    subscribedAt?: string;
}

export interface UserSignalWithVolumes extends UserSignal {
    volumes?: SettingsVolumes;
}

export type UserSignalStats = UserSignalWithVolumes & TradeStats;
