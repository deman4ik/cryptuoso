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
        subsciptionId: "uuid",
        subscriptionOption: {
            type: "enum",
            values: ["1m", "6m", "1y", "2y"]
        }
    },
    [UserSubEvents.CHECKOUT]: {
        subcriptionId: "uuid"
    },
    [UserSubEvents.CANCEL]: {
        subcriptionId: "uuid"
    },
    [UserSubEvents.CHECK_PAYMENT]: {
        code: "string",
        provider: { type: "string", default: "coinbase.commerce" }
    },
    [UserSubEvents.ERROR]: {
        subsciptionId: "uuid",
        userId: "uuid",
        error: "string"
    }
};

export interface UserSubCreate {
    subsciptionId: string;
    subscriptionOption: SubscriptionOptionKey;
}

export interface UserSubCheckout {
    subsciptionId: string;
}

export interface UserSubCancel {
    subsciptionId: string;
}

export interface UserSubCheckPayment {
    code: string;
    provider: string;
}

export interface UserSubError {
    subsciptionId: string;
    userId: string;
    error: string;
}
