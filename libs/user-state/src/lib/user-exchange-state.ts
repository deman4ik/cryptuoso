import { GenericObject } from "@cryptuoso/helpers";
import { Balances } from "ccxt";

export interface EncryptedData {
    data: string;
    iv: string;
}

export const enum UserExchangeAccStatus {
    enabled = "enabled",
    disabled = "disabled",
    invalid = "invalid"
}

export interface UserExchangeKeys {
    key: EncryptedData;
    secret: EncryptedData;
    pass?: EncryptedData;
}

export interface UserExchangeAccBalances {
    info: Balances;
    totalUSD: number;
    updatedAt: string;
}

export interface UserExchangeAccount {
    id: string;
    userId: string;
    exchange: string;
    name: string;
    keys: UserExchangeKeys;
    status: UserExchangeAccStatus;
    allocation: "shared" | "dedicated";
    ordersCache: GenericObject<any>;
    balances?: UserExchangeAccBalances;
    error?: any;
}

export interface UserExchangeAccountInfo {
    id: string;
    exchange: string;
    name?: string;
    status: UserExchangeAccStatus;
    allocation?: "shared" | "dedicated";
    error?: string;
    balance?: number;
}
