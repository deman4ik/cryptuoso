import { Auth } from "@cryptuoso/auth-utils";
import logger from "@cryptuoso/logger";
import { NextFunction } from "grammy";
import { startActions } from "../dialogs/start";
import { BotContext } from "../types";

export const auth = (authUtils: Auth) => async (ctx: BotContext, next: NextFunction) => {
    if (ctx.session.dialog.current && ["login", "registration", "start"].includes(ctx.session.dialog.current.name)) {
        const isStart = ctx.message.text === ctx.i18n.t("keyboards.startKeybord.start");
        if (isStart) {
            ctx.dialog.enter(startActions.enter);
        }
        await next();
        return;
    }

    if (!ctx.session?.user) {
        try {
            const { user, accessToken } = await authUtils.refreshTokenTg({ telegramId: ctx.from.id });
            ctx.session.user = { ...user, accessToken };
        } catch (err) {
            logger.warn("Auth middleware -", err.message);
            ctx.dialog.enter(startActions.enter);
            await next();
            return;
        }
        await next();
    } else {
        await next();
    }
};
