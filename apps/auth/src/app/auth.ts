import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { v4 as uuid } from "uuid";
import dayjs from "@cryptuoso/dayjs";

import { cpz } from "../../../../@types";
import { formatTgName, checkTgLogin, getAccessValue } from "@cryptuoso/helpers";

import { DBFunctions } from "./service";

export class Auth {
    constructor() {

    }

    private async _mail(action: string, params: any) {

    }

    async login(params: any, db: DBFunctions) {
        const { password } = params;

        const user: cpz.User = await db.getUserByEmail(params);
        if (!user) throw new Error("User account is not found.");
        if (user.status === cpz.UserStatus.blocked)
            throw new Error("User account is blocked.");
        if (user.status === cpz.UserStatus.new)
            throw new Error("User account is not activated.");
        if (!user.passwordHash)
            throw new Error(
                "Password is not set. Login with Telegram and change password."
            );
        const passwordChecked = await bcrypt.compare(password, user.passwordHash);
        if (!passwordChecked) throw new Error("Invalid password.");

        let refreshToken;
        let refreshTokenExpireAt;
        if (
            !user.refreshToken ||
            !user.refreshTokenExpireAt ||
            dayjs
                .utc(user.refreshTokenExpireAt)
                .add(-1, cpz.TimeUnit.day)
                .valueOf() < dayjs.utc().valueOf()
        ) {
            refreshToken = uuid();
            refreshTokenExpireAt = dayjs
                .utc()
                .add(+process.env.REFRESH_TOKEN_EXPIRES, cpz.TimeUnit.day)
                .toISOString();
        } else {
            refreshToken = user.refreshToken;
            refreshTokenExpireAt = user.refreshTokenExpireAt;
            await db.updateUserRefreshToken({
                refreshToken,
                refreshTokenExpireAt,
                userId: user.id
            });
        }

        return {
            accessToken: this.generateAccessToken(user),
            refreshToken,
            refreshTokenExpireAt
        };
    }

    async loginTg(params: any, db: DBFunctions) {
        const loginData = await checkTgLogin(params, process.env.BOT_TOKEN);
        if (!loginData) throw new Error("Invalid login data.");

        const {
            id: telegramId,
            first_name: firstName,
            last_name: lastName,
            username: telegramUsername
        } = loginData;
        const name = formatTgName(telegramUsername, firstName, lastName);

        const user: cpz.User = await this.registerTg(
            {
                telegramId,
                telegramUsername,
                name
            },
            db
        );
        if (!user) throw new Error("User account is not found.");
        if (user.status === cpz.UserStatus.blocked)
            throw new Error("User account is blocked.");
        if (user.status === cpz.UserStatus.new)
            throw new Error("User account is not activated.");

        let refreshToken;
        let refreshTokenExpireAt;
        if (
            !user.refreshToken ||
            !user.refreshTokenExpireAt ||
            dayjs
                .utc(user.refreshTokenExpireAt)
                .add(-1, cpz.TimeUnit.day)
                .valueOf() < dayjs.utc().valueOf()
        ) {
            refreshToken = uuid();
            refreshTokenExpireAt = dayjs
                .utc()
                .add(+process.env.REFRESH_TOKEN_EXPIRES, cpz.TimeUnit.day)
                .toISOString();
            await db.updateUserRefreshToken({
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

    async logout(params: any) {

    }

    async register(params: any, db: DBFunctions) {
        const { email, password, name } = params;

        const userExists: cpz.User = await db.getUserByEmail(params);
        if (userExists) throw new Error("User account already exists");
        const newUser: cpz.User = {
            id: uuid(),
            name,
            email,
            status: cpz.UserStatus.new,
            passwordHash: await bcrypt.hash(password, 10),
            secretCode: this.generateCode(),
            roles: {
                allowedRoles: [cpz.UserRoles.user],
                defaultRole: cpz.UserRoles.user
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
        await db.registerUser(newUser);

        const urlData = this.encodeData({
            userId: newUser.id,
            secretCode: newUser.secretCode
        });
        await this._mail(`${cpz.Service.MAIL}.send`, {
            to: email,
            subject:
                "🚀 Welcome to Cryptuoso Platform - Please confirm your email.",
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

    async refreshToken(params: any, db: DBFunctions) {
        /* const { refreshToken } = params; */
        const user: cpz.User = await db.getUserByToken(params);
        if (!user)
            throw new Error("Refresh token expired or user account is not found.");
        if (user.status === cpz.UserStatus.new)
            throw new Error("User account is not activated.");
        if (user.status === cpz.UserStatus.blocked)
            throw new Error("User account is blocked.");

        return {
            accessToken: this.generateAccessToken(user),
            refreshToken: user.refreshToken,
            refreshTokenExpireAt: user.refreshTokenExpireAt
        };
    }

    async activateAccount(params: any, db: DBFunctions) {
        const { userId, secretCode } = params;

        const user: cpz.User = await db.getUserById(params);

        if (!user) throw new Error("User account not found.");
        if (user.status === cpz.UserStatus.blocked)
            throw new Error("User account is blocked.");
        if (user.status === cpz.UserStatus.enabled)
            throw new Error("User account is already activated.");
        if (!user.secretCode) throw new Error("Confirmation code is not set.");
        if (user.secretCode !== secretCode)
            throw new Error("Wrong confirmation code.");

        const refreshToken = uuid();
        const refreshTokenExpireAt = dayjs
            .utc()
            .add(+process.env.REFRESH_TOKEN_EXPIRES, cpz.TimeUnit.day)
            .toISOString();

        await db.activateUser({
            refreshToken,
            refreshTokenExpireAt,
            userId
        });
        await this._mail(
            `${cpz.Service.MAIL}.subscribeToList`,
            {
                list: "cpz-beta@mg.cryptuoso.com",
                email: user.email
            }
        );
        await this._mail(`${cpz.Service.MAIL}.send`, {
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

    async passwordReset(params: any, db: DBFunctions) {
        const user: cpz.User = await db.getUserByEmail(params);

        if (!user) throw new Error("User account not found.");
        if (user.status === cpz.UserStatus.blocked)
            throw new Error("User account is blocked.");

        let secretCode;
        let secretCodeExpireAt;
        if (user.status === cpz.UserStatus.new) {
            secretCode = user.secretCode;
            secretCodeExpireAt = user.secretCodeExpireAt;
        } else {
            secretCode = this.generateCode();
            secretCodeExpireAt = dayjs
                .utc()
                .add(1, cpz.TimeUnit.hour)
                .toISOString();

            db.updateUserSecretCode({
                secretCode,
                secretCodeExpireAt,
                userId: user.id
            });
        }

        const urlData = this.encodeData({
            userId: user.id,
            secretCode
        });
        await this._mail(`${cpz.Service.MAIL}.send`, {
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

    async confirmPasswordReset(params: any, db: DBFunctions) {
        const { userId, secretCode, password } = params;

        const user: cpz.User = await db.getUserById(params);

        if (!user) throw new Error("User account not found.");
        if (user.status === cpz.UserStatus.blocked)
            throw new Error("User account is blocked.");
        if (!user.secretCode) throw new Error("Confirmation code is not set.");
        if (user.secretCode !== secretCode)
            throw new Error("Wrong confirmation code.");

        let newSecretCode = null;
        let newSecretCodeExpireAt = null;
        if (user.status === cpz.UserStatus.new) {
            newSecretCode = user.secretCode;
            newSecretCodeExpireAt = user.secretCodeExpireAt;
        }
        await db.updateUserPassword({
            passwordHash: await bcrypt.hash(password, 10),
            newSecretCode,
            newSecretCodeExpireAt,
            userId
        });

        await this._mail(`${cpz.Service.MAIL}.send`, {
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
            refreshToken: user.refreshToken,
            refreshTokenExpireAt: user.refreshTokenExpireAt
        };
    }

    async registerTg(params: any, db: DBFunctions) {
        const { telegramId, telegramUsername, name } = params;

        const userExists: cpz.User = await db.getUserTg({ telegramId });
        if (userExists) return userExists;
        const newUser: cpz.User = {
            id: uuid(),
            telegramId,
            telegramUsername,
            name,
            status: cpz.UserStatus.enabled,
            roles: {
                allowedRoles: [cpz.UserRoles.user],
                defaultRole: cpz.UserRoles.user
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
        await db.registerUserTg(newUser);

        return newUser;
    }

    generateAccessToken(user: cpz.User) {
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