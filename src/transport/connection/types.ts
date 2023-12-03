import {ConnectionOptions as TlsConnectionOptions, SecureContextOptions} from "tls";
import {URL} from "url";
import * as http from "http";
import {Readable as ReadableStream} from "stream";
import {Connection} from "./Connection";

export declare type agentFn = (opts: ConnectionOptions) => any;
export interface BaseConnectionPoolOptions {
    ssl?: SecureContextOptions;
    agent?: AgentOptions;
    proxy?: string | URL;
    auth?: BasicAuth;
    emit?: (event: string | symbol, ...args: any[]) => boolean;
    Connection: typeof Connection;
}
export interface ConnectionOptions {
    url: URL;
    ssl?: TlsConnectionOptions;
    id?: string;
    headers?: Record<string, any>;
    agent?: AgentOptions | agentFn;
    status?: string;
    roles?: ConnectionRoles;
    auth?: BasicAuth;
    proxy?: string | URL;
}

export interface getConnectionOptions {
    filter?: nodeFilterFn;
    selector?: nodeSelectorFn;
    requestId?: string | number;
    name?: string;
    now?: number;
}

export interface nodeFilterFn {
    (connection: Connection): boolean;
}

export interface nodeSelectorFn {
    (connections: Connection[]): Connection;
}

export interface AgentOptions {
    keepAlive?: boolean;
    keepAliveMsecs?: number;
    maxSockets?: number;
    maxFreeSockets?: number;
}

export interface BasicAuth {
    username: string;
    password: string;
}

export interface RequestOptions extends http.ClientRequestArgs {
    asStream?: boolean;
    body?: string | Buffer | ReadableStream | null;
    querystring?: string;
}

export interface ConnectionRoles {
    cluster_manager?: boolean
    /**
     * @deprecated use cluster_manager instead
     */
    master?: boolean
    data?: boolean
    ingest?: boolean
}

export interface RequestOptions extends http.ClientRequestArgs {
    asStream?: boolean;
    body?: string | Buffer | ReadableStream | null;
    querystring?: string;
}