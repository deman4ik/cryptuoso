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
}
