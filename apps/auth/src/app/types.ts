import { UserState } from "@cryptuoso/user-state";

export interface DBFunctions {
    getUserByEmail: { (params: { email: string }): Promise<UserState.User> };
    getUserById: { (params: { userId: string }): Promise<UserState.User> };
    getUserTg: { (params: { telegramId: number }): Promise<UserState.User> };
    getUserByToken: { (params: { refreshToken: string }): Promise<UserState.User> };
    registerUser: { (newUser: UserState.User): Promise<any> };
    registerUserTg: { (newUser: UserState.User): Promise<any> };
    updateUserRefreshToken: {
        (params: {
            userId: string,
            refreshToken: string,
            refreshTokenExpireAt: string
        }): Promise<any>
    };
    updateUserSecretCode: {
        (params: {
            userId: string
            secretCode: string,
            secretCodeExpireAt: string
        }): Promise<any>
    };
    updateUserPassword: {
        (params: {
            userId: string,
            passwordHash: string,
            newSecretCode: string,
            newSecretCodeExpireAt: string,
            refreshToken: string,
            refreshTokenExpireAt: string
        }): Promise<any>
    };
    changeUserEmail: {
        (params: {
            userId: string,
            emailNew: string,
            secretCode: string,
            secretCodeExpireAt: string
        }): Promise<any>
    };
    confirmChangeUserEmail: {
        (params: {
            userId: string,
            email: string,
            emailNew: string,
            secretCode: string,
            secretCodeExpireAt: string,
            refreshToken: string,
            refreshTokenExpireAt: string,
            status: UserState.UserStatus
        }): Promise<any>
    };
    activateUser: {
        (params: {
            refreshToken: string,
            refreshTokenExpireAt: string,
            userId: string
        }): Promise<any>
    };
}