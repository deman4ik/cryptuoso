import { GenericObject } from "@cryptuoso/helpers";

export interface EncryptedData {
    data: string;
    iv: string;
}

export interface UserExchangeAccountErrorEvent {
    id: string;
    userId: string;
    name: string;
    exchange: string;
    error: string;
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

export interface UserExchangeAccountState {
    id: string;
    userId: string;
    exchange: string;
    name: string;
    keys: UserExchangeKeys;
    status: UserExchangeAccStatus;
    ordersCache: GenericObject<any>;
    error?: any;
}
