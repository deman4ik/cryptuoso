import { generateRandomString } from "@cryptuoso/helpers";
import logger from "@cryptuoso/logger";
import { NextFunction } from "grammy";
import { BotContext, defaultHandler, defaultMiddleHandler } from "../types";
import { getDialogName } from "./helpers";

export type Router = Map<string, defaultHandler>;
export class DialogsRouter {
    dialogHandlers = new Map<string, defaultHandler>();
    otherwiseHandler = async (ctx: BotContext, next: NextFunction) => {
        logger.warn("Unknown route");
        await next();
    };
    menuHandler: defaultMiddleHandler;

    addDialog(handlers: Router) {
        this.dialogHandlers = new Map([...this.dialogHandlers, ...handlers]);
    }

    init() {
        return async (ctx: BotContext, next: NextFunction) => {
            logger.debug("Initing dialogs");
            ctx.dialog = {
                enter: (action, data, id) => {
                    logger.debug(`Enter ${action}`);
                    ctx.session.dialog.move = {
                        type: "enter",
                        action,
                        data: data ?? {},
                        id
                    };
                },
                jump: (action) => {
                    logger.debug(`Jump ${action}`);
                    ctx.session.dialog.move = {
                        type: "jump",
                        action
                    };
                },
                next: (action) => {
                    logger.debug(`Next ${action}`);
                    ctx.session.dialog.move = {
                        type: "next",
                        action
                    };
                },
                return: (data) => {
                    logger.debug(`Return ${ctx.session.dialog.current?.prev?.action}`);
                    ctx.session.dialog.move = {
                        type: "return",
                        data: data ?? {}
                    };
                },
                reset: () => {
                    ctx.session.dialog.move = {
                        type: "reset"
                    };
                }
            };
            await next();
        };
    }

    otherwise(handler: defaultMiddleHandler) {
        this.otherwiseHandler = handler;
    }

    menu(handler: defaultMiddleHandler) {
        this.menuHandler = handler;
    }

    middleware() {
        return async (ctx: BotContext, next: NextFunction) => {
            let routing = true;
            while (routing) {
                routing = false;

                if (ctx.session.dialog.current) {
                    const current = { ...ctx.session.dialog.current };
                    logger.debug(`Entering ${current.action}`, current);
                    if (!this.dialogHandlers.has(current.action)) {
                        await this.otherwiseHandler(ctx, next);
                    }

                    await this.dialogHandlers.get(current.action)(ctx);
                }

                if (ctx.session.dialog.move) {
                    const move = ctx.session.dialog.move;
                    logger.debug(`New move ${move.type}`, move);
                    switch (move.type) {
                        case "enter": {
                            let prev;
                            if (ctx.session.dialog.current) prev = { ...ctx.session.dialog.current };
                            if (!move.action || !this.dialogHandlers.has(move.action)) {
                                ctx.session.dialog.current = null;
                                await this.otherwiseHandler(ctx, next);
                                break;
                            }

                            ctx.session.dialog.current = {
                                id: move.id ?? generateRandomString(3),
                                action: move.action,
                                name: getDialogName(move.action),
                                data: { ...move.data, edit: false },
                                prev
                            };

                            routing = true;
                            break;
                        }
                        case "next": {
                            logger.debug(ctx.session.dialog);
                            if (
                                !move.action ||
                                !this.dialogHandlers.has(move.action) ||
                                ctx.session.dialog.current.name !== getDialogName(move.action)
                            ) {
                                ctx.session.dialog.current = null;
                                await this.menuHandler(ctx, next);
                                break;
                            }

                            ctx.session.dialog.current.action = move.action;

                            break;
                        }
                        case "jump": {
                            ctx.session.dialog.current.action = move.action;

                            routing = true;
                            break;
                        }
                        case "return": {
                            const current = ctx.session.dialog.current;

                            if (!current.prev) {
                                await this.otherwiseHandler(ctx, next);
                                break;
                            }
                            let prev;
                            if (current.prev.prev) prev = current.prev.prev;

                            ctx.session.dialog.current = {
                                id: generateRandomString(3),
                                action: current.prev.action,
                                name: getDialogName(current.prev.action),
                                data: { ...current.prev.data, ...move.data, edit: false },
                                prev
                            };

                            routing = true;
                            break;
                        }
                        case "reset": {
                            ctx.session.dialog.current = null;
                            await this.menuHandler(ctx, next);
                            break;
                        }
                    }

                    ctx.session.dialog.move = null;
                }
            }

            await next();
        };
    }
}
