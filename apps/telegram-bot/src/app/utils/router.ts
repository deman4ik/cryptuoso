import { Router } from "@grammyjs/router";
import { BotContext } from "../types";

export const createRouter = () => {
    return new Router<BotContext>((ctx: BotContext) => ctx.session?.dialog?.current?.action || "menu");
};
