import logger from "@cryptuoso/logger";
import { NextFunction } from "grammy";
import { startActions } from "../dialogs/start";
import { BotContext } from "../types";

export const auth = async (ctx: BotContext, next: NextFunction) => {
    if (ctx.session.dialog.current && ["login", "registration", "start"].includes(ctx.session.dialog.current.name)) {
        /* const isStart = ctx.message.text === ctx.i18n.t("keyboards.startKeybord.start");
        if (isStart) {
            ctx.dialog.enter(startActions.enter);
        }*/
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
    if (ctx.session?.user && ctx.session?.user.access !== 5 && ctx.session?.user.access !== 10)
        await ctx.reply("❌  You are not allowed to use this bot. Please contact support");
    else await next();
};
