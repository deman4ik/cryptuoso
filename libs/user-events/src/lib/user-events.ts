export const OUT_USER_EX_ACC_TOPIC = "out-user-ex-acc";

export const enum UserExAccOutEvents {
    KEYS_CHANGED = "out-user-ex-acc.keys-changed"
}

export const UserExAccOutSchema = {
    [UserExAccOutEvents.KEYS_CHANGED]: {
        userExAccId: "uuid"
    }
};

export interface UserExAccKeysChangedEvent {
    userExAccId: string;
}
