import type { OperatingContentReference, OperatingSensitivity } from './types.js';
/**
 * RFC 8785/JCS-compatible serialization for I-JSON values. It deliberately
 * rejects non-JSON values instead of silently coercing them.
 */
export declare function canonicalize(value: unknown): string;
export declare function canonicalBytes(value: unknown): Uint8Array;
export declare function sha256Bytes(value: Uint8Array | string): string;
export declare function sha256Digest(value: Uint8Array | string): `sha256:${string}`;
export declare function canonicalDigest(value: unknown): `sha256:${string}`;
export declare function hmacDigest(value: unknown, key: Uint8Array): `hmac-sha256:${string}`;
export declare function verifyHmacDigest(value: unknown, signature: `hmac-sha256:${string}`, key: Uint8Array): boolean;
export interface ContentStoreOptions {
    sensitivity?: OperatingSensitivity;
}
export declare function putCanonicalContent(contentRoot: string, value: unknown, options?: ContentStoreOptions): Promise<OperatingContentReference>;
export declare function readCanonicalContent<T>(contentRoot: string, reference: OperatingContentReference): Promise<T>;
//# sourceMappingURL=canonical.d.ts.map