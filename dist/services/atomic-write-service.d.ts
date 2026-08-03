/**
 * Atomic artifact writes with sidecar backup.
 *
 * Atomicity = temp file → fsync → rename. If any step fails mid-write, the
 * original file was never modified and the temp file is removed. There is
 * nothing to "roll back" at the file level — atomicity is the guarantee.
 * The word "rollback" is reserved for the post-flight git mechanism.
 *
 * The sidecar backup copy is for *manual* recovery (e.g., if a user wants
 * to diff an already-written artifact against what was there before). It is
 * not consulted by any automated rollback path.
 */
export interface AtomicWriteOptions {
    /**
     * If provided, the original file is copied here before the write. A
     * typical value is `.planr/reports/revise-<scope>-<date>/backup/<name>.bak`.
     * Missing originals (first write) silently skip the backup step — there
     * is nothing to back up.
     */
    backupPath?: string;
}
export interface AtomicWriteResult {
    /** Absolute path of the file that now holds the new content. */
    targetPath: string;
    /** Absolute path of the sidecar backup, if one was created. */
    backupPath?: string;
}
/**
 * Replace `targetPath` atomically with `content`. Creates the target's
 * parent directory if needed. When `options.backupPath` is set, the
 * existing file (if any) is copied there before the new content is written.
 */
export declare function atomicWriteFile(targetPath: string, content: string, options?: AtomicWriteOptions): Promise<AtomicWriteResult>;
/**
 * Copy `targetPath` to `backupPath` when the original exists. Returns the
 * backup path on success, or `undefined` when there was nothing to back up
 * (original absent). Throws on unexpected I/O errors so callers do not
 * silently proceed with a missing safety copy.
 */
export declare function backupIfPresent(targetPath: string, backupPath: string): Promise<string | undefined>;
//# sourceMappingURL=atomic-write-service.d.ts.map