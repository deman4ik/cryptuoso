import MyService from "./my-restana-service";

interface myHttpServer {

};

export enum Protocol {
  HTTP = 'http',
  HTTPS = 'https',
  HTTP2 = 'http2'
}

export type Body =
  | null
  | boolean
  | number
  | string
  | Buffer
  | Body[]
  | { [prop: string]: Body }

export enum Method {
  GET = 'get',
  POST = 'post',
}

export interface RequestExtensions {
  params?: Record<string, string>
  query?: Record<string, string | string[]>
  originalUrl?: string,
  url: string,
  body?: Body,
  headers?: Record<string, string | string[]>
}

export type Request<P extends Protocol> = P extends Protocol.HTTP2
  ? RequestExtensions
  : RequestExtensions

export interface ResponseExtensions {
  send(
    data?: unknown,
    code?: number,
    headers?: Record<string, number | string | string[]>,
    cb?: () => void
  ): void,
  end(): void
}

export interface Router<P extends Protocol> {
  get: RegisterRoute<P>
  post: RegisterRoute<P>
}

export type Response<P extends Protocol> = P extends Protocol.HTTP2
  ? ResponseExtensions
  : ResponseExtensions

export type Server<P extends Protocol> = P extends Protocol.HTTP2
  ? myHttpServer
  : myHttpServer

export type RequestHandler<P extends Protocol> = (
  req: Request<P>,
  res: Response<P>,
  next?: (error?: unknown) => void
) => void | Promise<unknown>

export interface RegisterRoute<P extends Protocol> {
  (
    path: string | string[],
    ...middlewares: RequestHandler<P>[]
  ): Service<P>
}

export type ErrorHandler<P extends Protocol> = (
  err: Error,
  req: Request<P>,
  res: Response<P>,
) => void | Promise<unknown>

export interface Options<P extends Protocol> {
  server?: Server<P>
  prioRequestsProcessing?: boolean
  routerCacheSize?: number
  defaultRoute?: RequestHandler<P>
  errorHandler?: ErrorHandler<P>
}

export interface Service<P extends Protocol> extends Router<P> {
  routes(): string[],
  use(middleware: RequestHandler<P>): Service<P>
  use(prefix: string, middleware: RequestHandler<P>): Service<P>
  use(prefix: string, middleware: Router<P>): Service<P>
  start(port?: number, host?: string): Promise<void>
  close(): Promise<void>
}

export default function restana<P extends Protocol = Protocol.HTTP>(
  options?: Options<P>
): MyService<P> {
  return new MyService(options);
}