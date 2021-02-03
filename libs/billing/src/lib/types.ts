import { UnitType } from "@cryptuoso/dayjs";
import { resources } from "coinbase-commerce-node";

export type SubscriptionOptionKey = "1m" | "6m" | "1y" | "2y";

export interface SubscriptionOption {
    price: number;
    discount: number;
    amount: number;
    unit: UnitType;
}

export interface SubscriptionLimits {
    trialNetProfit: number;
    maxRobots: number;
}

export interface Subscription {
    id: string;
    name: string;
    description?: string;
    options: {
        [key: string]: SubscriptionOption;
    };
    limits: SubscriptionLimits;
}

export interface UserSub {
    id: string;
    userId: string;
    subscriptionId: string;
    subscriptionOption: SubscriptionOptionKey;
    status: "active" | "trial" | "expired";
    activeFrom?: string;
    activeTo?: string;
    trialStarted?: string;
    trialEnded?: string;
    data?: { [key: string]: any };
    subscription?: Subscription;
    payments?: UserPayment[];
}

export interface UserPayment {
    id: string;
    userId: string;
    userSubId: string;
    provider: "coinbase.commerce";
    code: string;
    status: "NEW" | "PENDING" | "COMPLETED" | "UNRESOLVED" | "RESOLVED" | "EXPIRED" | "CANCELED";
    price: number;
    createdAt: string;
    expiresAt?: string;
    addresses?: resources.Charge["addresses"];
    exchangeRates?: { [key: string]: string };
    pricing?: resources.Charge["pricing"];
    info?: resources.Charge;
}
