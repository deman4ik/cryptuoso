import { GenericObject } from "@cryptuoso/helpers";
import { UserPortfolioInfo } from "@cryptuoso/portfolio-state";
import { User, UserExchangeAccountInfo } from "@cryptuoso/user-state";
import { I18nContext } from "@grammyjs/i18n/dist/source";
import { Router } from "@grammyjs/router";
import { Context, NextFunction } from "grammy";
import { ParseModeContext } from "parse-mode";
import { GraphQLClient } from "./utils/graphql-client";

export type defaultHandler = (ctx: BotContext) => Promise<void>;
export type defaultMiddleHandler = (ctx: BotContext, next: NextFunction) => Promise<void>;

export interface SessionData extends DialogSession {
    user?: User & { accessToken: string };
    exchanges?: { code: string; name: string }[];
    userExAcc?: UserExchangeAccountInfo;
    portfolio?: UserPortfolioInfo;
}
export interface ContextExt extends Context {
    readonly i18n: I18nContext;
    session: SessionData;
    gql: GraphQLClient;
    catalog: {
        options: string[];
    };
}

export interface DialogMethods {
    dialog: {
        enter: (action: string, data?: GenericObject<any>, id?: string) => void;
        jump: (action: string) => void;
        next: (action: string) => void;
        return: (data?: GenericObject<any>) => void;
        reset: () => void;
    };
}

export interface Dialog {
    name: string;
    router: Router<BotContext>;
}

export interface DialogState {
    id: string;
    name: string;
    action: string;
    data?: GenericObject<any>;
    prev?: DialogState;
}

export interface DialogMove {
    type: "enter" | "next" | "jump" | "return" | "end" | "reset";
    action?: string;
    data?: GenericObject<any>;
    id?: string;
}

export interface DialogSession {
    dialog: {
        current: DialogState;
        move: DialogMove;
    };
}

export type BotContext = ContextExt & DialogMethods & ParseModeContext;
