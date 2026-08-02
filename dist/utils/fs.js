import { access, readFile as fsReadFile, writeFile as fsWriteFile, mkdir, readdir, stat, } from 'node:fs/promises';
import path from 'node:path';
export async function ensureDir(dirPath) {
    await mkdir(dirPath, { recursive: true });
}
export async function writeFile(filePath, content) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await fsWriteFile(filePath, content, 'utf-8');
}
export async function readFile(filePath) {
    return fsReadFile(filePath, 'utf-8');
}
export async function fileExists(filePath) {
    return access(filePath)
        .then(() => true)
        .catch(() => false);
}
export async function listFiles(dirPath, pattern) {
    const exists = await access(dirPath)
        .then(() => true)
        .catch(() => false);
    if (!exists)
        return [];
    const entries = await readdir(dirPath);
    if (pattern) {
        return entries.filter((e) => pattern.test(e));
    }
    return entries;
}
/** Maximum file size allowed for --file inputs (500KB). */
export const MAX_INPUT_FILE_SIZE = 500_000;
/**
 * Reads and validates a user-provided input file (e.g., --file flag).
 * Checks size limit before reading to avoid loading oversized files into memory.
 *
 * @returns File contents as string, or `null` if validation failed (error already logged).
 */
export async function readInputFile(filePath, logger) {
    const { valid, size } = await validateFileSize(filePath);
    if (!valid) {
        const sizeMB = (size / 1_000_000).toFixed(2);
        const maxMB = (MAX_INPUT_FILE_SIZE / 1_000_000).toFixed(2);
        logger.error(`File too large: ${sizeMB}MB exceeds maximum of ${maxMB}MB.`);
        return null;
    }
    const content = await readFile(filePath);
    logger.dim(`Read ${content.split('\n').length} lines from ${path.basename(filePath)}`);
    return content;
}
/**
 * Validates that a file is within the allowed size limit.
 * @returns Object with `valid` flag and actual `size` in bytes.
 */
export async function validateFileSize(filePath) {
    const { size } = await stat(filePath);
    return { valid: size <= MAX_INPUT_FILE_SIZE, size };
}
//# sourceMappingURL=fs.js.map