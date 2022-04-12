import { Timeframe, ValidTimeframe, TradeAction, OrderType, SignalType, Candle } from "@cryptuoso/market";
import { CANDLES_RECENT_AMOUNT, ISO_DATE_REGEX } from "@cryptuoso/helpers";
import { RobotSettings, RobotSettingsSchema, StrategySettings } from "@cryptuoso/robot-settings";

export const EXCHANGES = {
    binance_futures: "binance_futures",
    bitfinex: "bitfinex",
    huobipro: "huobipro",
    kraken: "kraken",
    kucoin: "kucoin"
};

export const ROBOT_RUNNER_TOPIC = "in-robot-runner";

export const enum RobotRunnerEvents {
    CREATE = "in-robot-runner.create",
    START = "in-robot-runner.start",
    STOP = "in-robot-runner.stop",
    STATUS = "in-robot-runner.status",
    ROBOTS_CHECK = "in-robot-runner.robots-check",
    MARKETS_CHECK = "in-robot-runner.markets-check"
}

export const enum RobotServiceEvents {
    SUBSCRIBE = "in-robot.subscribe"
}

export const getRobotStatusEventName = (exchange: string) => {
    if (!Object.values(EXCHANGES).includes(exchange)) throw new Error(`Exchange ${exchange} is not supported`);
    return `in-robot-runner-${exchange}.status`;
};

export const getRobotsCheckEventName = (exchange: string) => {
    if (!Object.values(EXCHANGES).includes(exchange)) throw new Error(`Exchange ${exchange} is not supported`);
    return `in-robot-runner-${exchange}.robots-check`;
};

export const getMarketsCheckEventName = (exchange: string) => {
    if (!Object.values(EXCHANGES).includes(exchange)) throw new Error(`Exchange ${exchange} is not supported`);
    return `in-robot-runner-${exchange}.markets-check`;
};

export const getRobotSubscribeEventName = (exchange: string) => {
    if (!Object.values(EXCHANGES).includes(exchange)) throw new Error(`Exchange ${exchange} is not supported`);
    return `in-robot-${exchange}.subscribe`;
};

export const ROBOT_WORKER_TOPIC = "out-robot-worker";

export const enum RobotWorkerEvents {
    LOG = "out-robot-worker.log",
    STARTED = "out-robot-worker.started",
    STARTING = "out-robot-worker.starting",
    STOPPED = "out-robot-worker.stopped",
    PAUSED = "out-robot-worker.paused",
    ERROR = "out-robot-worker.error"
}

export const ALERT_TOPIC = "signal-alert";
export const SIGNAL_TOPIC = "signal-trade";

export const enum SignalEvents {
    ALERT = "signal-alert.new",
    TRADE = "signal-trade.new"
}

const SignalsSchema = {
    id: "uuid",
    robotId: "uuid",
    exchange: "string",
    asset: "string",
    currency: "string",
    timeframe: { type: "enum", values: Timeframe.validArray },
    timestamp: {
        type: "string",
        pattern: ISO_DATE_REGEX,
        optional: true
    },
    action: {
        type: "enum",
        values: [TradeAction.long, TradeAction.short, TradeAction.closeLong, TradeAction.closeShort]
    },
    orderType: { type: "enum", values: [OrderType.stop, OrderType.limit, OrderType.market] },
    price: { type: "number" },
    candleTimestamp: {
        type: "string",
        pattern: ISO_DATE_REGEX,
        optional: true
    },
    positionId: "uuid",
    positionPrefix: "string",
    positionCode: "string",
    positionParentId: { type: "uuid", optional: true }
};

export const StatusSchema = {
    robotId: "uuid",
    status: "string"
};

export const RobotRunnerSchema = {
    [RobotRunnerEvents.CREATE]: {
        entities: {
            type: "array",
            items: {
                type: "object",
                props: {
                    exchange: {
                        type: "string"
                    },
                    asset: {
                        type: "string"
                    },
                    currency: {
                        type: "string"
                    },
                    timeframe: {
                        type: "enum",
                        values: Timeframe.validArray
                    },
                    strategy: {
                        type: "string"
                    },
                    mod: {
                        type: "string",
                        optional: true
                    },
                    available: { type: "number", integer: true, default: 5 },
                    signals: { type: "boolean", default: false },
                    trading: { type: "boolean", default: false },
                    strategySettings: {
                        type: "object",
                        props: {
                            requiredHistoryMaxBars: { type: "number", integer: true, default: CANDLES_RECENT_AMOUNT }
                        }
                    },
                    robotSettings: RobotSettingsSchema
                }
            }
        }
    },
    [RobotRunnerEvents.START]: {
        robotId: "uuid",
        dateFrom: {
            type: "string",
            pattern: ISO_DATE_REGEX,
            optional: true
        }
    },
    [RobotRunnerEvents.STOP]: {
        robotId: "uuid"
    },
    [RobotRunnerEvents.STATUS]: StatusSchema,
    [RobotRunnerEvents.ROBOTS_CHECK]: { exchange: "string" },
    [RobotRunnerEvents.MARKETS_CHECK]: { exchange: "string" }
};

export const RobotServiceSchema = {
    [RobotServiceEvents.SUBSCRIBE]: {
        asset: "string",
        currency: "string"
    }
};

export const RobotWorkerSchema = {
    [RobotWorkerEvents.LOG]: {
        robotId: "uuid"
    },
    [RobotWorkerEvents.STARTED]: StatusSchema,
    [RobotWorkerEvents.STARTING]: StatusSchema,
    [RobotWorkerEvents.STOPPED]: StatusSchema,
    [RobotWorkerEvents.ERROR]: { robotId: "uuid", error: "string" }
};

export const SignalSchema = {
    [SignalEvents.ALERT]: {
        ...SignalsSchema,
        type: { type: "equal", value: SignalType.alert, strict: true }
    },
    [SignalEvents.TRADE]: {
        ...SignalsSchema,
        type: { type: "equal", value: SignalType.trade, strict: true }
    }
};

export interface RobotRunnerCreateProps {
    exchange: string;
    asset: string;
    currency: string;
    timeframe: ValidTimeframe;
    strategy: string;
    mod?: string;
    available: number;
    signals: boolean;
    trading: boolean;
    strategySettings: StrategySettings;
    robotSettings: RobotSettings;
}

export interface RobotRunnerCreate {
    entities: RobotRunnerCreateProps[];
}

export interface RobotRunnerDelete {
    robotId: string;
}

export interface RobotRunnerStart {
    robotId: string;
    dateFrom?: string;
}

export interface RobotRunnerStop {
    robotId: string;
}

export interface RobotRunnerPause {
    robotId: string;
}

export interface RobotRunnerStatus {
    robotId: string;
    status: "start" | "restart" | "stop";
}

export interface RobotRunnerMarketsCheck {
    exchange: string;
}

export type RobotRunnerRobotsCheck = RobotRunnerMarketsCheck;

export interface RobotWorkerError {
    [key: string]: any;
    robotId: string;
    error: string;
}

export interface RobotWorkerLog {
    [key: string]: any;
    robotId: string;
    candle: Candle;
}

export interface RobotWorkerStatus {
    [key: string]: any;
    robotId: string;
    status: string;
}

export interface AddMarket {
    exchange: string;
    asset: string;
    currency: string;
    available?: number;
}

export interface RobotServiceSubcribe {
    asset: string;
    currency: string;
}
