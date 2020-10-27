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

// subscribe type
export interface SubscribeProps {
    list: string;
    email: string;
    name?: string;
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

export const SubscribePropsSchema: ValidationSchema = {
    email: "string",
    list: "string",
    name: {
        type: "string",
        optional: true
    }
};
