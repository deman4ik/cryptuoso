import { Events } from "@cryptuoso/events";
import logger from "@cryptuoso/logger";
import { SignalSubscriptionPosition } from "@cryptuoso/portfolio-state";
import { SignalSubscriptionEvents, SignalSubscriptionTrade } from "@cryptuoso/signal-subscription-events";

export async function openTelegramPosition(
    events: Events,
    userId: string,
    position: SignalSubscriptionPosition
): Promise<SignalSubscriptionPosition> {
    let error;
    try {
        await events.emit<SignalSubscriptionTrade>({
            type: SignalSubscriptionEvents.TRADE,
            data: { ...position, userId }
        });
    } catch (err) {
        logger.error(err);
        error = err.message;
    }

    return { ...position, error, status: error ? "canceled" : "open" };
}

export async function closeTelegramPosition(
    events: Events,
    userId: string,
    position: SignalSubscriptionPosition,
    force = false
): Promise<SignalSubscriptionPosition> {
    let error;
    try {
        await events.emit<SignalSubscriptionTrade>({
            type: SignalSubscriptionEvents.TRADE,
            data: { ...position, userId }
        });
    } catch (err) {
        logger.error(err);
        error = err.message;
    }
    return { ...position, error, status: error ? "open" : force ? "closedAuto" : "closed" };
}
