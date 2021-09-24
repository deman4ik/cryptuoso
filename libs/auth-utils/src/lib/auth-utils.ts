import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";
import dayjs from "@cryptuoso/dayjs";
import { ActionsHandlerError } from "@cryptuoso/errors";
import logger from "@cryptuoso/logger";
import mailUtil from "@cryptuoso/mail";
import { User, UserStatus, UserRoles, UserAccessValues, UserSettings, formatTgName } from "@cryptuoso/user-state";
import { Bcrypt } from "./types";
import bcrypt from "bcrypt";
import { pg, sql } from "@cryptuoso/postgres";
import crypto from "crypto";
import { GA } from "@cryptuoso/analytics";

export class Auth {
    #bcrypt: Bcrypt;
    #mailUtil: typeof mailUtil;

    constructor(/*, bcrypt: Bcrypt */) {
        try {
            this.#bcrypt = bcrypt;
            this.#mailUtil = mailUtil;
        } catch (e) {
            logger.error("Failed to init Auth instance!", e);
        }
    }

    async checkTgLogin(
        loginData: {
            id: number;
            first_name?: string;
            last_name?: string;
            username?: string;
            photo_url?: string;
            auth_date: number;
            hash: string;
        },
        token: string
    ) {
        const secret = crypto.createHash("sha256").update(token).digest();
        const inputHash = loginData.hash;
        const data: { [key: string]: any } = loginData;
        delete data.hash;
        let array = [];
        for (const key in data) {
            array.push(key + "=" + data[key]);
        }
        array = array.sort();
        const checkString = array.join("\n");
        const checkHash = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
        if (checkHash === inputHash) {
            return data;
        } else {
            return false;
        }
    }

    async login(params: { email: string; password: string }) {
        const { email, password } = params;

        const user: User = await pg.maybeOne<User>(sql`
        SELECT id, roles, access, status, password_hash, refresh_token, refresh_token_expire_at
        FROM users
        WHERE email = ${email}
    `);
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

        const passwordChecked = await this.#bcrypt.compare(password, user.passwordHash);

        if (!passwordChecked) throw new ActionsHandlerError("Invalid password.", null, "FORBIDDEN", 403);

        let refreshToken;
        let refreshTokenExpireAt;
        if (
            !user.refreshToken ||
            !user.refreshTokenExpireAt ||
            dayjs.utc(user.refreshTokenExpireAt).add(-1, "day").valueOf() < dayjs.utc().valueOf()
        ) {
            refreshToken = uuid();
            refreshTokenExpireAt = dayjs
                .utc()
                .add(+process.env.REFRESH_TOKEN_EXPIRES, "day")
                .toISOString();
        } else {
            refreshToken = user.refreshToken;
            refreshTokenExpireAt = user.refreshTokenExpireAt;
            await pg.query(sql`
            UPDATE users
            SET refresh_token = ${refreshToken}, 
            refresh_token_expire_at = ${refreshTokenExpireAt}
            WHERE id = ${user.id}
        `);
        }
        GA.event(user.id, "auth", "login");
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
        const loginData = await this.checkTgLogin(params, process.env.BOT_TOKEN);
        if (!loginData) throw new ActionsHandlerError("Invalid login data.", null, "FORBIDDEN", 403);

        const { id: telegramId, first_name: firstName, last_name: lastName, username: telegramUsername } = loginData;
        const name = formatTgName(telegramUsername, firstName, lastName);

        const { user, accessToken } = await this.registerTg({
            telegramId,
            telegramUsername,
            name
        });
        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);

        let refreshToken = null;
        let refreshTokenExpireAt = null;
        if (
            !user.refreshToken ||
            !user.refreshTokenExpireAt ||
            dayjs.utc(user.refreshTokenExpireAt).add(-1, "day").valueOf() < dayjs.utc().valueOf()
        ) {
            refreshToken = uuid();
            refreshTokenExpireAt = dayjs
                .utc()
                .add(+process.env.REFRESH_TOKEN_EXPIRES, "day")
                .toISOString();

            await pg.query(sql`
            UPDATE users
            SET refresh_token = ${refreshToken}, 
            refresh_token_expire_at = ${refreshTokenExpireAt}
            WHERE id = ${user.id}
        `);
        } else {
            refreshToken = user.refreshToken;
            refreshTokenExpireAt = user.refreshTokenExpireAt;
        }
        GA.event(user.id, "auth", "login");
        return {
            accessToken,
            refreshToken,
            refreshTokenExpireAt
        };
    }

    async setTelegram(
        reqUser: User,
        params: {
            id: number;
            first_name?: string;
            last_name?: string;
            username?: string;
            photo_url?: string;
            auth_date: number;
            hash: string;
        }
    ) {
        const loginData = await this.checkTgLogin(params, process.env.BOT_TOKEN);
        if (!loginData) throw new ActionsHandlerError("Invalid login data.", null, "FORBIDDEN", 403);

        const { id: telegramId, username: telegramUsername } = loginData;

        const userExists: User = await pg.maybeOne<User>(sql`
        SELECT id FROM users
        WHERE telegram_id = ${telegramId};
    `);

        if (userExists)
            throw new ActionsHandlerError("User already exists. Try to login with Telegram.", null, "CONFLICT", 409);

        const { id: userId } = reqUser;
        const user: User = await pg.maybeOne<User>(sql`
        SELECT id, roles, access, status, settings FROM users
        WHERE id = ${userId}
    `);

        if (!user) throw new ActionsHandlerError("User account is not found.", null, "NOT_FOUND", 404);

        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);

        const notifications = user.settings?.notifications;

        const newSettings: UserSettings = {
            ...user.settings,
            notifications: {
                signals: {
                    ...notifications?.signals,
                    telegram: true
                },
                trading: {
                    ...notifications?.trading,
                    telegram: true
                },
                news: {
                    ...notifications?.news,
                    telegram: true
                }
            }
        };

        await pg.query(sql`
            UPDATE users
            SET telegram_id = ${telegramId},
                telegram_username = ${telegramUsername},
                status = ${UserStatus.enabled},
                settings = ${JSON.stringify(newSettings)}
            WHERE id = ${userId};
        `);
    }

    async register(params: { email: string; password: string; name: string }) {
        const { email, password, name } = params;

        const userExists: User = await pg.maybeOne<User>(sql`
        SELECT id FROM users
        WHERE email = ${email}
    `);
        if (userExists) throw new ActionsHandlerError("User account already exists.", { email }, "CONFLICT", 409);
        const newUser: User = {
            id: uuid(),
            name,
            email,
            status: UserStatus.new,
            passwordHash: await this.#bcrypt.hash(password, 10),
            secretCode: this.generateCode(),
            roles: {
                allowedRoles: [UserRoles.user],
                defaultRole: UserRoles.user
            },
            access: UserAccessValues.user,
            settings: {
                notifications: {
                    signals: {
                        telegram: false,
                        email: true
                    },
                    trading: {
                        telegram: false,
                        email: true
                    },
                    news: {
                        telegram: false,
                        email: true
                    }
                }
            },
            lastActiveAt: dayjs.utc().toISOString()
        };
        await pg.query(sql`
        INSERT INTO users
            (id, name, email, status, password_hash, secret_code, roles, access, settings)
            VALUES(
                ${newUser.id},
                ${newUser.name || null},
                ${newUser.email},
                ${newUser.status},
                ${newUser.passwordHash},
                ${newUser.secretCode},
                ${JSON.stringify(newUser.roles)},
                ${newUser.access},
                ${JSON.stringify(newUser.settings)}
            );
    `);

        const urlData = this.encodeData({
            userId: newUser.id,
            secretCode: newUser.secretCode
        });
        GA.event(newUser.id, "auth", "register");
        await this.#mailUtil.send({
            to: email,
            subject: "🚀 Welcome to Cryptuoso Robots - Please confirm your email.",
            variables: {
                body: `<p>Greetings!</p>
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

        const userExists: User = await pg.maybeOne<User>(sql`
        SELECT id, telegram_id, telegram_username, name, status, 
        roles, access, settings, last_active_at
        FROM users
        WHERE telegram_id = ${telegramId};
    `);
        if (userExists) return { user: userExists, accessToken: this.generateAccessToken(userExists) };
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
            access: UserAccessValues.user,
            settings: {
                notifications: {
                    signals: {
                        telegram: true,
                        email: false
                    },
                    trading: {
                        telegram: true,
                        email: false
                    },
                    news: {
                        telegram: true,
                        email: false
                    }
                }
            },
            lastActiveAt: dayjs.utc().toISOString()
        };
        await pg.query(sql`
        INSERT INTO users
            (id, telegram_id, telegram_username, name, status, roles, access, settings, last_active_at)
            VALUES(
                ${newUser.id},
                ${newUser.telegramId},
                ${newUser.telegramUsername || null},
                ${newUser.name || null},
                ${newUser.status},
                ${JSON.stringify(newUser.roles)},
                ${newUser.access},
                ${JSON.stringify(newUser.settings)},
                ${newUser.lastActiveAt}
            );
    `);
        GA.event(newUser.id, "auth", "register");
        return { user: newUser, accessToken: this.generateAccessToken(newUser) };
    }

    async registerTgWithEmail(params: { email: string; telegramId: number; telegramUsername: string; name: string }) {
        const { email, telegramId, telegramUsername, name } = params;

        const userExistsWithEmail: User = await pg.maybeOne<User>(sql`
        SELECT id FROM users
        WHERE email = ${email}
    `);
        if (userExistsWithEmail)
            throw new ActionsHandlerError("User account already exists.", { email }, "CONFLICT", 409);

        let user: User = await pg.maybeOne<User>(sql`
        SELECT id, email, telegram_id, telegram_username, roles, access, status, settings, 
        secret_code, secret_code_expire_at, email_new, last_active_at
        FROM users
        WHERE telegram_id = ${telegramId};
    `);

        if (user) {
            if (user.email)
                throw new ActionsHandlerError("Email already specified.", { telegramId, email }, "CONFLICT", 409);

            const notifications = user.settings?.notifications;

            const newSettings: UserSettings = {
                ...user.settings,
                notifications: {
                    signals: {
                        ...notifications?.signals,
                        telegram: true
                    },
                    trading: {
                        ...notifications?.trading,
                        telegram: true
                    },
                    news: {
                        ...notifications?.news,
                        telegram: true
                    }
                }
            };

            if (
                !user.secretCode ||
                !user.secretCodeExpireAt ||
                (user.secretCodeExpireAt && dayjs.utc().valueOf() > dayjs.utc(user.secretCodeExpireAt).valueOf())
            ) {
                user.secretCode = this.generateCode();
                user.secretCodeExpireAt = dayjs.utc().add(1, "hour").toISOString();
            }
            user.emailNew = email;
            await pg.query(sql`UPDATE users 
            SET email_new = ${email},
                secret_code = ${user.secretCode},
                secret_code_expire_at = ${user.secretCodeExpireAt},
                settings = ${JSON.stringify(newSettings)}
            WHERE id = ${user.id};`);
        } else {
            user = {
                id: uuid(),
                name,
                emailNew: email,
                telegramId,
                telegramUsername,
                status: UserStatus.enabled,
                secretCode: this.generateCode(),
                secretCodeExpireAt: dayjs.utc().add(1, "hour").toISOString(),
                roles: {
                    allowedRoles: [UserRoles.user],
                    defaultRole: UserRoles.user
                },
                access: UserAccessValues.user,
                settings: {
                    notifications: {
                        signals: {
                            telegram: true,
                            email: false
                        },
                        trading: {
                            telegram: true,
                            email: false
                        },
                        news: {
                            telegram: true,
                            email: false
                        }
                    }
                },
                lastActiveAt: dayjs.utc().toISOString()
            };
            await pg.query(sql`
            INSERT INTO users
                (id, name, email_new, telegram_id, telegram_username, status, 
                secret_code, secret_code_expire_at, roles, access, settings, last_active_at)
                VALUES(
                    ${user.id},
                    ${user.name || null},
                    ${user.emailNew},
                    ${user.telegramId},
                    ${user.telegramUsername || null},
                    ${user.status},
                    ${user.secretCode},
                    ${user.secretCodeExpireAt},
                    ${JSON.stringify(user.roles)},
                    ${user.access},
                    ${JSON.stringify(user.settings)},
                    ${user.lastActiveAt}
                );
        `);
        }
        GA.event(user.id, "auth", "register");
        await this.#mailUtil.send({
            to: email,
            subject: "🚀 Cryptuoso Robots - Please confirm your email.",
            variables: {
                body: `<p>Greetings!</p>
                <p>Please send this code <b>${user.secretCode}</b> to Cryptuoso Trading Bot in Telegram to confirm your email.</p>
                <p>This request will expire in 1 hour.</p>
                <p>If you did not request this change, no changes have been made to your user account.</p>`
            },
            tags: ["auth"]
        });
        return { user, accessToken: this.generateAccessToken(user) };
    }

    async loginTgWithEmail(params: { email: string }) {
        const { email } = params;
        const secretCode = this.generateCode();
        await this.#mailUtil.send({
            to: email,
            subject: "🚀 Cryptuoso Robots - Telegram Login Request.",
            variables: {
                body: `<p>Greetings!</p>
                <p>We received a request to Login with your email from Cryptuoso Telegram Trading Bot.</p>
                <p>Please send this code <b>${secretCode}</b> to Cryptuoso Trading Bot in Telegram to confirm.</p>
                <p>If you did not request this action, please contact support <a href="mailto:support@cryptuoso.com">support@cryptuoso.com</a>.</p>`
            },
            tags: ["auth"]
        });
        return { secretCode };
    }

    async setTelegramWithEmail(params: { email: string; telegramId: number; telegramUsername: string; name: string }) {
        const { email, telegramId, telegramUsername, name } = params;
        const userExists: User = await pg.maybeOne<User>(sql`
        SELECT id, email FROM users
        WHERE telegram_id = ${telegramId};
    `);

        if (userExists && userExists.email !== email)
            throw new ActionsHandlerError("This telegram is already linked to another account.", null, "CONFLICT", 409);

        const user: User = await pg.maybeOne<User>(sql`
        SELECT id, email, telegram_id, telegram_username, roles, access, status, settings, 
        secret_code, secret_code_expire_at, email_new, last_active_at FROM users
        WHERE email = ${email}
    `);

        if (!user) throw new ActionsHandlerError("User account is not found.", null, "NOT_FOUND", 404);

        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);

        if (user.telegramId)
            throw new ActionsHandlerError("User has already linked telegram account.", null, "FORBIDDEN", 403);

        const notifications = user.settings?.notifications;

        const newSettings: UserSettings = {
            ...user.settings,
            notifications: {
                signals: {
                    ...notifications?.signals,
                    telegram: true
                },
                trading: {
                    ...notifications?.trading,
                    telegram: true
                },
                news: {
                    ...notifications?.news,
                    telegram: true
                }
            }
        };
        user.settings = newSettings;
        user.status = UserStatus.enabled;
        user.name = user.name || name;
        user.telegramId = telegramId;
        user.telegramUsername = telegramUsername;
        await pg.query(sql`
            UPDATE users
            SET telegram_id = ${user.telegramId},
                telegram_username = ${user.telegramUsername || null},
                name = ${user.name || null},
                status = ${user.status},
                settings = ${JSON.stringify(user.settings)}
            WHERE id = ${user.id};
        `);

        return { user, accessToken: this.generateAccessToken(user) };
    }

    async refreshToken(params: { refreshToken: string }) {
        const user: User = await pg.maybeOne<User>(sql`
        SELECT id, roles, access, status, refresh_token, refresh_token_expire_at FROM users
        WHERE refresh_token = ${params.refreshToken} AND refresh_token_expire_at > ${dayjs.utc().toISOString()};
    `);

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
            refreshTokenExpireAt: user.refreshTokenExpireAt,
            userId: user.id
        };
    }

    async refreshTokenTg(params: { telegramId: number }) {
        const { telegramId } = params;
        const user: User = await pg.maybeOne<User>(sql`
        SELECT id, email, name, telegram_id, telegram_username, roles, access, status, settings FROM users
        WHERE telegram_id = ${telegramId};
    `);

        if (!user) throw new ActionsHandlerError("User account is not found.", null, "NOT_FOUND", 404);
        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);

        return {
            user,
            accessToken: this.generateAccessToken(user)
        };
    }

    async refreshTokenChatBot(params: { telegramId?: number; userId?: string }) {
        const { telegramId, userId } = params;
        if (!telegramId && !userId) throw new ActionsHandlerError("Invalid user id", null, "UNAUTHORIZED", 401);
        let query;
        if (telegramId) query = sql`telegram_id = ${telegramId}`;
        if (userId) query = sql`id = ${userId}`;
        const user: User = await pg.maybeOne<User>(sql`
        SELECT id, email, telegram_id, roles, access, status, settings FROM users
        WHERE ${query};
    `);

        if (!user) throw new ActionsHandlerError("User account is not found.", null, "NOT_FOUND", 404);
        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);

        return {
            user,
            accessToken: this.generateAccessToken(user)
        };
    }

    async activateAccount(params: { userId: string; secretCode: string }) {
        const { userId, secretCode } = params;

        const user: User = await pg.maybeOne<User>(sql`
        SELECT  id, email, roles, access, status, secret_code, secret_code_expire_at, refresh_token, refresh_token_expire_at FROM users
        WHERE id = ${userId}
    `);

        if (!user) throw new ActionsHandlerError("User account not found.", null, "NOT_FOUND", 404);
        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);
        if (user.status === UserStatus.enabled)
            throw new ActionsHandlerError("User account is already activated.", null, "FORBIDDEN", 403);
        if (!user.secretCode) throw new ActionsHandlerError("Confirmation code is not set.", null, "FORBIDDEN", 403);
        if (user.secretCode !== secretCode.trim())
            throw new ActionsHandlerError("Wrong confirmation code.", null, "FORBIDDEN", 403);

        const refreshToken = uuid();
        const refreshTokenExpireAt = dayjs
            .utc()
            .add(+process.env.REFRESH_TOKEN_EXPIRES, "day")
            .toISOString();

        await await pg.query(sql`
            UPDATE users
            SET secret_code = ${null},
                secret_code_expire_at = ${null},
                status = ${UserStatus.enabled},
                refresh_token = ${refreshToken},
                refresh_token_expire_at = ${refreshTokenExpireAt}
            WHERE id = ${userId};
        `);

        /*  await this.#mailUtil.subscribeToList({
            list: "cpz-beta@mg.cryptuoso.com",
            email: user.email,
            name: user.name
        });*/

        await this.#mailUtil.send({
            to: user.email,
            subject: "🚀 Welcome to Cryptuoso Robots - User Account Activated.",
            variables: {
                body: `<p>Congratulations!</p>
                <p>Your user account is successfully activated!</p>
                <p>Now you can login to <b><a href="https://cryptuoso.com/auth/login">your account</a></b> using your email and password.</p>
                <p>Please check out our <b><a href="https://cryptuoso.com/info/docs">Documentation</a></b> to get started!</p>`
            },
            tags: ["auth"]
        });
        return {
            accessToken: this.generateAccessToken(user),
            refreshToken,
            refreshTokenExpireAt
        };
    }

    async changePassword(reqUser: User, params: { password: string; oldPassword?: string }) {
        const { password, oldPassword } = params;
        const { id: userId } = reqUser;

        const user = await pg.maybeOne<User>(sql`
        SELECT id, email, roles, access, status, password_hash FROM users
        WHERE id = ${userId}
    `);
        if (!user) throw new ActionsHandlerError("User account not found.", null, "NOT_FOUND", 404);

        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);

        if (user.passwordHash) {
            if (!oldPassword) throw new ActionsHandlerError("Old password is required.", null, "VALIDATION", 400);

            const oldChecked = await this.#bcrypt.compare(oldPassword, user.passwordHash);
            if (!oldChecked) throw new ActionsHandlerError("Wrong old password.", null, "FORBIDDEN", 403);
        }

        const newPasswordHash = await this.#bcrypt.hash(password, 10);

        await pg.query(sql`
            UPDATE users
            SET password_hash = ${newPasswordHash}
            WHERE id = ${userId};
        `);

        if (user.email)
            await this.#mailUtil.send({
                to: user.email,
                subject: "🔐 Cryptuoso - Change Password Confirmation.",
                variables: {
                    body: `
                <p>Your password successfully changed!</p>
                <p>If you did not request this change, please contact support <a href="mailto:support@cryptuoso.com">support@cryptuoso.com</a></p>`
                },
                tags: ["auth"]
            });
    }

    async passwordReset(params: { email: string }) {
        const { email } = params;
        const user: User = await pg.maybeOne<User>(sql`
        SELECT id, roles, access, status, secret_code, secret_code_expire_at FROM users
        WHERE email = ${email}
    `);

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
            secretCodeExpireAt = dayjs.utc().add(1, "hour").toISOString();
        }

        await pg.query(sql`
            UPDATE users
            SET secret_code = ${secretCode}, 
            secret_code_expire_at = ${secretCodeExpireAt}
            WHERE id = ${user.id}
        `);

        const urlData = this.encodeData({
            userId: user.id,
            secretCode
        });
        await this.#mailUtil.send({
            to: user.email,
            subject: "🔐 Cryptuoso - Password Reset Request.",
            variables: {
                body: `
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

        const user: User = await pg.maybeOne<User>(sql`
        SELECT id, roles, access, status, secret_code, secret_code_expire_at FROM users
        WHERE id = ${userId}
    `);

        if (!user) throw new ActionsHandlerError("User account not found.", null, "NOT_FOUND", 404);
        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);
        if (!user.secretCode) throw new ActionsHandlerError("Confirmation code is not set.", null, "FORBIDDEN", 403);
        if (user.secretCode !== secretCode.trim())
            throw new ActionsHandlerError("Wrong confirmation code.", null, "FORBIDDEN", 403);
        if (dayjs.utc().valueOf() > dayjs.utc(user.secretCodeExpireAt).valueOf())
            throw new ActionsHandlerError("Confirmation code is expired.", null, "FORBIDDEN", 403);

        const refreshToken = uuid();
        const refreshTokenExpireAt = dayjs
            .utc()
            .add(+process.env.REFRESH_TOKEN_EXPIRES, "day")
            .toISOString();

        let newSecretCode = null;
        let newSecretCodeExpireAt = null;
        if (user.status === UserStatus.new) {
            newSecretCode = user.secretCode;
            newSecretCodeExpireAt = user.secretCodeExpireAt;
        }

        const passwordHash = await this.#bcrypt.hash(password, 10);
        await pg.query(sql`
        UPDATE users
        SET password_hash = ${passwordHash},
            secret_code = ${newSecretCode},
            secret_code_expire_at = ${newSecretCodeExpireAt},
            refresh_token = ${refreshToken},
            refresh_token_expire_at = ${refreshTokenExpireAt}
        WHERE id = ${userId};
    `);

        await this.#mailUtil.send({
            to: user.email,
            subject: "🔐 Cryptuoso - Reset Password Confirmation.",
            variables: {
                body: `
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
        const userExists: User = await pg.maybeOne<User>(sql`
        SELECT id FROM users
        WHERE email = ${email}
    `);
        if (userExists) throw new ActionsHandlerError("User already exists.", null, "CONFLICT", 409);

        const user: User = await pg.maybeOne<User>(sql`
        SELECT id, roles, access, status, secret_code, secret_code_expire_at FROM users
        WHERE id = ${userId}
    `);
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
            secretCodeExpireAt = dayjs.utc().add(1, "hour").toISOString();
        }

        await pg.query(sql`
            UPDATE users
            SET email_new = ${email},
                secret_code = ${secretCode},
                secret_code_expire_at = ${secretCodeExpireAt}
            WHERE id = ${userId}
        `);

        await this.#mailUtil.send({
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
    }

    async confirmChangeEmail(params: { userId: string; secretCode: string }) {
        const { userId, secretCode } = params;
        const user: User = await pg.maybeOne<User>(sql`
        SELECT id, roles, access, status, email_new, secret_code, secret_code_expire_at
        FROM users
        WHERE id = ${userId}
    `);

        if (!user) throw new ActionsHandlerError("User account not found.", null, "NOT_FOUND", 404);
        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);
        if (!user.emailNew) throw new ActionsHandlerError("New email is not set.", null, "FORBIDDEN", 403);
        if (!user.secretCode) throw new ActionsHandlerError("Confirmation code is not set.", null, "FORBIDDEN", 403);
        if (user.secretCode !== secretCode.trim())
            throw new ActionsHandlerError("Wrong confirmation code.", null, "FORBIDDEN", 403);
        if (dayjs.utc().valueOf() > dayjs.utc(user.secretCodeExpireAt).valueOf())
            throw new ActionsHandlerError("Confirmation code is expired.", null, "FORBIDDEN", 403);

        const refreshToken = uuid();
        const refreshTokenExpireAt = dayjs
            .utc()
            .add(+process.env.REFRESH_TOKEN_EXPIRES, "day")
            .toISOString();

        await pg.query(sql`
        UPDATE users
        SET email = ${user.emailNew},
            email_new = ${null},
            secret_code = ${null},
            secret_code_expire_at = ${null},
            refresh_token = ${refreshToken},
            refresh_token_expire_at = ${refreshTokenExpireAt},
            status = ${UserStatus.enabled}
        WHERE id = ${userId}
    `);

        await this.#mailUtil.send({
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

    async confirmEmailFromTg(params: { telegramId: number; secretCode: string }) {
        const { telegramId, secretCode } = params;
        const user: User = await pg.maybeOne<User>(sql`
        SELECT id, roles, access, status, email_new, secret_code, secret_code_expire_at FROM users
        WHERE telegram_id = ${telegramId}
    `);

        if (!user) throw new ActionsHandlerError("User account not found.", null, "NOT_FOUND", 404);
        if (user.status === UserStatus.blocked)
            throw new ActionsHandlerError("User account is blocked.", null, "FORBIDDEN", 403);
        if (!user.emailNew) throw new ActionsHandlerError("New email is not set.", null, "FORBIDDEN", 403);
        if (!user.secretCode) throw new ActionsHandlerError("Confirmation code is not set.", null, "FORBIDDEN", 403);
        if (user.secretCode !== secretCode.trim())
            throw new ActionsHandlerError("Wrong confirmation code.", null, "FORBIDDEN", 403);
        if (dayjs.utc().valueOf() > dayjs.utc(user.secretCodeExpireAt).valueOf())
            throw new ActionsHandlerError("Confirmation code is expired.", null, "FORBIDDEN", 403);

        await pg.query(sql`
        UPDATE users
        SET email = ${user.emailNew},
            email_new = ${null},
            secret_code = ${null},
            secret_code_expire_at = ${null}
        WHERE id = ${user.id}
    `);

        return {
            accessToken: this.generateAccessToken(user)
        };
    }

    generateAccessToken(user: User, jwtTokenExpires = `${process.env.JWT_TOKEN_EXPIRES}m`) {
        const {
            id,
            roles: { defaultRole, allowedRoles },
            access
        } = user;
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
                expiresIn: jwtTokenExpires
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
