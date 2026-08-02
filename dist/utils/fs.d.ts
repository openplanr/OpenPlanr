export declare function ensureDir(dirPath: string): Promise<void>;
export declare function writeFile(filePath: string, content: string): Promise<void>;
export declare function readFile(filePath: string): Promise<string>;
export declare function fileExists(filePath: string): Promise<boolean>;
export declare function listFiles(dirPath: string, pattern?: RegExp): Promise<string[]>;
/** Maximum file size allowed for --file inputs (500KB). */
export declare const MAX_INPUT_FILE_SIZE = 500000;
/**
 * Reads and validates a user-provided input file (e.g., --file flag).
 * Checks size limit before reading to avoid loading oversized files into memory.
 *
 * @returns File contents as string, or `null` if validation failed (error already logged).
 */
export declare function readInputFile(filePath: string, logger: {
    error: (msg: string) => void;
    dim: (msg: string) => void;
}): Promise<string | null>;
/**
 * Validates that a file is within the allowed size limit.
 * @returns Object with `valid` flag and actual `size` in bytes.
 */
export declare function validateFileSize(filePath: string): Promise<{
    valid: boolean;
    size: number;
}>;
//# sourceMappingURL=fs.d.ts.map