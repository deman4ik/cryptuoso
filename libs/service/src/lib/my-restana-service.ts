import { Service, Method, Protocol, Request, Response, RequestHandler, ErrorHandler, Options } from "./my_restana";

interface MiddleWare<P extends Protocol> {
    prefix: string,
    middleware: RequestHandler<P>
};

export default class MyService<P extends Protocol> implements Service<P> {
    public _routes: {
        [key: string]: { // Method
            [key: string]: RequestHandler<P>
        }
    } = {};
    public _middlewares: MiddleWare<P>[] = [];
    public _port: number;
    public _mockConstuctor = jest.fn();
    public _mockErrorHandler: jest.Mock;
    public _mockStart = jest.fn();
    public _mockClose = jest.fn();

    constructor(options?: Options<P>) {
        this._routes[Method.GET] = {};
        this._routes[Method.POST] = {};

        this._mockErrorHandler = jest.fn().mockImplementation(options.errorHandler);

        this._mockConstuctor();
    }

    async _passRequest(req: Request<P>, method: Method = Method.POST, res: any = {}): Promise<{
        callers: string[],
        middlewaresPassedCount: number,
        wasError: boolean,
        routeReached: boolean,
        res: {
            send: jest.Mock,
            end: jest.Mock
        }
    }> {
        const url = req.url = req.url || "";
        req.body = req.body || {};
        req.params = req.params || {};
        req.headers = req.headers || {};

        res.send = res.send || jest.fn();
        res.end = res.end || jest.fn();

        const result = {
            callers: [] as string[],
            middlewaresPassedCount: 0,
            wasError: false,
            routeReached: false,
            res
        }

        
        // middlewares
        const itMiddlewares = new Set(this._middlewares).values();

        await new Promise((resolve, reject) => {
            const next = (err?: Error) => {
                if(err)
                    return reject(err);
                
                const current = itMiddlewares.next();
    
                if(current.done) {
                    result.routeReached = true;
                    return resolve();
                }
                
                const mwObj: MiddleWare<P> = current.value;
    
                if(url.startsWith(mwObj.prefix)) {
                    const func_name:string = mwObj.middleware.name.replace("bound ", "");

                    result.callers.push(func_name);

                    ++result.middlewaresPassedCount;
                    mwObj.middleware(req, res, next) as Promise<any>;
                } else
                    next();
            };
    
            next();
        }).catch(err => {
            result.wasError = true;
            this._mockErrorHandler(err, req, res);
        });

        // route handler

        if(result.routeReached) {
            const routeHandler = this._routes[method][req.url];

            if(routeHandler) {
                const handler = async () => routeHandler(req, res);
                await handler();
            }
        }

        return result;
    }

    routes(): string[] {
        return Object.keys(this._routes);
    }
    //1 path and 1 middleware
    use(): Service<P> {
        if (typeof arguments[0] == "function")
            this._middlewares.push({ prefix: "", middleware: arguments[0] });

        if (typeof arguments[0] == "string" && typeof arguments[1] == "function")
            this._middlewares.push({ prefix: arguments[0], middleware: arguments[1] });

        return this;
    }
    //1 path and 1 middleware
    get(path: string, middleware: RequestHandler<P>): Service<P> {
        this._routes[Method.GET][path] = middleware;
        return this;
    }
    //1 path and 1 middleware
    post(path: string, middleware: RequestHandler<P>): Service<P>    {
        this._routes[Method.POST][path] = middleware;
        return this;
    }
    async start(port?: number, host?: string): Promise<void> {
        this._port = port;
        this._mockStart();
    }
    async close(): Promise<void> {
        this._mockClose();
    }
}