class BaseError extends Error {
    type: string;
    meta: any;
    constructor(message: string, meta?: { [key: string]: any }, type?: string) {
        super(message);
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
        this.meta = meta;
        this.type = type || this.constructor.name;
    }
}

class ActionsHandlerError extends BaseError {
    statusCode: number;

    constructor(message: string, meta?: { [key: string]: any }, type?: string, statusCode = 400) {
        super(message, meta, type);
        this.statusCode = statusCode;
    }

    get response() {
        return {
            message: this.message,
            code: this.type
        };
    }
}

export { BaseError, ActionsHandlerError };
