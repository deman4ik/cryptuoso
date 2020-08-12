import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { v4 as uuid } from "uuid";
import dayjs from "@cryptuoso/dayjs";
import { ActionsHandlerError } from "@cryptuoso/errors";

import { User, UserStatus, UserRoles, TimeUnit } from "@cryptuoso/user-state";
import { formatTgName, checkTgLogin, getAccessValue } from "./auth-helper";
import { DBFunctions } from "./types";

export class Auth {
    #db: DBFunctions;
    constructor(db: DBFunctions) {
        this.#db = db;
    }

    // eslint-disable-next-line
    private async _mail(action: string, params: any) {}

    async login(params: { email: string; password: string }) {
        const { email, password } = params;

        const user: User = await this.#db.getUserByEmail({ email });
        if (!user) throw new ActionsHandlerError("User account is not found.", null, "NOT_FOUND", 404);
        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);
        if (user.status === UserStatus.new)
            throw new ActionsHandlerError("User account is not activated.", null, "FORBIDDEN", 403);
        if (!user.passwordHash)
            throw new ActionsHandlerError(
                "Password is not set. Login with Telegram and change password.",
                null,
                "FORBIDDEN",
                403
            );
        const passwordChecked = await bcrypt.compare(password, user.passwordHash);
        if (!passwordChecked) throw new ActionsHandlerError("Invalid password.", null, "FORBIDDEN", 403);

        let refreshToken;
        let refreshTokenExpireAt;
        if (
            !user.refreshToken ||
            !user.refreshTokenExpireAt ||
            dayjs.utc(user.refreshTokenExpireAt).add(-1, TimeUnit.day).valueOf() < dayjs.utc().valueOf()
        ) {
            refreshToken = uuid();
            refreshTokenExpireAt = dayjs
                .utc()
                .add(+process.env.REFRESH_TOKEN_EXPIRES, TimeUnit.day)
                .toISOString();
        } else {
            refreshToken = user.refreshToken;
            refreshTokenExpireAt = user.refreshTokenExpireAt;
            await this.#db.updateUserRefreshToken({
                userId: user.id,
                refreshToken,
                refreshTokenExpireAt
            });
        }

        return {
            accessToken: this.generateAccessToken(user),
            refreshToken,
            refreshTokenExpireAt
        };
    }

    async loginTg(params: {
        id: number;
        first_name?: string;
        last_name?: string;
        username?: string;
        photo_url?: string;
        auth_date: number;
        hash: string;
    }) {
        const loginData = await checkTgLogin(params, process.env.BOT_TOKEN);
        if (!loginData) throw new ActionsHandlerError("Invalid login data.", null, "FORBIDDEN", 403);

        const { id: telegramId, first_name: firstName, last_name: lastName, username: telegramUsername } = loginData;
        const name = formatTgName(telegramUsername, firstName, lastName);

        const user: User = await this.registerTg({
            telegramId,
            telegramUsername,
            name
        });
        if (!user) throw new ActionsHandlerError("User account is not found.", null, "NOT_FOUND", 404);
        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);
        if (user.status === UserStatus.new)
            throw new ActionsHandlerError("User account is not activated.", null, "FORBIDDEN", 403);

        let refreshToken = null;
        let refreshTokenExpireAt = null;
        if (
            !user.refreshToken ||
            !user.refreshTokenExpireAt ||
            dayjs.utc(user.refreshTokenExpireAt).add(-1, TimeUnit.day).valueOf() < dayjs.utc().valueOf()
        ) {
            refreshToken = uuid();
            refreshTokenExpireAt = dayjs
                .utc()
                .add(+process.env.REFRESH_TOKEN_EXPIRES, TimeUnit.day)
                .toISOString();
            await this.#db.updateUserRefreshToken({
                refreshToken,
                refreshTokenExpireAt,
                userId: user.id
            });
        } else {
            refreshToken = user.refreshToken;
            refreshTokenExpireAt = user.refreshTokenExpireAt;
        }

        return {
            accessToken: this.generateAccessToken(user),
            refreshToken,
            refreshTokenExpireAt
        };
    }

    async register(params: { email: string; password: string; name: string }) {
        const { email, password, name } = params;

        const userExists: User = await this.#db.getUserByEmail({ email });
        if (userExists) throw new ActionsHandlerError("User account already exists.", null, "CONFLICT", 409);
        const newUser: User = {
            id: uuid(),
            name,
            email,
            status: UserStatus.new,
            passwordHash: await bcrypt.hash(password, 10),
            secretCode: this.generateCode(),
            roles: {
                allowedRoles: [UserRoles.user],
                defaultRole: UserRoles.user
            },
            settings: {
                notifications: {
                    signals: {
                        telegram: false,
                        email: true
                    },
                    trading: {
                        telegram: false,
                        email: true
                    }
                }
            }
        };
        await this.#db.registerUser(newUser);

        const urlData = this.encodeData({
            userId: newUser.id,
            secretCode: newUser.secretCode
        });
        await this._mail(`send`, {
            to: email,
            subject: "🚀 Welcome to Cryptuoso Platform - Please confirm your email.",
            variables: {
                params: `<p>Greetings!</p>
                <p>Your user account is successfully created!</p>
                <p>Activate your account by confirming your email please click <b><a href="https://cryptuoso.com/auth/activate-account/${urlData}">this link</a></b></p>
                <p>or enter this code <b>${newUser.secretCode}</b> manually on confirmation page.</p>`
            },
            tags: ["auth"]
        });
        return newUser.id;
    }

    async registerTg(params: { telegramId: number; telegramUsername: string; name: string }) {
        const { telegramId, telegramUsername, name } = params;

        const userExists: User = await this.#db.getUserTg({ telegramId });
        if (userExists) return userExists;
        const newUser: User = {
            id: uuid(),
            telegramId,
            telegramUsername,
            name,
            status: UserStatus.enabled,
            roles: {
                allowedRoles: [UserRoles.user],
                defaultRole: UserRoles.user
            },
            settings: {
                notifications: {
                    signals: {
                        telegram: true,
                        email: false
                    },
                    trading: {
                        telegram: true,
                        email: false
                    }
                }
            }
        };
        await this.#db.registerUserTg(newUser);

        return newUser;
    }

    async refreshToken(params: { refreshToken: string }) {
        const user: User = await this.#db.getUserByToken(params);
        if (!user)
            throw new ActionsHandlerError(
                "Refresh token expired or user account is not found.",
                null,
                "NOT_FOUND",
                404
            );
        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);
        if (user.status === UserStatus.new)
            throw new ActionsHandlerError("User account is not activated.", null, "FORBIDDEN", 403);

        return {
            accessToken: this.generateAccessToken(user),
            refreshToken: user.refreshToken,
            refreshTokenExpireAt: user.refreshTokenExpireAt
        };
    }

    async activateAccount(params: { userId: string; secretCode: string }) {
        const { userId, secretCode } = params;

        const user: User = await this.#db.getUserById({ userId });

        if (!user) throw new ActionsHandlerError("User account not found.", null, "NOT_FOUND", 404);
        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);
        if (user.status === UserStatus.enabled)
            throw new ActionsHandlerError("User account is already activated.", null, "FORBIDDEN", 403);
        if (!user.secretCode) throw new ActionsHandlerError("Confirmation code is not set.", null, "FORBIDDEN", 403);
        if (user.secretCode !== secretCode)
            throw new ActionsHandlerError("Wrong confirmation code.", null, "FORBIDDEN", 403);

        const refreshToken = uuid();
        const refreshTokenExpireAt = dayjs
            .utc()
            .add(+process.env.REFRESH_TOKEN_EXPIRES, TimeUnit.day)
            .toISOString();

        await this.#db.activateUser({
            refreshToken,
            refreshTokenExpireAt,
            userId
        });
        await this._mail(`subscribeToList`, {
            list: "cpz-beta@mg.cryptuoso.com",
            email: user.email
        });
        await this._mail(`send`, {
            to: user.email,
            subject: "🚀 Welcome to Cryptuoso Platform - User Account Activated.",
            variables: {
                params: `<p>Congratulations!</p>
                <p>Your user account is successfully activated!</p>
                <p>Now you can login to <b><a href="https://cryptuoso.com/auth/login">your account</a></b> using your email and password.</p>
                <p>Please check out our <b><a href="https://support.cryptuoso.com">Documentation Site</a></b> to get started!</p>`
            },
            tags: ["auth"]
        });
        return {
            accessToken: this.generateAccessToken(user),
            refreshToken,
            refreshTokenExpireAt
        };
    }

    async passwordReset(params: { email: string }) {
        const { email } = params;
        const user: User = await this.#db.getUserByEmail({ email });

        if (!user) throw new ActionsHandlerError("User account not found.", null, "NOT_FOUND", 404);
        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);

        let secretCode;
        let secretCodeExpireAt;
        if (user.status === UserStatus.new) {
            secretCode = user.secretCode;
            secretCodeExpireAt = user.secretCodeExpireAt;
        } else {
            secretCode = this.generateCode();
            secretCodeExpireAt = dayjs.utc().add(1, TimeUnit.hour).toISOString();

            this.#db.updateUserSecretCode({
                secretCode,
                secretCodeExpireAt,
                userId: user.id
            });
        }

        const urlData = this.encodeData({
            userId: user.id,
            secretCode
        });
        await this._mail(`send`, {
            to: user.email,
            subject: "🔐 Cryptuoso - Password Reset Request.",
            variables: {
                params: `
                <p>We received a request to reset your password. Please create a new password by clicking <a href="https://cryptuoso.com/auth/confirm-password-reset/${urlData}">this link</a></p>
                <p>or enter this code <b>${secretCode}</b> manually on reset password confirmation page.</p>
                <p>This request will expire in 1 hour.</p>
                <p>If you did not request this change, no changes have been made to your user account.</p>`
            },
            tags: ["auth"]
        });
        return user.id;
    }

    async confirmPasswordReset(params: { userId: string; secretCode: string; password: string }) {
        const { userId, secretCode, password } = params;

        const user: User = await this.#db.getUserById({ userId });

        if (!user) throw new ActionsHandlerError("User account not found.", null, "NOT_FOUND", 404);
        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);
        if (!user.secretCode) throw new ActionsHandlerError("Confirmation code is not set.", null, "FORBIDDEN", 403);
        if (user.secretCode !== secretCode)
            throw new ActionsHandlerError("Wrong confirmation code.", null, "FORBIDDEN", 403);

        const refreshToken = uuid();
        const refreshTokenExpireAt = dayjs
            .utc()
            .add(+process.env.REFRESH_TOKEN_EXPIRES, TimeUnit.day)
            .toISOString();

        let newSecretCode = null;
        let newSecretCodeExpireAt = null;
        if (user.status === UserStatus.new) {
            newSecretCode = user.secretCode;
            newSecretCodeExpireAt = user.secretCodeExpireAt;
        }
        await this.#db.updateUserPassword({
            userId,
            passwordHash: await bcrypt.hash(password, 10),
            newSecretCode,
            newSecretCodeExpireAt,
            refreshToken,
            refreshTokenExpireAt
        });

        await this._mail(`send`, {
            to: user.email,
            subject: "🔐 Cryptuoso - Reset Password Confirmation.",
            variables: {
                params: `
                <p>Your password successfully changed!</p>
                <p>If you did not request this change, please contact support <a href="mailto:support@cryptuoso.com">support@cryptuoso.com</a></p>`
            },
            tags: ["auth"]
        });

        return {
            accessToken: this.generateAccessToken(user),
            refreshToken,
            refreshTokenExpireAt
        };
    }

    async changeEmail(params: { userId: string; email: string }) {
        const { userId, email } = params;
        const userExists: User = await this.#db.getUserByEmail({ email });
        if (userExists) throw new ActionsHandlerError("User already exists.", null, "CONFLICT", 409);

        const user: User = await this.#db.getUserById({ userId });
        if (!user) throw new ActionsHandlerError("User account not found.", null, "NOT_FOUND", 404);
        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);

        let secretCode;
        let secretCodeExpireAt;
        if (
            user.secretCode &&
            user.secretCodeExpireAt &&
            dayjs.utc().valueOf() < dayjs.utc(user.secretCodeExpireAt).valueOf()
        ) {
            secretCode = user.secretCode;
            secretCodeExpireAt = user.secretCodeExpireAt;
        } else {
            secretCode = this.generateCode();
            secretCodeExpireAt = dayjs.utc().add(1, TimeUnit.hour).toISOString();
        }
        await this.#db.changeUserEmail({
            userId,
            emailNew: email,
            secretCode,
            secretCodeExpireAt
        });

        await this._mail(`send`, {
            to: email,
            subject: "🔐 Cryptuoso - Change Email Request.",
            variables: {
                body: `<p>We received a request to change your email.</p>
                <p>Please enter this code <b>${secretCode}</b> to confirm.</p>
                <p>This request will expire in 1 hour.</p>
                <p>If you did not request this change, no changes have been made to your user account.</p>`
            },
            tags: ["auth"]
        });

        return { success: true };
    }

    async confirmChangeEmail(params: { userId: string; secretCode: string }) {
        const { userId, secretCode } = params;
        const user: User = await this.#db.getUserById({ userId });

        if (!user) throw new ActionsHandlerError("User account not found.", null, "NOT_FOUND", 404);
        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);
        if (!user.emailNew) throw new ActionsHandlerError("New email is not set.", null, "FORBIDDEN", 403);
        if (!user.secretCode) throw new ActionsHandlerError("Confirmation code is not set.", null, "FORBIDDEN", 403);
        if (user.secretCode !== secretCode)
            throw new ActionsHandlerError("Wrong confirmation code.", null, "FORBIDDEN", 403);

        const refreshToken = uuid();
        const refreshTokenExpireAt = dayjs
            .utc()
            .add(+process.env.REFRESH_TOKEN_EXPIRES, TimeUnit.day)
            .toISOString();

        await this.#db.confirmChangeUserEmail({
            userId,
            email: user.emailNew,
            emailNew: null,
            secretCode: null,
            secretCodeExpireAt: null,
            refreshToken,
            refreshTokenExpireAt,
            status: UserStatus.enabled
        });

        await this._mail(`send`, {
            to: user.email || user.emailNew,
            subject: "🔐 Cryptuoso - Email Change Confirmation.",
            variables: {
                body: `
                <p>Your email successfully changed to ${user.emailNew}!</p>
                <p>If you did not request this change, please contact support <a href="mailto:support@cryptuoso.com">support@cryptuoso.com</a></p>`
            },
            tags: ["auth"]
        });

        return {
            accessToken: this.generateAccessToken(user),
            refreshToken,
            refreshTokenExpireAt
        };
    }

    generateAccessToken(user: User) {
        const {
            id,
            roles: { defaultRole, allowedRoles }
        } = user;
        const access = getAccessValue(user);
        return jwt.sign(
            {
                userId: id,
                role: defaultRole,
                allowedRoles: allowedRoles,
                access,
                "https://hasura.io/jwt/claims": {
                    "x-hasura-default-role": defaultRole,
                    "x-hasura-allowed-roles": allowedRoles,
                    "x-hasura-user-id": id,
                    "x-hasura-access": `${access}`
                }
            },
            process.env.JWT_SECRET,
            {
                algorithm: "HS256",
                expiresIn: `${process.env.JWT_TOKEN_EXPIRES}m`
            }
        );
    }

    generateCode(): string {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    encodeData(data: any): string {
        return Buffer.from(JSON.stringify(data)).toString("base64");
    }
}
