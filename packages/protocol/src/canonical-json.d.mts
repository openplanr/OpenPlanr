export declare function canonicalizeJson(value: unknown): string;
export declare function sha256Hex(value: string | Uint8Array): string;
export declare function sha256Jcs(value: unknown): `sha256:${string}`;
export declare function withDocumentDigest<T extends Record<string, unknown>>(
  value: T,
): T & { documentDigest: `sha256:${string}` };
export declare function verifyDocumentDigest(value: unknown): boolean;
