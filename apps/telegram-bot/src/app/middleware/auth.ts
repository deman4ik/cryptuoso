import { Auth } from "@cryptuoso/auth-utils";
import logger from "@cryptuoso/logger";
import { NextFunction } from "grammy";
import { BotContext } from "../types";

export const auth = (authUtils: Auth) => async (ctx: BotContext, next: NextFunction) => {
    if (!ctx.session?.user) {
        try {
            const { user, accessToken } = await authUtils.refreshTokenTg({ telegramId: ctx.from.id });
            ctx.session.user = { ...user, accessToken };
        } catch (err) {
            logger.warn("Auth middleware -", err.message);
        }
        await next();
    } else {
        await next();
    }
};
