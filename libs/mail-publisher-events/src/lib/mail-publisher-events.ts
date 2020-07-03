import { extend } from "dayjs";
/*Типы нотификаций*/
// TODO: Расшарить между сервисами константу с типами нотификейшен
export const enum NOTIFICATIONS_TYPES {
    SIGNAL_ALERT = "signal.alert",
    SIGNAL_TRADE = "signal.trade",
    USER_EX_ACC_ERROR = "user_ex_acc.error",
    USER_ROBOT_FAILED = "user-robot.failed",
    USER_ROBOT_STARTED = "user-robot.started",
    USER_ROBOT_STOPPED = "user-robot.stopped",
    USER_ROBOT_PAUSED = "user-robot.paused",
    USER_ROBOT_RESUMED = "user-robot.resumed",
    USER_ROBOT_TRADE = "user-robot.trade",
    ORDER_ERROR = "order.error",
    MESSAGE_SUPPORT_REPLY = "message.support-reply",
    MESSAGE_BROADCAST = "message.broadcast"
}

export const enum MailPublisherEvents {
    SEND_WELCOME = "mail-publisher.send-welcome",
    SEND_SIGNAL_ALERT = `mail-publisher.send-signal-alert`,
    SEND_SIGNAL_TRADE = `mail-publisher.send-signal-trade`,
    SEND_USER_EX_ACC_ERROR = `mail-publisher.send-user-ex-acc-err`,
    SEND_USER_ROBOT_FAILED = `mail-publisher.send-robot-failed`,
    SEND_USER_ROBOT_STARTED = `mail-publisher.send-robot-started`,
    SEND_USER_ROBOT_STOPPED = `mail-publisher.send-robot-stoped`,
    SEND_USER_ROBOT_PAUSED = `mail-publisher.send-robot-paused`,
    SEND_USER_ROBOT_RESUMED = `mail-publisher.send-robot-resumed`,
    SEND_USER_ROBOT_TRADE = `mail-publisher.send-robot-trade`,
    SEND_ORDER_ERROR = `mail-publisher.send-order-error`,
    SEND_SUPPORT_REPLY = `mail-publisher.send-support-reply`,
    SEND_MESSAGE_BROADCAST = `mail-publisher.send-message-broadcast`,
    SEND_NOTIFICATIONS_AGGREGATE = "mail_publisher.send-aggregate-notifications"
}

export type ROBOT_STATUSES = "stopped" | "started" | "paused" | "resumed";

const BASE_NOTIFY_DATA = {
    to: "string",
    subject: "string",
    tags: {
        type: "array",
        items: "string"
    }
};
// notifications data

const signalAlertData = {
    type: "object",
    props: {
        bodyType: { type: "string" },
        code: { type: "string" }
    }
};

const signalTradeData = {
    type: "object",
    props: {
        bodyType: { type: "string" },
        code: { type: "string" }
    }
};

const userExAccErrData = {
    type: "object",
    props: {
        bodyType: { type: "string" },
        name: { type: "string" },
        error: { type: "string" }
    }
};

const userRobotStatusesData = {
    type: "object",
    props: {
        bodyType: { type: "string" },
        status: { type: "string", stringEnum: ["started", "stopped", "paused", "resumed"] },
        code: { type: "string" },
        message: { type: "string" }
    }
};

const userRobotFailedData = {
    type: "object",
    props: {
        bodyType: { type: "string" },
        jobType: { type: "string" },
        error: { type: "string" },
        code: { type: "string" },
        id: { type: "string" }
    }
};

const orderErrorData = {
    type: "object",
    props: {
        bodyType: { type: "string" },
        exId: { type: "string" },
        error: { type: "string" },
        code: { type: "string" },
        id: { type: "string" }
    }
};

const broadcastMessageData = {
    type: "object",
    props: {
        bodyType: { type: "string" },
        message: { type: "string" }
    }
};

const supportReplyData = {
    type: "object",
    props: {
        bodyType: { type: "string" },
        message: { type: "string" }
    }
};

export const MailPublisherSchema = {
    [MailPublisherEvents.SEND_WELCOME]: {
        email: "string",
        secretCode: "string",
        urlData: "string"
    },
    [MailPublisherEvents.SEND_SIGNAL_ALERT]: {
        ...BASE_NOTIFY_DATA,
        notifications: {
            type: "array",
            items: [signalAlertData]
        }
    },
    [MailPublisherEvents.SEND_SIGNAL_TRADE]: {
        ...BASE_NOTIFY_DATA,
        notifications: {
            type: "array",
            items: [signalTradeData]
        }
    },
    [MailPublisherEvents.SEND_USER_EX_ACC_ERROR]: {
        ...BASE_NOTIFY_DATA,
        notifications: {
            type: "array",
            items: [userExAccErrData]
        }
    },
    [MailPublisherEvents.SEND_USER_ROBOT_STARTED]: {
        ...BASE_NOTIFY_DATA,
        notifications: {
            type: "array",
            items: [userRobotStatusesData]
        }
    },
    [MailPublisherEvents.SEND_USER_ROBOT_STOPPED]: {
        ...BASE_NOTIFY_DATA,
        notifications: {
            type: "array",
            items: [userRobotStatusesData]
        }
    },
    [MailPublisherEvents.SEND_USER_ROBOT_PAUSED]: {
        ...BASE_NOTIFY_DATA,
        notifications: {
            type: "array",
            items: [userRobotStatusesData]
        }
    },
    [MailPublisherEvents.SEND_USER_ROBOT_RESUMED]: {
        ...BASE_NOTIFY_DATA,
        notifications: {
            type: "array",
            items: [userRobotStatusesData]
        }
    },
    [MailPublisherEvents.SEND_USER_ROBOT_FAILED]: {
        ...BASE_NOTIFY_DATA,
        notifications: {
            type: "array",
            items: [userRobotFailedData]
        }
    },
    [MailPublisherEvents.SEND_ORDER_ERROR]: {
        ...BASE_NOTIFY_DATA,
        notifications: {
            type: "array",
            items: [orderErrorData]
        }
    },
    [MailPublisherEvents.SEND_SUPPORT_REPLY]: {
        ...BASE_NOTIFY_DATA,
        notifications: {
            type: "array",
            items: [supportReplyData]
        }
    },
    [MailPublisherEvents.SEND_MESSAGE_BROADCAST]: {
        ...BASE_NOTIFY_DATA,
        notifications: {
            type: "array",
            items: [broadcastMessageData]
        }
    },
    [MailPublisherEvents.SEND_NOTIFICATIONS_AGGREGATE]: {
        ...BASE_NOTIFY_DATA,
        notifications: {
            type: "array",
            items: [
                signalAlertData,
                signalTradeData,
                userExAccErrData,
                userRobotStatusesData,
                userRobotFailedData,
                orderErrorData,
                broadcastMessageData,
                supportReplyData
            ]
        }
    }
};

/*mails*/
export interface SendWelcome {
    email: string;
    secretCode: string;
    urlData: string;
}

/*notifications*/
export interface BaseNotifyInterface {
    to: string;
    subject: string;
    tags: Array<string>;
}

// notifications types
export type supportReplyDataType = {
    message: string;
    bodyType: string;
};

export type signalAlertDataType = {
    code: string;
    bodyType: string;
};

export type signalTradeDataType = {
    code: string;
    bodyType: string;
};

export type userExAccErrDataType = {
    name: string;
    error: string;
    bodyType: string;
};

export type userRobotStatusDataType = {
    status: ROBOT_STATUSES;
    code: string;
    message: string;
    bodyType: string;
};

export type userRobotFailedDataType = {
    jobType: string;
    id: string;
    error: string;
    code: string;
    bodyType: string;
};

export type orderErrorDataType = {
    exId: string;
    error: string;
    code: string;
    id: string;
    bodyType: string;
};

export type broadcastMessageDataType = {
    message: string;
    bodyType: string;
};

export interface SendSignalAlert extends BaseNotifyInterface {
    notifications: [signalAlertDataType];
}

export interface SendSignalTrade extends BaseNotifyInterface {
    notifications: [signalTradeDataType];
}
export interface SendUserExAccErr extends BaseNotifyInterface {
    notifications: [userExAccErrDataType];
}
export interface SendRobotStatuses extends BaseNotifyInterface {
    notifications: [userRobotStatusDataType];
}
export interface SendRobotFailed extends BaseNotifyInterface {
    notifications: [userRobotFailedDataType];
}
export interface SendOrderError extends BaseNotifyInterface {
    notifications: [orderErrorDataType];
}
export interface BroadcastMessage extends BaseNotifyInterface {
    notifications: [broadcastMessageDataType];
}
export interface SendSupportReply extends BaseNotifyInterface {
    notifications: [supportReplyDataType];
}

export interface SendNotificationsAggregate extends BaseNotifyInterface {
    notifications: [
        supportReplyDataType,
        signalAlertDataType,
        signalTradeDataType,
        userExAccErrDataType,
        userRobotStatusDataType,
        userRobotFailedDataType,
        orderErrorDataType,
        broadcastMessageDataType
    ];
}
