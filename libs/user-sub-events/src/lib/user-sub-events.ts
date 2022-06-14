import { SubscriptionOptionKey, UserPayment, UserSub } from "@cryptuoso/billing";

export const IN_USER_SUB_TOPIC = "in-user-sub";

export const OUT_USER_SUB_TOPIC = "out-user-sub";

export const enum UserSubInEvents {
    CREATE = "in-user-sub.create",
    CHECKOUT = "in-user-sub.checkout",
    CANCEL = "in-user-sub.cancel",
    CHECK_PAYMENT = "in-user-sub.check-payment"
}

export const enum UserSubOutEvents {
    ERROR = "out-user-sub.error",
    PAYMENT_STATUS = "out-user-sub.payment-status",
    USER_SUB_STATUS = "out-user-sub.user-sub-status"
}

export const UserSubInSchema = {
    [UserSubInEvents.CREATE]: {
        subscriptionId: "uuid",
        subscriptionOption: {
            type: "enum",
            values: ["1m", "6m", "1y"]
        }
    },
    [UserSubInEvents.CHECKOUT]: {
        userSubId: "uuid"
    },
    [UserSubInEvents.CANCEL]: {
        userSubId: "uuid"
    },
    [UserSubInEvents.CHECK_PAYMENT]: {
        chargeId: "string",
        provider: { type: "string", default: "coinbase.commerce" }
    }
};

export const UserSubOutSchema = {
    [UserSubOutEvents.ERROR]: {
        userSubId: "uuid",
        userId: "uuid",
        error: "string",
        userPayment: { type: "object", optional: true }
    },
    [UserSubOutEvents.PAYMENT_STATUS]: {
        userSubId: "uuid",
        userId: "uuid",
        userPaymentId: "uuid",
        status: "string",
        price: { type: "number", optional: true },
        context: { type: "string", optional: true },
        subscriptionName: "string",
        subscriptionOptionName: "string"
    },
    [UserSubOutEvents.USER_SUB_STATUS]: {
        userSubId: "uuid",
        userId: "uuid",
        status: "string",
        subscriptionName: "string",
        subscriptionOptionName: "string",
        activeFrom: { type: "string", optional: true },
        activeTo: { type: "string", optional: true },
        trialStarted: { type: "string", optional: true },
        trialEnded: { type: "string", optional: true }
    }
};

export interface UserSubCreate {
    subscriptionId: string;
    subscriptionOption: SubscriptionOptionKey;
}

export interface UserSubCheckout {
    userSubId: string;
}

export interface UserSubCancel {
    userSubId: string;
}

export interface UserSubCheckPayment {
    chargeId: string;
    provider?: string;
}

export interface UserSubErrorEvent {
    userSubId: string;
    userId: string;
    error: string;
    timestamp: string;
    subscriptionName: string;
    subscriptionOptionName: string;
    userPayment?: UserPayment;
}

export interface UserSubPaymentStatusEvent {
    userSubId: string;
    userId: string;
    userPaymentId: string;
    code: string;
    status: UserPayment["status"];
    context?: string;
    price?: number;
    timestamp: string;
    subscriptionName: string;
    subscriptionOptionName: string;
}

export interface UserSubStatusEvent {
    userSubId: string;
    userId: string;
    status: UserSub["status"];
    context?: string;
    subscriptionName: string;
    subscriptionOptionName: string;
    timestamp: string;
    activeTo?: string;
    trialEnded?: string;
}
