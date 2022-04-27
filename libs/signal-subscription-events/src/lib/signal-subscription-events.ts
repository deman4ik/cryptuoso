import { ISO_DATE_REGEX } from "@cryptuoso/helpers";
import { SignalSubscriptionPosition } from "@cryptuoso/portfolio-state";

export const SIGNAL_SUBSCRIPTION_TOPIC = "signal-subscription";

export const enum SignalSubscriptionEvents {
    TRADE = "signal-subscription.trade"
}

export const SignalSubscriptionSchema = {
    [SignalSubscriptionEvents.TRADE]: {
        id: "uuid",
        signalSubscriptionId: "uuid",
        subscriptionRobotId: "uuid",
        robotId: "uuid",
        exchange: "string",
        asset: "string",
        currency: "string",
        direction: { type: "enum", values: ["long", "short"] },
        entryPrice: "number",
        entryDate: { type: "string", pattern: ISO_DATE_REGEX },
        entryAction: { type: "enum", values: ["long", "short"] },
        entryOrderType: { type: "enum", values: ["stop", "limit", "market"] },
        exitPrice: { type: "number", optional: true },
        exitDate: { type: "string", pattern: ISO_DATE_REGEX, optional: true },
        exitAction: { type: "enum", values: ["closeLong", "closeShort"], optional: true },
        exitOrderType: { type: "enum", values: ["stop", "limit", "market"], optional: true },
        volume: { type: "number", optional: true },
        status: { type: "enum", values: ["open", "canceled", "closed", "closedAuto"] },
        profit: { type: "number", optional: true },
        share: { type: "number", optional: true },
        userId: { type: "uuid", optional: true }
    }
};

export interface SignalSubscriptionTrade extends SignalSubscriptionPosition {
    userId?: string;
}
