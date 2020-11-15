import { ISO_DATE_REGEX } from "@cryptuoso/helpers";
import { OrderStatus } from "@cryptuoso/market";

export const enum ConnectorRunnerEvents {
    ADD_JOB = "in-connector-runner.add-job"
}

export const enum ConnectorWorkerEvents {
    USER_EX_ACC_ERROR = "out-connector-worker.user-ex-acc-error",
    ORDER_STATUS = "out-connector-worker.order-status",
    ORDER_ERROR = "out-connector-worker.order-error"
}

export const ConnectorRunnerSchema = {
    [ConnectorRunnerEvents.ADD_JOB]: {
        userExAccId: "uuid",
        orderId: "uuid",
        type: { type: "enum", values: ["create", "recreate", "cancel", "check"] },
        priority: { type: "number", integer: true },
        nextJobAt: { type: "string", pattern: ISO_DATE_REGEX },
        data: { type: "object", optional: true }
    }
};

const OrderSchema = {
    orderId: "uuid",
    userExAccId: "uuid",
    userRobotId: "uuid",
    status: { type: "enum", values: ["new", "open", "closed", "canceled"] }
};

export const ConnectorWorkerSchema = {
    [ConnectorWorkerEvents.USER_EX_ACC_ERROR]: {
        userExAccId: "uuid",
        error: "string"
    },
    [ConnectorWorkerEvents.ORDER_STATUS]: OrderSchema,
    [ConnectorWorkerEvents.ORDER_ERROR]: {
        ...OrderSchema,
        error: "string"
    }
};

export interface UserExchangeAccountErrorEvent {
    userExAccId: string;
    error: string;
}

export interface OrdersStatusEvent {
    orderId: string;
    userExAccId: string;
    userRobotId: string;
    userPositionId: string;
    positionId?: string;
    status: OrderStatus;
}

export interface OrdersErrorEvent extends OrdersStatusEvent {
    error: string;
}
