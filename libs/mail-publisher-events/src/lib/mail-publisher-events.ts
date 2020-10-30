import {
    COVER_TEMPLATE_TYPES,
    SendProps,
    SubscribeProps,
    SendPropsSchema,
    SubscribePropsSchema
} from "@cryptuoso/mail";
import { SignalType, TradeAction } from "@cryptuoso/market";
import { SignalEvents, Signal } from "@cryptuoso/robot-events";

export enum MailTags {
    AUTH = "auth",
    SIGNALS = "signals",
    TRADING = "trading"
}

export const enum MailPublisherEvents {
    SEND_NOTIFICATION = "mail-publisher.send-notification",
    SEND_TEMPLATE_MAIL = "mail-publisher.send-template-mail",
    SEND_MAIL = "mail-publisher.send-mail",
    SUBSCRIBE_TO_LIST = "mail-publisher.subscribe-to-list"
}

// TODO: fill it more
export enum TemplateMailType {
    WELCOME = "welcome",
    USER_ACCOUNT_ACTIVATED = "user_account_activated",
    PASSWORD_CHANGE_CONFIRMATION = "password_change_confirmation",
    PASSWORD_RESET = "password_reset",
    PASSWORD_RESET_CONFIRMATION = "password_reset_confirmation",
    CHANGE_EMAIL = "change_email",
    CHANGE_EMAIL_CONFIRMATION = "change_email_confirmation",
    SIGNAL_ALERT = "signal_alert",
    SIGNAL_TRADE = "signal_trade"
}

export interface TemplateMailData {
    [TemplateMailType.WELCOME]: {
        urlData: string;
        secretCode: string;
    };
    [TemplateMailType.USER_ACCOUNT_ACTIVATED]: any;
    [TemplateMailType.PASSWORD_CHANGE_CONFIRMATION]: any;
    [TemplateMailType.PASSWORD_RESET]: {
        urlData: string;
        secretCode: string;
    };
    [TemplateMailType.PASSWORD_RESET_CONFIRMATION]: any;
    [TemplateMailType.CHANGE_EMAIL]: {
        secretCode: string;
    };
    [TemplateMailType.CHANGE_EMAIL_CONFIRMATION]: {
        emailNew: string;
    };
    [TemplateMailType.SIGNAL_ALERT]: Signal & {
        robotCode: string;
    };
    [TemplateMailType.SIGNAL_TRADE]: Signal & {
        robotCode: string;
        entryAction?: TradeAction;
        entryPrice?: number;
        entryDate?: string;
        barsHeld?: number;
        profit?: number;
        volume?: number;
    };
    // Retyping problems
    /* & { robotCode: string } & (
            | {
                  type: SignalType.alert;
              }
            | {
                  type: SignalType.trade;
                  action: TradeAction.long | TradeAction.short;
              }
            | {
                  type: SignalType.trade;
                  action: TradeAction.closeLong | TradeAction.closeShort;
                  entryAction: TradeAction;
                  entryPrice: number;
                  entryDate: string;
                  barsHeld: number;
                  profit: number;
              }
        ) */
}

export type TemplateMailObject =
    | {
          type:
              | TemplateMailType.USER_ACCOUNT_ACTIVATED
              | TemplateMailType.PASSWORD_CHANGE_CONFIRMATION
              | TemplateMailType.PASSWORD_RESET_CONFIRMATION;
          data?: any;
      }
    | {
          type: TemplateMailType.WELCOME;
          data: TemplateMailData[TemplateMailType.WELCOME];
      }
    | {
          type: TemplateMailType.PASSWORD_RESET;
          data: TemplateMailData[TemplateMailType.PASSWORD_RESET];
      }
    | {
          type: TemplateMailType.CHANGE_EMAIL;
          data: TemplateMailData[TemplateMailType.CHANGE_EMAIL];
      }
    | {
          type: TemplateMailType.CHANGE_EMAIL_CONFIRMATION;
          data: TemplateMailData[TemplateMailType.CHANGE_EMAIL_CONFIRMATION];
      }
    | {
          type: TemplateMailType.SIGNAL_ALERT;
          data: TemplateMailData[TemplateMailType.SIGNAL_ALERT];
      }
    | {
          type: TemplateMailType.SIGNAL_TRADE;
          data: TemplateMailData[TemplateMailType.SIGNAL_TRADE];
      };

export interface MailPublisherEventData {
    [MailPublisherEvents.SEND_NOTIFICATION]: {
        notificationId: string;
        //template?: COVER_TEMPLATE_TYPES;
    };
    [MailPublisherEvents.SEND_TEMPLATE_MAIL]: {
        from?: string;
        to: string;
        type: TemplateMailType;
        //data?: TemplateMailData[TemplateMailType];
        //template?: COVER_TEMPLATE_TYPES;
    } & TemplateMailObject;
    [MailPublisherEvents.SEND_MAIL]: SendProps;
    [MailPublisherEvents.SUBSCRIBE_TO_LIST]: SubscribeProps;
}

// TODO: do & check
export const MailPublisherSchemes = {
    [MailPublisherEvents.SEND_NOTIFICATION]: {
        notificationId: "uuid"
    },
    [MailPublisherEvents.SEND_TEMPLATE_MAIL]: {
        from: {
            type: "string",
            optional: true
        },
        to: "string",
        type: {
            type: "enum",
            values: Object.values(TemplateMailType)
        },
        data: "object",
        template: {
            type: "enum",
            optional: true,
            values: Object.values(COVER_TEMPLATE_TYPES)
        }
    },
    [MailPublisherEvents.SEND_MAIL]: SendPropsSchema,
    [MailPublisherEvents.SUBSCRIBE_TO_LIST]: SubscribePropsSchema
};
