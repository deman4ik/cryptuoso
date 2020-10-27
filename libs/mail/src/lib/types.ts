import { ValidationSchema } from "fastest-validator";

/*template types*/
export enum COVER_TEMPLATE_TYPES {
    main = "main",
    simple = "simple"
}

// message send types
export interface SendProps {
    from?: string;
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
    template?: COVER_TEMPLATE_TYPES;
    variables?: { [key: string]: string };
    tags: string[];
}

export const SendPropsSchema: ValidationSchema = {
    from: {
        type: "string",
        optional: true
    },
    to: [
        {
            type: "string"
        },
        {
            type: "array",
            items: "string"
        }
    ],
    subject: "string",
    text: {
        type: "string",
        optional: true
    },
    html: {
        type: "string",
        optional: true
    },
    template: {
        type: "enum",
        values: Object.values(COVER_TEMPLATE_TYPES),
        optional: true
    },
    variables: {
        type: "object",
        optional: true
    },
    tags: {
        type: "array",
        items: "string"
    }
};

// subscribe type
export interface SubscribeProps {
    list: string;
    email: string;
    name?: string;
}

export const SubscribePropsSchema: ValidationSchema = {
    email: "string",
    list: "string",
    name: {
        type: "string",
        optional: true
    }
};

export enum MailGunEventTypes {
    OPENED = "OPENED",
    UNSUBSCRIBED = "UNSUBSCRIBED",
    DELIVERED = "DELIVERED"
}

export interface MailGunEventData {
    event: MailGunEventTypes;
    /** Event id maybe */
    id: string;
    /** email */
    recipient: string;
    message: {
        headers: {
            /** MailGun message id */
            "message-id": string;
        };
    };
    tags: string[]; //MailTags[]
    "mailing-list"?: {
        address: string;
        "list-id": string;
        sid: string;
    };
}

export const MailGunEventDataSchema: ValidationSchema = {
    signature: {
        type: "object",
        props: {
            timestamp: "string",
            token: {
                type: "string",
                length: 50
            },
            signature: "string"
        }
    },
    "event-data": {
        type: "object",
        props: {
            event: "string",
            id: "string",
            recipient: "string",
            message: {
                type: "object",
                props: {
                    headers: {
                        type: "object",
                        props: {
                            "message-id": "string"
                        }
                    }
                }
            },
            tags: {
                type: "array",
                items: "string"
            },
            "mailing-list": {
                type: "object",
                optional: true,
                props: {
                    address: "string",
                    "list-id": "string",
                    sid: "string"
                }
            }
        }
    }
};
