export const BASE_SERVICE_TOPIC = "base-service";

export const enum BaseServiceEvents {
    ERROR = "base-service.error"
}

export const BaseServiceShema = {
    [BaseServiceEvents.ERROR]: {
        service: "string",
        error: "string"
    }
};

export interface BaseServiceError {
    [key: string]: any;
    service: string;
    error: string;
}
