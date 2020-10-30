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
    balances: Balances;
    updatedAt: string;
}

export interface UserExchangeAccount {
    id: string;
    userId: string;
    exchange: string;
    name: string;
    keys: UserExchangeKeys;
    status: UserExchangeAccStatus;
    ordersCache: GenericObject<any>;
    balances: UserExchangeAccBalances;
    error?: any;
}
