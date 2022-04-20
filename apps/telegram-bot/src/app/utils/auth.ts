import logger from "@cryptuoso/logger";
import { NextFunction } from "grammy";
import { BotContext } from "../types";

export const auth = async (ctx: BotContext, next: NextFunction) => {
    if (ctx.session.dialog.current && ["login", "registration", "start"].includes(ctx.session.dialog.current.name)) {
        await next();
        return;
    }

    if (!ctx.session?.user) {
        try {
            const { user, accessToken } = await ctx.authUtils.refreshTokenTg({ telegramId: ctx.from.id });
            ctx.session.user = { ...user, accessToken };
        } catch (err) {
            logger.warn("Auth middleware -", err.message);
            // ctx.dialog.enter(startActions.enter);
            await next();
            return;
        }
    }

    await next();
};
