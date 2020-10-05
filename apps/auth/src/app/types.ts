import { User, UserStatus } from "@cryptuoso/user-state";

export interface DBFunctions {
    getUserByEmail: { (params: { email: string }): Promise<User> };
    getUserById: { (params: { userId: string }): Promise<User> };
    getUserTg: { (params: { telegramId: number }): Promise<User> };
    getUserByToken: { (params: { refreshToken: string }): Promise<User> };
    registerUser: { (newUser: User): Promise<any> };
    registerUserTg: { (newUser: User): Promise<any> };
    updateUserRefreshToken: {
        (params: { userId: string; refreshToken: string; refreshTokenExpireAt: string }): Promise<any>;
    };
    updateUserSecretCode: {
        (params: { userId: string; secretCode: string; secretCodeExpireAt: string }): Promise<any>;
    };
    updateUserPassword: {
        (params: {
            userId: string;
            passwordHash: string;
            newSecretCode: string;
            newSecretCodeExpireAt: string;
            refreshToken: string;
            refreshTokenExpireAt: string;
        }): Promise<any>;
    };
    changeUserPassword: {
        (params: { userId: string; passwordHash: string }): Promise<any>;
    };
    changeUserEmail: {
        (params: { userId: string; emailNew: string; secretCode: string; secretCodeExpireAt: string }): Promise<any>;
    };
    confirmChangeUserEmail: {
        (params: {
            userId: string;
            email: string;
            emailNew: string;
            secretCode: string;
            secretCodeExpireAt: string;
            refreshToken: string;
            refreshTokenExpireAt: string;
            status: UserStatus;
        }): Promise<any>;
    };
    activateUser: {
        (params: { refreshToken: string; refreshTokenExpireAt: string; userId: string }): Promise<any>;
    };
}

export interface Bcrypt {
    compare: { (data: any, encrypted: string): Promise<boolean> };
    hash: { (data: any, saltOrRounds: string | number): Promise<string> };
}
