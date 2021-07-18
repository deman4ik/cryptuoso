import { BaseUser } from "@cryptuoso/user-state";

export interface ChatUser extends BaseUser {
    accessToken?: string;
    name?: string;
    email?: string;
    emailNew?: string;
    telegramId?: number;
    telegramUsername?: string;
    secretCode?: string;
    secretCodeExpireAt?: string;
}
