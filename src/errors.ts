import { ApiResponse } from './transport/types';

export class OpenSearchClientError extends Error {
    name: string;
    message: string;
    constructor(message: string) {
        super(message);
        this.name = 'OpenSearchClientError';
    }
}

class ApiResponseError extends OpenSearchClientError {
    meta: ApiResponse;
    constructor(message: string, meta?: ApiResponse) {
        super(message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
        this.meta = meta;
    }
}

export class TimeoutError extends ApiResponseError {}

export class ConnectionError extends ApiResponseError {}

export class RequestAbortedError extends ApiResponseError {}

export class NotCompatibleError extends ApiResponseError {
    constructor(meta: ApiResponse) {
        super('The client noticed that the server is not a supported distribution', meta);
    }
}

export class NoLivingConnectionsError extends ApiResponseError {
    constructor(meta: ApiResponse) {
        super('Given the configuration, the ConnectionPool was not able to find a usable Connection for this request.', meta);
    }
}

export class SerializationError extends OpenSearchClientError {
    data: Record<string, any>
    constructor(message: string, data: Record<string, any>) {
        super(message);
        Error.captureStackTrace(this, SerializationError);
        this.name = 'SerializationError';
        this.message = message || 'Serialization Error';
        this.data = data;
    }
}

export class DeserializationError extends OpenSearchClientError {
    data: Record<string, any>
    constructor(message: string, data: Record<string, any>) {
        super(message);
        Error.captureStackTrace(this, DeserializationError);
        this.name = 'DeserializationError';
        this.message = message || 'Deserialization Error';
        this.data = data;
    }
}

export class ConfigurationError extends OpenSearchClientError {
    constructor(message: string){
        super(message || 'Configuration Error');
        Error.captureStackTrace(this, ConfigurationError);
        this.name = 'ConfigurationError';
    }
}

export class ResponseError extends ApiResponseError {
    constructor(meta: ApiResponse) {
        super('Response Error', meta);
        if (meta.body && meta.body.error && meta.body.error.type) {
            if (Array.isArray(meta.body.error.root_cause)) {
                this.message = meta.body.error.type + ': ';
                this.message += meta.body.error.root_cause
                    .map((entry) => `[${entry.type}] Reason: ${entry.reason}`)
                    .join('; ');
            } else {
                this.message = meta.body.error.type;
            }
        } else {
            this.message = 'Response Error';
        }
        this.meta = meta;
    }

    get body() {
        return this.meta.body;
    }

    get statusCode() {
        if (this.meta.body && typeof this.meta.body.status === 'number') {
            return this.meta.body.status;
        }
        return this.meta.statusCode;
    }

    get headers() {
        return this.meta.headers;
    }

    toString() {
        return JSON.stringify(this.meta.body);
    }
}