import { Service, Protocol } from "restana";
import { HTTPService } from "@cryptuoso/service";
import fetch, { Response } from "node-fetch";

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
    parsedBody?: { [key: string]: any };
}

export async function ajax(
    url: string,
    init?: {
        body?: {};
        headers?: {};
        method?: Method;
    }
): Promise<MyResponse> {
    const res: MyResponse = await fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.method == Method.GET ? undefined : JSON.stringify(init.body)
    });

    try {
        res.parsedBody = await res.json();
    } catch (err) {
        res.parsedBody = null;
    }

    return res;
}

ajax.get = (url: string, headers?: {}): Promise<MyResponse> => {
    return ajax(url, { method: Method.GET, headers });
};

ajax.post = async (url: string, headers?: {}, body?: {}): Promise<MyResponse> => {
    return await ajax(url, {
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

export function getServerFromService(service: HTTPService): Service<Protocol.HTTP> {
    return getProperty(service, "_server");
}

export function createServiceRoute(
    service: HTTPService,
    route = "my",
    response: {} = { success: true },
    roles?: string[],
    auth?: boolean,
    inputSchema?: any
): void {
    service.createRoutes({
        [route]: {
            handler: async (req: any, res: any) => {
                res.send(response);
                res.end();
            },
            roles,
            auth,
            inputSchema
        }
    });
}
