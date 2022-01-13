import dayjs from "@cryptuoso/dayjs";
import { OrderType, TradeAction } from "@cryptuoso/market";
import {
    SignalRobotDB,
    SignalSubscriptionDB,
    SignalSubscriptionPosition,
    SignalSubscriptionState
} from "@cryptuoso/portfolio-state";
import { Signal } from "@cryptuoso/robot-events";
import { v4 as uuid } from "uuid";
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
    };
    #openPositions: SignalSubscriptionPosition[] = [];
    #positionsToSave: SignalSubscriptionPosition[] = [];

    constructor(robot: {
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
    }) {
        this.#robot = robot;
        this.#robot.state = this.#robot.state || {};
        this.#openPositions = [];
    }

    handleOpenPositions(positions: SignalSubscriptionPosition[]) {
        if (positions && Array.isArray(positions) && positions.length) this.#openPositions = positions;
    }

    async handleSignal(signal: Signal) {
        if (signal.action === TradeAction.long || signal.action === TradeAction.short) {
            if (this.#robot.active === false) return;
            let hasPreviousActivePositions = false;

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
                    hasPreviousActivePositions = true;
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

    #openPosition = async (signal: Signal) => {
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
            entryOrderType: "limit",
            share: this.#robot.share
        };

        position = await openZignalyPosition(this.#robot.url, this.#robot.token, position);

        this.#positionsToSave = [...this.#positionsToSave, position];
    };

    #closePosition = async (openPosition: SignalSubscriptionPosition, signal?: Signal) => {
        let position: SignalSubscriptionPosition = {
            ...openPosition,
            exitPrice: signal?.price || this.#robot.currentPrice,
            exitDate: dayjs.utc().toISOString(),
            exitOrderType: signal ? "limit" : "market"
        };

        position = await closeZignalyPosition(this.#robot.url, this.#robot.token, position, !signal);

        this.#positionsToSave = [...this.#positionsToSave, position];
    };

    get positionsToSave() {
        return this.#positionsToSave;
    }

    get state() {
        return this.#robot.state;
    }
}
