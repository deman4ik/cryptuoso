import { SubscriptionOptionKey } from "@cryptuoso/billing";

export const enum UserSubEvents {
    CREATE = "in-user-sub.create",
    CHECKOUT = "in-user-sub.checkout",
    CANCEL = "in-user-sub.cancel",
    CHECK_PAYMENT = "in-user-sub.check-payment",
    ERROR = "out-user-sub.error"
}

export const UserSubSchema = {
    [UserSubEvents.CREATE]: {
        subscriptionId: "uuid",
        subscriptionOption: {
            type: "enum",
            values: ["1m", "6m", "1y", "2y"]
        }
    },
    [UserSubEvents.CHECKOUT]: {
        userSubId: "uuid"
    },
    [UserSubEvents.CANCEL]: {
        userSubId: "uuid"
    },
    [UserSubEvents.CHECK_PAYMENT]: {
        chargeId: "string",
        provider: { type: "string", default: "coinbase.commerce" }
    },
    [UserSubEvents.ERROR]: {
        userSubId: "uuid",
        userId: "uuid",
        error: "string"
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
    provider: string;
}

export interface UserSubError {
    userSubId: string;
    userId: string;
    error: string;
}
