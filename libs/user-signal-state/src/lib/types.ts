import { TradeStats } from "@cryptuoso/stats-calc";

export interface UserSignalState {
    id: string;
    robotId: string;
    userId: string;
    subscribedAt: string;
    settings: UserSignalSettings;
    volume: number;
    stats?: TradeStats;
}

export interface UserSignalSettings {
    volume: number;
    activeFrom: string;
}
