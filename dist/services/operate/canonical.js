import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { OperateError } from './types.js';
const textEncoder = new TextEncoder();
function serializeNumber(value) {
    if (!Number.isFinite(value)) {
        throw new OperateError('E_OPERATE_STATE_INVALID', 'Canonical JSON rejects non-finite numbers.');
    }
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
}
function assertUnicodeScalarString(value) {
    for (let index = 0; index < value.length; index += 1) {
        const unit = value.charCodeAt(index);
        if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) {
                throw new OperateError('E_OPERATE_STATE_INVALID', 'Canonical JSON rejects lone Unicode surrogate code units.');
            }
            index += 1;
        }
        else if (unit >= 0xdc00 && unit <= 0xdfff) {
            throw new OperateError('E_OPERATE_STATE_INVALID', 'Canonical JSON rejects lone Unicode surrogate code units.');
        }
    }
}
function serialize(value, ancestors) {
    if (value === null)
        return 'null';
    if (typeof value === 'string') {
        assertUnicodeScalarString(value);
        return JSON.stringify(value);
    }
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (typeof value === 'number')
        return serializeNumber(value);
    if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
        throw new OperateError('E_OPERATE_STATE_INVALID', `Canonical JSON cannot serialize ${typeof value}.`);
    }
    if (value === undefined) {
        throw new OperateError('E_OPERATE_STATE_INVALID', 'Canonical JSON rejects undefined values.');
    }
    if (typeof value !== 'object') {
        throw new OperateError('E_OPERATE_STATE_INVALID', 'Unsupported canonical JSON value.');
    }
    if (ancestors.has(value)) {
        throw new OperateError('E_OPERATE_STATE_INVALID', 'Canonical JSON rejects cyclic values.');
    }
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            const items = [];
            for (let index = 0; index < value.length; index += 1) {
                if (!Object.hasOwn(value, index) || value[index] === undefined) {
                    throw new OperateError('E_OPERATE_STATE_INVALID', 'Canonical JSON rejects sparse or undefined array entries.');
                }
                items.push(serialize(value[index], ancestors));
            }
            const extraKeys = Object.keys(value).filter((key) => !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length);
            if (extraKeys.length > 0) {
                throw new OperateError('E_OPERATE_STATE_INVALID', 'Canonical JSON rejects arrays with named properties.');
            }
            return `[${items.join(',')}]`;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new OperateError('E_OPERATE_STATE_INVALID', 'Canonical JSON accepts plain objects only.');
        }
        const object = value;
        const entries = Object.keys(object)
            .sort()
            .map((key) => {
            assertUnicodeScalarString(key);
            return `${JSON.stringify(key)}:${serialize(object[key], ancestors)}`;
        });
        return `{${entries.join(',')}}`;
    }
    finally {
        ancestors.delete(value);
    }
}
/**
 * RFC 8785/JCS-compatible serialization for I-JSON values. It deliberately
 * rejects non-JSON values instead of silently coercing them.
 */
export function canonicalize(value) {
    return serialize(value, new Set());
}
export function canonicalBytes(value) {
    return textEncoder.encode(canonicalize(value));
}
export function sha256Bytes(value) {
    return createHash('sha256').update(value).digest('hex');
}
export function sha256Digest(value) {
    return `sha256:${sha256Bytes(value)}`;
}
export function canonicalDigest(value) {
    return sha256Digest(canonicalBytes(value));
}
export function hmacDigest(value, key) {
    return `hmac-sha256:${createHmac('sha256', key).update(canonicalBytes(value)).digest('hex')}`;
}
export function verifyHmacDigest(value, signature, key) {
    const expected = hmacDigest(value, key);
    const left = Buffer.from(expected);
    const right = Buffer.from(signature);
    return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
export async function putCanonicalContent(contentRoot, value, options = {}) {
    const bytes = canonicalBytes(value);
    const digest = sha256Digest(bytes);
    const hex = digest.slice('sha256:'.length);
    const directory = path.join(contentRoot, hex.slice(0, 2));
    const target = path.join(directory, `${hex.slice(2)}.json`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
        const handle = await open(target, 'wx', 0o600);
        try {
            await handle.writeFile(bytes);
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }
    catch (error) {
        if (error.code !== 'EEXIST')
            throw error;
        const existing = await readFile(target);
        if (sha256Digest(existing) !== digest) {
            throw new OperateError('E_OPERATE_STATE_INVALID', `Content-addressed object ${digest} does not match its path.`);
        }
    }
    return {
        algorithm: 'sha256',
        digest,
        mediaType: 'application/json',
        size: bytes.byteLength,
        sensitivity: options.sensitivity ?? 'internal',
    };
}
export async function readCanonicalContent(contentRoot, reference) {
    const hex = reference.digest.slice('sha256:'.length);
    const target = path.join(contentRoot, hex.slice(0, 2), `${hex.slice(2)}.json`);
    const bytes = await readFile(target);
    if (bytes.byteLength !== reference.size || sha256Digest(bytes) !== reference.digest) {
        throw new OperateError('E_OPERATE_STATE_INVALID', `Content-addressed object ${reference.digest} failed integrity verification.`);
    }
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (canonicalize(parsed) !== bytes.toString('utf8')) {
        throw new OperateError('E_OPERATE_STATE_INVALID', `Content-addressed object ${reference.digest} is not canonical JSON.`);
    }
    return parsed;
}
//# sourceMappingURL=canonical.js.map