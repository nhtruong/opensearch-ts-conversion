import * as http from "http";
import * as https from "https";
import * as hpagent from "hpagent";
import {pipeline} from "stream";
import * as assert from "assert";
import {inspect} from "util";
import {URL} from "url";
import Debug from "debug";
import {ConnectionOptions as TlsConnectionOptions} from "tls";
import {BasicAuth, ConnectionOptions, ConnectionRoles, RequestOptions} from "./types";
import {ConfigurationError, ConnectionError, RequestAbortedError, TimeoutError} from "../../errors";

export class Connection {
    static statuses: {
        ALIVE: string;
        DEAD: string;
    };
    static roles: {
        CLUSTER_MANAGER?: string;
        /**
         * @deprecated use CLUSTER_MANAGER instead
         */
        MASTER?: string;
        DATA: string;
        INGEST: string;
    };
    url: URL;
    ssl: TlsConnectionOptions | null;
    id: string;
    headers: Record<string, any>;
    roles: ConnectionRoles;
    deadCount: number;
    resurrectTimeout: number;
    makeRequest: any;
    _openRequests: number;
    _status: string;
    _agent: http.Agent | https.Agent | hpagent.HttpProxyAgent | hpagent.HttpsProxyAgent;

    constructor(opts?: ConnectionOptions) {
        this.url = opts.url;
        this.ssl = opts.ssl || null;
        this.id = opts.id || stripAuth(opts.url.href);
        this.headers = prepareHeaders(opts.headers, opts.auth);
        this.deadCount = 0;
        this.resurrectTimeout = 0;

        this._openRequests = 0;
        this._status = opts.status || Connection.statuses.ALIVE;
        this.roles = Object.assign({}, defaultRoles, opts.roles);

        if (!['http:', 'https:'].includes(this.url.protocol)) {
            throw new ConfigurationError(`Invalid protocol: '${this.url.protocol}'`);
        }

        if (typeof opts.agent === 'function') {
            this._agent = opts.agent(opts);
        } else if (opts.agent === null) {
            this._agent = undefined;
        } else {
            const agentOptions = Object.assign(
                {},
                {
                    keepAlive: true,
                    keepAliveMsecs: 1000,
                    maxSockets: 256,
                    maxFreeSockets: 256,
                    scheduling: 'lifo' as const,
                    proxy: null,
                },
                opts.agent
            );
            if (opts.proxy) {
                agentOptions.proxy = opts.proxy;
                this._agent =
                    this.url.protocol === 'http:'
                        ? new hpagent.HttpProxyAgent(agentOptions)
                        : new hpagent.HttpsProxyAgent(Object.assign({}, agentOptions, this.ssl));
            } else {
                this._agent =
                    this.url.protocol === 'http:'
                        ? new http.Agent(agentOptions)
                        : new https.Agent(Object.assign({}, agentOptions, this.ssl));
            }
        }

        this.makeRequest = this.url.protocol === 'http:' ? http.request : https.request;
    }

    request(
        params: RequestOptions,
        callback: (err: Error | null, response: http.IncomingMessage | null) => void
    ): http.ClientRequest {
        this._openRequests++;
        let cleanedListeners = false;

        const requestParams = this.buildRequestObject(params);
        // https://github.com/nodejs/node/commit/b961d9fd83
        if (INVALID_PATH_REGEX.test(requestParams.path) === true) {
            callback(new TypeError(`ERR_UNESCAPED_CHARACTERS: ${requestParams.path}`), null);
            /* istanbul ignore next */
            // @ts-ignore
            return { abort: () => {} };
        }

        debug('Starting a new request', params);
        const request = this.makeRequest(requestParams);

        const onResponse = (response) => {
            cleanListeners();
            this._openRequests--;
            callback(null, response);
        };

        const onTimeout = () => {
            cleanListeners();
            this._openRequests--;
            request.once('error', () => {}); // we need to catch the request aborted error
            request.abort();
            callback(new TimeoutError('Request timed out'), null);
        };

        const onError = (err: Error) => {
            cleanListeners();
            this._openRequests--;
            callback(new ConnectionError(err.message), null);
        };

        const onAbort = () => {
            cleanListeners();
            request.once('error', () => {}); // we need to catch the request aborted error
            debug('Request aborted', params);
            this._openRequests--;
            callback(new RequestAbortedError('Request Aborted'), null);
        };

        request.on('response', onResponse);
        request.on('timeout', onTimeout);
        request.on('error', onError);
        request.on('abort', onAbort);

        // Disables the Nagle algorithm
        request.setNoDelay(true);

        // starts the request
        if (isStream(params.body)) {
            pipeline(params.body, request, (err) => {
                /* istanbul ignore if  */
                if (err != null && cleanedListeners === false) {
                    cleanListeners();
                    this._openRequests--;
                    callback(err, null);
                }
            });
        } else {
            request.end(params.body);
        }

        return request;

        function cleanListeners() {
            request.removeListener('response', onResponse);
            request.removeListener('timeout', onTimeout);
            request.removeListener('error', onError);
            request.removeListener('abort', onAbort);
            cleanedListeners = true;
        }
    }

    // TODO: write a better closing logic
    close(callback = () => {}): void {
        debug('Closing connection', this.id);
        if (this._openRequests > 0) {
            setTimeout(() => this.close(callback), 1000);
        } else {
            if (this._agent !== undefined) {
                this._agent.destroy();
            }
            callback();
        }
    }

    setRole(role: string, enabled: boolean): Connection {
        if (validRoles.indexOf(role) === -1) {
            throw new ConfigurationError(`Unsupported role: '${role}'`);
        }
        if (typeof enabled !== 'boolean') {
            throw new ConfigurationError('enabled should be a boolean');
        }

        this.roles[role] = enabled;
        return this;
    }

    get status(): string {
        return this._status;
    }

    set status(status: string) {
        assert(~validStatuses.indexOf(status), `Unsupported status: '${status}'`);
        this._status = status;
    }

    buildRequestObject(params: any): http.ClientRequestArgs {
        const url = this.url;
        const request = {
            protocol: url.protocol,
            hostname: url.hostname[0] === '[' ? url.hostname.slice(1, -1) : url.hostname,
            hash: url.hash,
            search: url.search,
            pathname: url.pathname,
            path: '',
            href: url.href,
            origin: url.origin,
            // https://github.com/elastic/elasticsearch-js/issues/843
            port: url.port !== '' ? url.port : undefined,
            headers: Object.assign({}, this.headers),
            agent: this._agent,
        };

        const paramsKeys = Object.keys(params);
        for (let i = 0, len = paramsKeys.length; i < len; i++) {
            const key = paramsKeys[i];
            if (key === 'path') {
                request.pathname = resolve(request.pathname, params[key]);
            } else if (key === 'querystring' && !!params[key] === true) {
                if (request.search === '') {
                    request.search = '?' + params[key];
                } else {
                    request.search += '&' + params[key];
                }
            } else if (key === 'headers') {
                request.headers = Object.assign({}, request.headers, params.headers);
            } else {
                request[key] = params[key];
            }
        }

        request.path = request.pathname + request.search;

        return request;
    }

    // Handles console.log and utils.inspect invocations.
    // We want to hide `auth`, `agent` and `ssl` since they made
    // the logs very hard to read. The user can still
    // access them with `instance.agent` and `instance.ssl`.
    [inspect.custom]() {
        // eslint-disable-next-line no-unused-vars
        const { authorization, ...headers } = this.headers;

        return {
            url: stripAuth(this.url.toString()),
            id: this.id,
            headers,
            deadCount: this.deadCount,
            resurrectTimeout: this.resurrectTimeout,
            _openRequests: this._openRequests,
            status: this._status,
            roles: this.roles,
        };
    }

    toJSON(): Record<string, any> {
        // eslint-disable-next-line no-unused-vars
        const { authorization, ...headers } = this.headers;

        return {
            url: stripAuth(this.url.toString()),
            id: this.id,
            headers,
            deadCount: this.deadCount,
            resurrectTimeout: this.resurrectTimeout,
            _openRequests: this._openRequests,
            status: this._status,
            roles: this.roles,
        };
    }
}


function stripAuth(url: string): string {
    if (url.indexOf('@') === -1) return url;
    return url.slice(0, url.indexOf('//') + 2) + url.slice(url.indexOf('@') + 1);
}

function isStream(obj: any): boolean {
    return obj != null && typeof obj.pipe === 'function';
}

function resolve(host: string, path:string): string {
    const hostEndWithSlash = host[host.length - 1] === '/';
    const pathStartsWithSlash = path[0] === '/';

    if (hostEndWithSlash === true && pathStartsWithSlash === true) {
        return host + path.slice(1);
    } else if (hostEndWithSlash !== pathStartsWithSlash) {
        return host + path;
    } else {
        return host + '/' + path;
    }
}

function prepareHeaders(headers: http.IncomingHttpHeaders = {}, auth: BasicAuth): http.IncomingHttpHeaders {
    if (auth != null && headers.authorization == null) {
        /* istanbul ignore else */
        if (auth.username && auth.password) {
            headers.authorization =
                'Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
        }
    }
    return headers;
}

const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/;
const debug = Debug('opensearch');
const validStatuses = Object.keys(Connection.statuses).map((k) => Connection.statuses[k]);
const validRoles = Object.keys(Connection.roles).map((k) => Connection.roles[k]);
const defaultRoles = {
    [Connection.roles.DATA]: true,
    [Connection.roles.INGEST]: true,
};
