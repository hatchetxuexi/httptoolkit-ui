import * as _ from 'lodash';
import { MockttpSerializedBuffer } from '../types';

// Before imports to avoid circular import with server-api
export const RUNNING_IN_WORKER = typeof window === 'undefined';

export type Empty = _.Dictionary<undefined>;
export function empty(): Empty {
    return {};
}

type Case<R> = [() => boolean, R | undefined];

export function firstMatch<R>(...tests: Array<Case<R> | R | undefined>): R | undefined {
    for (let test of tests) {
        if (_.isArray(test) && _.isFunction(test[0])) {
            const [matcher, result] = test;
            if (matcher() && result) return result;
        } else {
            if (test) return <R>test;
        }
    }
}

// This fairly meaningless override combo seems to be
// required to make it ok to use this when T = X | undefined.
export function lastHeader<T>(val: T | T[]): T;
export function lastHeader<T>(val: T | T[] | undefined): T | undefined;
export function lastHeader<T>(val: T | T[] | undefined): T | undefined {
    if (_.isArray(val)) return val[val.length - 1];
    else return val;
}

export function asHeaderArray(val: string | string[] | undefined, sep = ','): string[] {
    if (_.isArray(val)) {
        // Split individual values, as multiple headers can still have multiple values
        return _.flatMap(val, header =>
            header.split(sep).map(value => value.trim())
        );
    } else if (!val) {
        return [];
    } else {
        return val.split(sep).map(value => value.trim());
    }
}

export function truncate(str: string, length: number) {
    if (str.length <= length) {
        return str;
    } else {
        return str.slice(0, length - 3) + "...";
    }
}

export function joinAnd(val: string[], initialSep = ', ', finalSep = ' and ') {
    if (val.length === 1) return val[0];

    return val.slice(0, -1).join(initialSep) + finalSep + val[val.length - 1];
}

// In some places, we need a Buffer in theory, but we know for sure that it'll never
// be read, we just need to know its size (e.g. calculating compression stats).
// For those cases, it can be useful to *carefully* provide this fake buffer instead.
// Could actually allocate an empty buffer, but that's much more expensive if the
// buffer is large, and probably a waste.
export function fakeBuffer(byteLength: number): FakeBuffer {
    return { byteLength: byteLength };
}
export type FakeBuffer = { byteLength: number };

const encoder = new TextDecoder('utf8', { fatal: true });

// Not a perfect or full check, but a quick test to see if the data in a buffer
// is valid UTF8 (so we should treat it as text) or not (so we should treat it as
// raw binary data). For viewing content as text we don't care (we just always show
// as UTF8) but for _editing_ binary data we need a lossless encoding, not utf8.
// (Monaco isn't perfectly lossless editing binary anyway, but we can try).
export function isProbablyUtf8(buffer: Buffer) {
    try {
        // Just check the first 1kb, in case it's a huge file
        const dataToCheck = buffer.slice(0, 1024);
        encoder.decode(dataToCheck);
        return true; // Decoded OK, probably safe
    } catch (e) {
        return false; // Decoding failed, definitely not valid UTF8
    }
}

function isSerializedBuffer(obj: any): obj is MockttpSerializedBuffer {
    return obj && obj.type === 'Buffer' && !!obj.data;
}

export function asBuffer(data: string | Buffer | MockttpSerializedBuffer | undefined) {
    if (!data) {
        return Buffer.from([]);
    } else if (typeof data === 'string') {
        return Buffer.from(data, 'utf8');
    } else if (isSerializedBuffer(data)) {
        return Buffer.from(data.data);
    } else {
        return data;
    }
}

// Get the length of the given data in bytes, not characters.
// If that's a buffer, the length is used raw, but if it's a string
// it returns the length when encoded as UTF8.
export function byteLength(input: string | Buffer | MockttpSerializedBuffer | undefined) {
    if (!input) {
        return 0;
    } else if (typeof input === 'string') {
        return new Blob([input]).size;
    } else if (isSerializedBuffer(input)) {
        return input.data.length;
    } else {
        return input.length;
    }
}