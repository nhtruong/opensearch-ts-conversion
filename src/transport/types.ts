import {Readable as ReadableStream} from "stream";
import {Connection} from "./connection/Connection";

export interface RequestEvent<TResponse = Record<string, any>, TContext = Context> {
    body: TResponse;
    statusCode: number | null;
    headers: Record<string, any> | null;
    warnings: string[] | null;
    meta: {
        context: TContext;
        name: string | symbol;
        request: {
            params: TransportRequestParams;
            options: TransportRequestOptions;
            id: any;
        };
        connection: Connection;
        attempts: number;
        aborted: boolean;
        sniff?: {
            hosts: any[];
            reason: string;
        };
    };
}

export interface ApiResponse<TResponse = Record<string, any>, TContext = Context>
    extends RequestEvent<TResponse, TContext> {}

export interface TransportRequestParams {
    method: string;
    path: string;
    body?: RequestBody;
    bulkBody?: RequestNDBody;
    querystring?: Record<string, any> | string;
}

export interface TransportRequestOptions {
    ignore?: number[];
    requestTimeout?: number | string;
    maxRetries?: number;
    asStream?: boolean;
    headers?: Record<string, any>;
    querystring?: Record<string, any>;
    compression?: 'gzip';
    id?: any;
    context?: Context;
    warnings?: string[];
    opaqueId?: string;
}

export type RequestBody<T = Record<string, any>> = T | string | Buffer | ReadableStream;
export type RequestNDBody<T = Record<string, any>[]> =
    | T
    | string
    | string[]
    | Buffer
    | ReadableStream;

export type Context = unknown;