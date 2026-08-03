/** Return the next available sequential ID (e.g. "FEAT-004") for the given prefix in a directory. */
export declare function getNextId(dir: string, prefix: string): Promise<string>;
/** Parse an artifact ID string (e.g. "FEAT-002") into its prefix and numeric parts. */
export declare function parseId(id: string): {
    prefix: string;
    num: number;
} | null;
//# sourceMappingURL=id-service.d.ts.map