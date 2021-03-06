// Worker.ts
const ctx: Worker = self as any;

import * as serializeError from 'serialize-error';
import { handleContentEncoding } from 'mockttp/dist/util/request-utils';
import { OpenAPIObject } from 'openapi3-ts';

import { compress as brotliCompress } from 'wasm-brotli';
import * as zlib from 'zlib';

import { buildApiMetadata, ApiMetadata } from '../model/api/build-openapi';
import { validatePKCS12, ValidationResult } from '../model/crypto';
import { WorkerFormatterKey, formatBuffer } from './ui-worker-formatters';

const gzipCompress = (buffer: Buffer, options: zlib.ZlibOptions = {}) =>
    new Promise<Buffer>((resolve, reject) => {
        zlib.gzip(buffer, options,
            (error, result) => error ? reject(error) : resolve(result)
        )
    });

const deflate = (buffer: Buffer, options: zlib.ZlibOptions = {}) =>
    new Promise<Buffer>((resolve, reject) => {
        zlib.deflate(buffer, options,
            (error, result) => error ? reject(error) : resolve(result)
        )
    });

const deflateRaw = (buffer: Buffer, options: zlib.ZlibOptions = {}) =>
    new Promise<Buffer>((resolve, reject) => {
        zlib.deflateRaw(buffer, options,
            (error, result) => error ? reject(error) : resolve(result)
        )
    });

interface Message {
    id: number;
}

export interface DecodeRequest extends Message {
    type: 'decode';
    buffer: ArrayBuffer;
    encodings: string[];
}

export interface DecodeResponse extends Message {
    error?: Error;
    inputBuffer: ArrayBuffer; // Send the input back, since we transferred it
    decodedBuffer: ArrayBuffer;
}

export interface EncodeRequest extends Message {
    type: 'encode';
    buffer: ArrayBuffer;
    encodings: string[];
}

export interface EncodeResponse extends Message {
    error?: Error;
    encodedBuffer: ArrayBuffer;
}

export interface TestEncodingsRequest extends Message {
    type: 'test-encodings';
    decodedBuffer: Buffer;
}

export interface TestEncodingsResponse extends Message {
    error?: Error;
    encodingSizes: { [encoding: string]: number };
}

export interface BuildApiRequest extends Message {
    type: 'build-api';
    spec: OpenAPIObject;
    baseUrlOverrides?: string[];
}

export interface BuildApiResponse extends Message {
    error?: Error;
    api: ApiMetadata
}

export interface ValidatePKCSRequest extends Message {
    type: 'validate-pkcs12';
    buffer: ArrayBuffer;
    passphrase: string | undefined;
}

export interface ValidatePKCSResponse extends Message {
    error?: Error;
    result: ValidationResult;
}

export interface FormatRequest extends Message {
    type: 'format';
    buffer: ArrayBuffer;
    format: WorkerFormatterKey;
}

export interface FormatResponse extends Message {
    error?: Error;
    formatted: string;
}

export type BackgroundRequest =
    | DecodeRequest
    | EncodeRequest
    | TestEncodingsRequest
    | BuildApiRequest
    | ValidatePKCSRequest
    | FormatRequest;

export type BackgroundResponse =
    | DecodeResponse
    | EncodeResponse
    | TestEncodingsResponse
    | BuildApiResponse
    | ValidatePKCSResponse
    | FormatResponse;

function decodeRequest(request: DecodeRequest): DecodeResponse {
    const { id, buffer, encodings } = request;

    const result = handleContentEncoding(Buffer.from(buffer), encodings);
    return {
        id,
        inputBuffer: buffer,
        decodedBuffer: result.buffer as ArrayBuffer
    };
}

const encodeContent = async (body: Buffer, encoding: string) => {
    // Encode the content. This is used everywhere that we need to translate to the right encoding.
    // Since we only care about the format, not the compression itself, we *always* trade size for
    // speed. This is all based on handleContentEncoding in Mockttp.
    if (encoding === 'gzip' || encoding === 'x-gzip') {
        return gzipCompress(body, { level: 1 });
    } else if (encoding === 'deflate' || encoding === 'x-deflate') {
        // Deflate is ambiguous, and may or may not have a zlib wrapper.
        // This checks the buffer header directly, based on
        // https://stackoverflow.com/a/37528114/68051
        const lowNibble = body[0] & 0xF;
        if (lowNibble === 8) {
            return deflate(body, { level: 1 });
        } else {
            return deflateRaw(body, { level: 1 });
        }
    } else if (encoding === 'br') {
        return Buffer.from(await brotliCompress(body));
    } else if (!encoding || encoding === 'identity') {
        return body;
    } else {
        throw new Error(`Unknown encoding: ${encoding}`);
    }
};

async function encodeRequest(request: EncodeRequest): Promise<EncodeResponse> {
    const { id, buffer, encodings } = request;

    const result = await encodings.reduce((contentPromise, nextEncoding) => {
        return contentPromise.then((content) =>
            encodeContent(content, nextEncoding)
        )
    }, Promise.resolve(Buffer.from(buffer)));

    return {
        id,
        encodedBuffer: result.buffer
    };
}


async function testEncodings(request: TestEncodingsRequest) {
    const { decodedBuffer } = request;

    return {
        id: request.id,
        encodingSizes: {
            'br': (await brotliCompress(decodedBuffer)).length,
            'gzip': (await gzipCompress(decodedBuffer, { level: 9 })).length,
            'deflate': (await deflate(decodedBuffer, { level: 9 })).length
        }
    };
}

async function buildApi(request: BuildApiRequest): Promise<BuildApiResponse> {
    const { id, spec, baseUrlOverrides } = request;
    return { id, api: await buildApiMetadata(spec, baseUrlOverrides) };
}

ctx.addEventListener('message', async (event: { data: BackgroundRequest }) => {
    try {
        switch (event.data.type) {
            case 'decode':
                const decodeResult = decodeRequest(event.data);
                ctx.postMessage(decodeResult, [
                    decodeResult.inputBuffer,
                    decodeResult.decodedBuffer
                ]);
                break;

            case 'encode':
                const encodeResult = await encodeRequest(event.data);
                ctx.postMessage(encodeResult, [encodeResult.encodedBuffer]);
                break;

            case 'test-encodings':
                const { data } = event;
                ctx.postMessage(await testEncodings(data));
                break;

            case 'build-api':
                ctx.postMessage(await buildApi(event.data));
                break;

            case 'validate-pkcs12':
                const result = validatePKCS12(event.data.buffer, event.data.passphrase);
                ctx.postMessage({ id: event.data.id, result });
                break;

            case 'format':
                const formatted = formatBuffer(event.data.buffer, event.data.format);
                ctx.postMessage({ id: event.data.id, formatted });
                break;

            default:
                console.error('Unknown worker event', event);
        }
    } catch (e) {
        ctx.postMessage({
            id: event.data.id,
            error: serializeError(e)
        });
    }
});