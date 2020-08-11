import { Service, Protocol } from "restana";
import fetch, { Response } from "node-fetch";
import AuthService from "../app/service";

enum Method {
    GET = "get",
    DELETE = "delete",
    PATCH = "patch",
    POST = "post",
    PUT = "put",
    HEAD = "head",
    OPTIONS = "options",
    TRACE = "trace"
}

export interface MyResponse extends Response {
    parsedBody: { [key: string]: any };
}

export function ajax(
    url: string,
    init?: {
        body?: {};
        headers?: {};
        method?: Method;
    }
): Promise<MyResponse> {
    return fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.method == Method.GET ? undefined : JSON.stringify(init.body)
    })
        .then((r) => Promise.all([r, r.json()]))
        .then((all) => {
            const res = all[0] as MyResponse;
            res.parsedBody = all[1];
            return res;
        });
}
ajax.get = (url: string, headers?: {}): Promise<MyResponse> => {
    return ajax(url, { method: Method.GET, headers });
};
ajax.post = (url: string, headers?: {}, body?: {}): Promise<MyResponse> => {
    return ajax(url, {
        method: Method.POST,
        body,
        headers: Object.assign({ "Content-Type": "application/json" }, headers)
    });
};

export function setProperty(object: any, property: any, value: any) {
    const originalProperty = Object.getOwnPropertyDescriptor(object, property);
    Object.defineProperty(object, property, { value });
    return originalProperty;
}
export function getProperty(obj: any, prop: string) {
    return obj[prop];
}
export function getServerFromService(service: AuthService): Service<Protocol.HTTP> {
    return getProperty(service, "_server");
}