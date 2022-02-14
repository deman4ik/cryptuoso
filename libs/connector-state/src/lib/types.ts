import { OrderJob } from "@cryptuoso/market";

export const enum Priority {
    high = 1,
    medium = 2,
    low = 3
}

export interface ConnectorJob extends OrderJob {
    id: string;
    userExAccId: string;
    orderId: string;
    nextJobAt: string;
    priority: Priority;
    allocation: "shared" | "dedicated";
}

export const enum Queues {
    connector = "connector",
    connectorRunner = "connector-runner"
}

export const enum ConnectorJobType {
    order = "order",
    balance = "balance",
    unknownOrders = "unknownOrders"
}

export const enum ConnectorRunnerJobType {
    idleOrderJobs = "idleOrderJobs",
    idleOpenOrders = "idleOpenOrders",
    checkBalance = "checkBalance",
    checkUnknownOrders = "checkUnknownOrders"
}
