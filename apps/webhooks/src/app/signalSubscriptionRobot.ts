import dayjs from "@cryptuoso/dayjs";
import { Events } from "@cryptuoso/events";
import { OrderType, SignalEvent, TradeAction } from "@cryptuoso/market";
import {
    SignalRobotDB,
    SignalSubscriptionDB,
    SignalSubscriptionPosition,
    SignalSubscriptionState
} from "@cryptuoso/portfolio-state";
import { v4 as uuid } from "uuid";
import { closeTelegramPosition, openTelegramPosition } from "./telegramProvider";
import { closeZignalyPosition, openZignalyPosition } from "./zignalyProvider";

export class SignalSubscriptionRobot {
    #robot: {
        id: SignalRobotDB["id"];
        signalSubscriptionId: SignalRobotDB["signalSubscriptionId"];
        robotId: SignalRobotDB["robotId"];
        active: SignalRobotDB["active"];
        share: SignalRobotDB["share"];
        state: SignalRobotDB["state"];
        exchange: SignalSubscriptionDB["exchange"];
        type: SignalSubscriptionDB["type"];
        url: SignalSubscriptionDB["url"];
        token: SignalSubscriptionDB["token"];
        settings: SignalSubscriptionState["settings"];
        currentPrice: number;
        userId?: string;
    };
    #openPositions: SignalSubscriptionPosition[] = [];
    #positionsToSave: SignalSubscriptionPosition[] = [];
    #events: Events;
    constructor(props: {
        robot: {
            id: SignalRobotDB["id"];
            signalSubscriptionId: SignalRobotDB["signalSubscriptionId"];
            robotId: SignalRobotDB["robotId"];
            active: SignalRobotDB["active"];
            share: SignalRobotDB["share"];
            state: SignalRobotDB["state"];
            exchange: SignalSubscriptionDB["exchange"];
            type: SignalSubscriptionDB["type"];
            url: SignalSubscriptionDB["url"];
            token: SignalSubscriptionDB["token"];
            settings: SignalSubscriptionState["settings"];
            currentPrice: number;
        };
        events: Events;
    }) {
        this.#robot = props.robot;
        this.#robot.state = this.#robot.state || {};
        this.#openPositions = [];
        this.#events = props.events;
    }

    handleOpenPositions(positions: SignalSubscriptionPosition[]) {
        if (positions && Array.isArray(positions) && positions.length) this.#openPositions = positions;
    }

    async handleSignal(signal: SignalEvent) {
        if (signal.action === TradeAction.long || signal.action === TradeAction.short) {
            if (this.#robot.active === false) return;

            if (signal.positionParentId) {
                const activeParents = this.#openPositions.filter(
                    (pos) =>
                        (pos.direction === "long" && signal.action === TradeAction.short) ||
                        (pos.direction === "short" && signal.action === TradeAction.long)
                );
                for (const position of activeParents) {
                    await this.#closePosition(position);
                }
            } else {
                const previousActivePositions = this.#openPositions.filter(
                    (pos) =>
                        (pos.direction === "long" && signal.action === TradeAction.short) ||
                        (pos.direction === "short" && signal.action === TradeAction.long)
                );
                if (previousActivePositions?.length) {
                    for (const position of previousActivePositions) {
                        await this.#closePosition(position);
                    }
                }
            }

            const hasActivePositionWithSameDirection = this.#openPositions.filter(
                (pos) =>
                    (pos.direction === "long" && signal.action === TradeAction.long) ||
                    (pos.direction === "short" && signal.action === TradeAction.short)
            );

            if (!hasActivePositionWithSameDirection.length) {
                await this.#openPosition(signal);
            }
        } else {
            const previousPositions = this.#openPositions.filter(
                (pos) =>
                    (pos.direction === "long" && signal.action === TradeAction.closeLong) ||
                    (pos.direction === "short" && signal.action === TradeAction.closeShort)
            );

            for (const position of previousPositions) {
                await this.#closePosition(position, signal);
            }
        }
        this.#robot.state.latestSignal = signal;
    }

    #openPosition = async (signal: SignalEvent) => {
        let position: SignalSubscriptionPosition = {
            id: uuid(),
            signalSubscriptionId: this.#robot.signalSubscriptionId,
            subscriptionRobotId: this.#robot.id,
            robotId: this.#robot.robotId,
            exchange: signal.exchange,
            asset: signal.asset,
            currency: signal.currency,
            leverage: this.#robot.settings.leverage || 1,
            direction: signal.action === TradeAction.long ? "long" : "short",
            entryPrice: signal.price,
            entryDate: dayjs.utc().toISOString(),
            entryOrderType: signal.orderType,
            entryAction: signal.action,
            share: this.#robot.share
        };

        if (this.#robot.type === "zignaly")
            position = await openZignalyPosition(this.#robot.url, this.#robot.token, position);
        else if (this.#robot.type === "telegram")
            position = await openTelegramPosition(this.#events, this.#robot.userId, position);
        else throw new Error("Not supported"); //TODO universal webhook

        this.#positionsToSave = [...this.#positionsToSave, position];
    };

    #closePosition = async (openPosition: SignalSubscriptionPosition, signal?: SignalEvent) => {
        let position: SignalSubscriptionPosition = {
            ...openPosition,
            exitPrice: signal?.price || this.#robot.currentPrice,
            exitDate: dayjs.utc().toISOString(),
            exitAction:
                signal?.action || openPosition.direction === "long" ? TradeAction.closeLong : TradeAction.closeShort,
            exitOrderType: signal?.orderType || OrderType.market
        };

        //TODO: profit with fees
        if (this.#robot.type === "zignaly")
            position = await closeZignalyPosition(this.#robot.url, this.#robot.token, position, !signal);
        else if (this.#robot.type === "telegram")
            position = await closeTelegramPosition(this.#events, this.#robot.userId, position);
        else throw new Error("Not supported"); //TODO universal webhook
        this.#positionsToSave = [...this.#positionsToSave, position];
    };

    get positionsToSave() {
        return this.#positionsToSave;
    }

    get hasClosedPositions() {
        return this.#positionsToSave.filter((pos) => pos.status === "closed" || pos.status === "closedAuto").length > 0;
    }

    get state() {
        return this.#robot.state;
    }
}
