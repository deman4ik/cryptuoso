import { UserRobot } from "../lib/userRobot";
import { v4 as uuid } from "uuid";
import dayjs from "@cryptuoso/dayjs";
import { OrderJobType, OrderStatus, OrderType, SignalEvent, SignalType, TradeAction } from "@cryptuoso/market";
import { UserPositionJob, UserPositionOrderStatus, UserPositionStatus, UserRobotStatus } from "../lib/types";

const robotId = uuid();
const robotParams = {
    exchange: "kraken",
    asset: "BTC",
    currency: "USD",
    timeframe: 5,
    settings: {
        volume: 1
    },
    tradeSettings: {
        slippage: {
            entry: {
                stepPercent: 10,
                count: 3
            },
            exit: {
                stepPercent: 10,
                count: 3
            }
        },
        deviation: {
            entry: 2,
            exit: 2
        },
        orderTimeout: 120,
        multiPosition: false
    }
};
let userRobot: any;
describe("Test User Robot", () => {
    beforeEach(() => {
        userRobot = new UserRobot({
            id: uuid(),
            userExAccId: uuid(),
            userId: uuid(),
            robotId,
            internalState: {},
            status: UserRobotStatus.started,
            startedAt: dayjs.utc("2019-10-25T00:00:00.000Z").toISOString(),
            positions: [],
            ...robotParams
        });
    });

    it("Should create new Long Position", () => {
        const signal: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.long,
            orderType: OrderType.stop,
            price: 6500
        };

        userRobot.handleSignal(signal);
        expect(userRobot.positions.length).toBe(1);
        expect(userRobot.positions[0].direction).toBe("long");
        expect(userRobot.ordersToCreate[0].signalPrice).toBe(signal.price);
        expect(userRobot.ordersToCreate[0].price).toBe(7152);
    });

    it("Should create new Short Position", () => {
        const signal: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signal);
        expect(userRobot.positions.length).toBe(1);
        expect(userRobot.positions[0].direction).toBe("short");
        expect(userRobot.ordersToCreate[0].signalPrice).toBe(signal.price);
        expect(userRobot.ordersToCreate[0].price).toBe(5848);
    });

    it("Should set order price without modifications", () => {
        const signal: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            }
        });
        userRobot.handleSignal(signal);
        expect(userRobot.positions.length).toBe(1);
        expect(userRobot.positions[0].direction).toBe("short");
        expect(userRobot.ordersToCreate[0].signalPrice).toBe(signal.price);
        expect(userRobot.ordersToCreate[0].price).toBe(signal.price);
    });

    it("Should create order job to cancel position", () => {
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);

        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.open,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString()
        };
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);
        const signalClose: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: signalOpen.positionId,
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.closeShort,
            orderType: OrderType.market,
            price: 6500
        };
        userRobot.handleSignal(signalClose);

        expect(userRobot.connectorJobs.length).toBe(1);
        expect(userRobot.connectorJobs[0].type).toBe(OrderJobType.cancel);
    });

    it("Should create order to close position", () => {
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: userRobot.ordersToCreate[0].volume,
            remaining: 0
        };
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);
        const signalClose: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: signalOpen.positionId,
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.closeShort,
            orderType: OrderType.market,
            price: 5998
        };
        userRobot.handleSignal(signalClose);
        expect(userRobot.ordersToCreate.length).toBe(1);
        expect(userRobot.ordersToCreate[0].signalPrice).toBe(signalClose.price);
        expect(userRobot.ordersToCreate[0].price).toBe(6599.8);
    });

    it("Should create order to close previous position", () => {
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: userRobot.ordersToCreate[0].volume,
            remaining: 0
        };
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);
        const signalClose: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_2",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.closeShort,
            orderType: OrderType.market,
            price: 5998
        };
        userRobot.handleSignal(signalClose);
        expect(userRobot.ordersToCreate.length).toBe(1);
        expect(userRobot.ordersToCreate[0].positionId).toBe(openOrder.positionId);
        expect(userRobot.ordersToCreate[0].signalPrice).toBe(signalClose.price);
        expect(userRobot.ordersToCreate[0].price).toBe(6599.8);
    });

    it("Should not create new position after new open signal with same direction", () => {
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: userRobot.ordersToCreate[0].volume,
            remaining: 0
        };
        const firstUserPositionId = userRobot.positions[0].id;
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);
        const signalOpenNew: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_2",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };
        userRobot.handleSignal(signalOpenNew);
        expect(userRobot.positions[0].id).toBe(firstUserPositionId);
        expect(userRobot.positions[0].status).toBe(UserPositionStatus.open);
        expect(userRobot.positions[0].nextJob).toBeNull();
        expect(userRobot.positions.length).toBe(1);
    });

    it("Should force close position after new open signal with different direction", () => {
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: userRobot.ordersToCreate[0].volume,
            remaining: 0
        };
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);
        const signalOpenNew: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_2",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.long,
            orderType: OrderType.market,
            price: 6500
        };
        userRobot.handleSignal(signalOpenNew);
        expect(userRobot.positions[0].nextJob).toBe(UserPositionJob.cancel);
        expect(userRobot.ordersToCreate.length).toBe(1);
        expect(userRobot.ordersToCreate[0].type).toBe(OrderType.forceMarket);
    });

    it("Should close position", () => {
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: userRobot.ordersToCreate[0].volume,
            remaining: 0
        };
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);
        const signalClose: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: signalOpen.positionId,
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.closeShort,
            orderType: OrderType.market,
            price: 5998
        };
        userRobot.handleSignal(signalClose);
        const closeOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: null,
            executed: userRobot.ordersToCreate[0].volume,
            remaining: 0
        };
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder],
                    exitOrders: [closeOrder]
                }
            ]
        });
        userRobot.handleOrder(closeOrder);
        expect(userRobot.positions[0].exitDate).toBe(closeOrder.exTimestamp);
        expect(userRobot.positions[0].status).toBe(UserPositionStatus.closed);
    });

    it("Should handle entry partial order", () => {
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            }
        });
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: 0.2,
            remaining: 0.8
        };
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            },
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);
        expect(userRobot.positions[0].status).toBe(UserPositionStatus.open);
        expect(userRobot.positions[0].entryStatus).toBe(UserPositionOrderStatus.closed);
        expect(userRobot.positions[0].entryExecuted).toBe(0.2);
        expect(userRobot.connectorJobs.length).toBe(0);
    });

    it("Should handle exit partial order", () => {
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            }
        });
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: userRobot.ordersToCreate[0].volume,
            remaining: 0
        };
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            },
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);
        const signalClose: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: signalOpen.positionId,
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.closeShort,
            orderType: OrderType.market,
            price: 5998
        };
        userRobot.handleSignal(signalClose);
        const closeOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: 0.5,
            remaining: 0.5
        };
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            },
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder],
                    exitOrders: [closeOrder]
                }
            ]
        });
        userRobot.handleOrder(closeOrder);
        expect(userRobot.positions[0].exitStatus).toBe(UserPositionOrderStatus.partial);
        expect(userRobot.positions[0].status).toBe(UserPositionStatus.open);
        expect(userRobot.ordersToCreate[0].type).toBe(OrderType.forceMarket);
        expect(userRobot.ordersToCreate[0].volume).toBe(0.5);
    });

    it("Should handle exit partial order with slippage", () => {
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: userRobot.ordersToCreate[0].volume,
            remaining: 0
        };
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);
        const signalClose: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: signalOpen.positionId,
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.closeShort,
            orderType: OrderType.market,
            price: 5998
        };
        userRobot.handleSignal(signalClose);
        const closeOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: 0.5,
            remaining: 0.5
        };
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder],
                    exitOrders: [closeOrder]
                }
            ]
        });
        userRobot.handleOrder(closeOrder);
        expect(userRobot.positions[0].exitStatus).toBe(UserPositionOrderStatus.partial);
        expect(userRobot.positions[0].status).toBe(UserPositionStatus.open);
        expect(userRobot.ordersToCreate[0].type).toBe(OrderType.market);
        expect(userRobot.ordersToCreate[0].volume).toBe(0.5);
    });

    it("Should handle entry canceled order and cancel position", () => {
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            }
        });
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.canceled,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString()
        };
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            },
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);
        expect(userRobot.positions[0].status).toBe(UserPositionStatus.canceled);
        expect(userRobot.connectorJobs.length).toBe(0);
    });

    it("Should handle entry canceled order and recreate order", () => {
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.canceled,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString()
        };
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);
        expect(userRobot.positions[0].internalState.entrySlippageCount).toBe(2);
        expect(userRobot.positions[0].status).toBe(UserPositionStatus.new);
        expect(userRobot.connectorJobs.length).toBe(1);
        expect(userRobot.connectorJobs[0].type).toBe(OrderJobType.recreate);
        expect(userRobot.connectorJobs[0].data.price).toBe(5198);
    });

    it("Should cancel position after all slippage steps", () => {
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.canceled,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString()
        };
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    internalState: {
                        entrySlippageCount: 5,
                        exitSlippageCount: 0
                    },
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);

        expect(userRobot.positions[0].status).toBe(UserPositionStatus.canceled);
    });

    it("Should handle exit canceled order", () => {
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            }
        });
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: userRobot.ordersToCreate[0].volume,
            remaining: 0
        };
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            },
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);
        const signalClose: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: signalOpen.positionId,
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.closeShort,
            orderType: OrderType.market,
            price: 5998
        };
        userRobot.handleSignal(signalClose);
        const closeOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.canceled,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: 0,
            remaining: openOrder.volume
        };
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            },
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder],
                    exitOrders: [closeOrder]
                }
            ]
        });
        userRobot.handleOrder(closeOrder);
        expect(userRobot.ordersToCreate.length).toBe(1);
        expect(userRobot.ordersToCreate[0].type).toBe(OrderType.forceMarket);
    });

    it("Should cancel position with canceled order in history", () => {
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            }
        });
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.open,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: null,
            executed: 0,
            remaining: 0,
            nextJob: {
                type: OrderJobType.check
            }
        };
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            },
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });

        const signalOpen2: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:10:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_2",
            candleTimestamp: dayjs.utc("2019-10-26T00:10:00.000Z").toISOString(),
            action: TradeAction.long,
            orderType: OrderType.market,
            price: 6000
        };
        userRobot.handleSignal(signalOpen2);

        expect(userRobot.connectorJobs[0].type).toBe(OrderJobType.cancel);
        const openOrderCanceled = {
            ...openOrder,
            status: OrderStatus.canceled,
            nextJob: null
        };
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            },
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrderCanceled]
                },
                {
                    ...userRobot.positions[1]
                }
            ]
        });

        userRobot.handleOrder(openOrderCanceled);

        expect(userRobot.positions[0].status).toBe(UserPositionStatus.canceled);
    });

    it("Should close position with exit canceled order in history", () => {
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            }
        });
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: userRobot.ordersToCreate[0].volume,
            remaining: 0
        };
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            },
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);
        const signalClose: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: signalOpen.positionId,
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.closeShort,
            orderType: OrderType.market,
            price: 5998
        };
        userRobot.handleSignal(signalClose);
        const canceledCloseOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.canceled,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: 0,
            remaining: openOrder.volume
        };
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            },
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder],
                    exitOrders: [canceledCloseOrder]
                }
            ]
        });
        userRobot.handleOrder(canceledCloseOrder);

        const closeOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: openOrder.volume,
            remaining: 0
        };
        userRobot = new UserRobot({
            ...userRobot.state,

            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            tradeSettings: {
                orderTimeout: 120
            },
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder],
                    exitOrders: [canceledCloseOrder, closeOrder]
                }
            ]
        });
        userRobot.handleOrder(closeOrder);
        expect(userRobot.positions[0].status).toBe(UserPositionStatus.closed);
    });

    it("Should create new position and close parent if open signal first", () => {
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: userRobot.ordersToCreate[0].volume,
            remaining: 0
        };
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);
        const signalOpenNew: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T01:10:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_2",
            positionParentId: signalOpen.positionId,
            candleTimestamp: dayjs.utc("2019-10-26T01:10:00.000Z").toISOString(),
            action: TradeAction.long,
            orderType: OrderType.market,
            price: 7000
        };
        userRobot.handleSignal(signalOpenNew);
        expect(userRobot.positions.length).toBe(2);
        expect(userRobot.positions[0].exitAction).toBe(TradeAction.closeShort);
        expect(userRobot.positions[1].status).toBe(UserPositionStatus.new);
        expect(userRobot.connectorJobs.length).toBe(2);
        expect(userRobot.connectorJobs[0].type).toBe(OrderJobType.create);
        expect(userRobot.ordersToCreate[0].price).toBe(7702);
        expect(userRobot.connectorJobs[1].type).toBe(OrderJobType.create);
        expect(userRobot.ordersToCreate[1].price).toBe(7702);
    });

    it("Should create new position after close signal", () => {
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: userRobot.ordersToCreate[0].volume,
            remaining: 0
        };
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);
        const signalClose: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: signalOpen.positionId,
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.closeShort,
            orderType: OrderType.market,
            price: 5998
        };
        userRobot.handleSignal(signalClose);
        const signalOpenNew: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T01:10:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_2",
            positionParentId: signalOpen.positionId,
            candleTimestamp: dayjs.utc("2019-10-26T01:10:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 7000
        };
        userRobot.handleSignal(signalOpenNew);
        expect(userRobot.positions[0].status).toBe(UserPositionStatus.open);
        expect(userRobot.positions.length).toBe(2);
        expect(userRobot.positions[1].status).toBe(UserPositionStatus.new);
    });

    it("Should cancel previous parent positions", () => {
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: userRobot.ordersToCreate[0].volume,
            remaining: 0
        };
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);
        const signalOpen2: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T01:10:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_2",
            positionParentId: signalOpen.positionId,
            candleTimestamp: dayjs.utc("2019-10-26T01:10:00.000Z").toISOString(),
            action: TradeAction.long,
            orderType: OrderType.market,
            price: 7000
        };
        userRobot.handleSignal(signalOpen2);
        const signalOpenNew3: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T01:10:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_3",
            positionParentId: signalOpen2.positionId,
            candleTimestamp: dayjs.utc("2019-10-26T01:10:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 7000
        };
        userRobot.handleSignal(signalOpenNew3);
        expect(userRobot.positions.length).toBe(3);
        expect(userRobot.positions[0].nextJob).toBe(UserPositionJob.close);
        expect(userRobot.positions[1].nextJob).toBe(UserPositionJob.cancel);
        expect(userRobot.positions[2].status).toBe(UserPositionStatus.new);
    });

    it("Should process delayed position", () => {
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:00:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:00:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: userRobot.ordersToCreate[0].volume,
            remaining: 0
        };
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);
        const signalOpenNew: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_2",
            positionParentId: signalOpen.positionId,
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.long,
            orderType: OrderType.market,
            price: 7000
        };
        userRobot.handleSignal(signalOpenNew);
        const signalClose: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T01:10:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: signalOpen.positionId,
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T01:10:00.000Z").toISOString(),
            action: TradeAction.closeLong,
            orderType: OrderType.market,
            price: 5998
        };
        userRobot.handleSignal(signalClose);

        const closeOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: userRobot.ordersToCreate[0].volume,
            remaining: 0
        };
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder],
                    exitOrders: [closeOrder]
                },
                {
                    ...userRobot.positions[1]
                }
            ]
        });
        userRobot.handleOrder(closeOrder);
        expect(userRobot.positions.length).toBe(2);
        expect(userRobot.positions[1].status).toBe(UserPositionStatus.new);
    });

    it("Should force close position after Robot stop", () => {
        const signalOpen: SignalEvent = {
            id: uuid(),
            robotId,
            exchange: "kraken",
            asset: "BTC",
            currency: "USD",
            timeframe: 5,
            timestamp: dayjs.utc("2019-10-26T00:05:01.000Z").toISOString(),
            type: SignalType.trade,
            positionId: uuid(),
            positionPrefix: "p",
            positionCode: "p_1",
            candleTimestamp: dayjs.utc("2019-10-26T00:05:00.000Z").toISOString(),
            action: TradeAction.short,
            orderType: OrderType.market,
            price: 6500
        };

        userRobot.handleSignal(signalOpen);
        const openOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: userRobot.ordersToCreate[0].volume,
            remaining: 0
        };
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder]
                }
            ]
        });
        userRobot.handleOrder(openOrder);

        userRobot.stop();
        expect(userRobot.hasActivePositions).toBe(true);
        expect(userRobot.state.status).toBe(UserRobotStatus.stopping);
        expect(userRobot.ordersToCreate.length).toBe(1);
        expect(userRobot.ordersToCreate[0].type).toBe(OrderType.forceMarket);
        expect(userRobot.ordersToCreate[0].action).toBe(TradeAction.closeShort);
        const closeOrder = {
            ...userRobot.ordersToCreate[0],
            status: OrderStatus.closed,
            exId: uuid(),
            exTimestamp: dayjs.utc().toISOString(),
            exLastTradeAt: dayjs.utc().toISOString(),
            executed: userRobot.ordersToCreate[0].volume,
            remaining: 0
        };
        userRobot = new UserRobot({
            ...userRobot.state,
            ...robotParams,
            positions: [
                {
                    ...userRobot.positions[0],
                    entryOrders: [openOrder],
                    exitOrders: [closeOrder]
                }
            ]
        });
        userRobot.handleOrder(closeOrder);
        expect(userRobot.positions[0].status).toBe(UserPositionStatus.closedAuto);
        expect(userRobot.hasClosedPositions).toBe(true);
        expect(userRobot.hasActivePositions).toBe(false);
        if (userRobot.status === UserRobotStatus.stopping && !userRobot.hasActivePositions) userRobot.setStop();
        expect(userRobot.state.status).toBe(UserRobotStatus.stopped);
    });
});
