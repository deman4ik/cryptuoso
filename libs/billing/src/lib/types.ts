import { UnitType } from "@cryptuoso/dayjs";
import { resources } from "coinbase-commerce-node";

export type SubscriptionOptionKey = "1m" | "6m" | "1y";

export interface SubscriptionOption {
    code: SubscriptionOptionKey;
    subscriptionId: string;
    name: string;
    description?: string;
    sortOrder: number;
    priceMonth: number;
    priceTotal: number;
    discount?: number;
    amount: number;
    unit: UnitType;
    available: number;
    highlight: boolean;
    subscriptionName?: string;
    subscriptionDescription?: string;
    subscriptionLimits?: SubscriptionLimits;
}

export interface SubscriptionLimits {
    trialNetProfit?: number;
}

export interface Subscription {
    id?: string;
    name: string;
    available: number;
    description?: string;
    options?: SubscriptionOption[];
    limits?: SubscriptionLimits;
}

export interface UserSub {
    id: string;
    userId: string;
    subscriptionId: string;
    subscriptionOption: SubscriptionOptionKey;
    status: "active" | "trial" | "expired" | "pending" | "canceled";
    activeFrom?: string;
    activeTo?: string;
    trialStarted?: string;
    trialEnded?: string;
    data?: { [key: string]: any };
    subscription?: SubscriptionOption;
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
    pricing?: resources.Charge["pricing"];
    info?: resources.Charge;
}
