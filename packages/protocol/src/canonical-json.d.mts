export declare function canonicalizeJson(value: unknown): string;
export declare function sha256Hex(value: string | Uint8Array): string;
export declare function sha256Jcs(value: unknown): `sha256:${string}`;
export declare function withDocumentDigest<T extends Record<string, unknown>>(
  value: T,
): T & { documentDigest: `sha256:${string}` };
export declare function verifyDocumentDigest(value: unknown): boolean;
/** Already-frozen objects are not descended into, and a cyclic value overflows the stack. */
export declare function deepFreeze<T>(value: T): T;
export declare function assertPlainData(value: unknown, label: string): void;
