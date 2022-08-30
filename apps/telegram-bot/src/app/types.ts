import { Auth } from "@cryptuoso/auth-utils";
import { Subscription, SubscriptionOption, UserPayment, UserSub } from "@cryptuoso/billing";
import { GenericObject } from "@cryptuoso/helpers";
import { UserPortfolioInfo } from "@cryptuoso/portfolio-state";
import { User, UserExchangeAccountInfo } from "@cryptuoso/user-state";
import { I18nContext } from "@grammyjs/i18n/dist/source";
import { Router } from "@grammyjs/router";
import { Context, NextFunction } from "grammy";
import type { ParseModeContext } from "@grammyjs/parse-mode";
import { GraphQLClient } from "./utils/graphql-client";
import { DatabasePool } from "@cryptuoso/postgres";

export type defaultHandler = (ctx: BotContext) => Promise<void>;
export type defaultMiddleHandler = (ctx: BotContext, next: NextFunction) => Promise<void>;

export interface SessionData extends DialogSession {
    user?: User & { accessToken: string };
    exchanges?: { code: string; name: string }[];
    userExAcc?: UserExchangeAccountInfo;
    portfolio?: UserPortfolioInfo;
    userSub?: IUserSub;
    updatedAt?: string;
}
export interface ContextExt extends Context {
    readonly i18n: I18nContext;
    session: SessionData;
    gql: GraphQLClient;
    catalog: {
        options: string[];
    };
    authUtils: Auth;
    utils: {
        [key: string]: any;
    };
    pg: DatabasePool;
}

export interface DialogMethods {
    dialog: {
        enter: (action: string, data?: GenericObject<any>, id?: string) => void;
        jump: (action: string, data?: GenericObject<any>) => void;
        next: (action: string) => void;
        return: (data?: GenericObject<any>) => void;
        reset: () => void;
        edit: () => Promise<void>;
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

export interface IUserSub {
    id: UserSub["id"];
    userId: UserSub["userId"];
    status: UserSub["status"];
    trial_started: UserSub["trialStarted"];
    trial_ended: UserSub["trialEnded"];
    active_from: UserSub["activeFrom"];
    active_to: UserSub["activeTo"];
    subscription: {
        id: Subscription["id"];
        name: Subscription["name"];
        description: Subscription["description"];
    };
    subscriptionOption: {
        code: SubscriptionOption["code"];
        name: SubscriptionOption["name"];
    };
    userPayments?: IUserPayment[];
}

export interface IUserPayment {
    id: UserPayment["id"];
    code: UserPayment["code"];
    url: UserPayment["url"];
    status: UserPayment["status"];
    price: UserPayment["price"];
    created_at: UserPayment["createdAt"];
    expires_at: UserPayment["expiresAt"];
    subscription_from: UserPayment["subscriptionFrom"];
    subscription_to: UserPayment["subscriptionTo"];
    userSub?: {
        subscriptionOption: {
            name: SubscriptionOption["name"];
        };
        subscription: {
            name: Subscription["name"];
        };
    };
}

export interface ISubscription {
    id: Subscription["id"];
    name: Subscription["name"];
    description: Subscription["description"];
    trial_available: Subscription["trialAvailable"];
    options: {
        code: SubscriptionOption["code"];
        name: SubscriptionOption["name"];
        sort_order: SubscriptionOption["sortOrder"];
        unit: SubscriptionOption["unit"];
        amount: SubscriptionOption["amount"];
        price_month: SubscriptionOption["priceMonth"];
        price_total: SubscriptionOption["priceTotal"];
        discount?: SubscriptionOption["discount"];
        free_months?: SubscriptionOption["freeMonths"];
        highlight: SubscriptionOption["highlight"];
    }[];
}

export type BotContext = ContextExt & DialogMethods & ParseModeContext;
