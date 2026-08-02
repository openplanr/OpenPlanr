/**
 * Content-hash run cache for `planr revise`.
 *
 * Between runs, we hash each artifact's raw content (+ the codebase-digest
 * input, when present) and skip artifacts whose hash matches the last
 * successful revise of that artifact with the same codebase state. Keeps
 * `--all` cheap to re-run on an untouched repo (a common check-before-PR
 * workflow) without sacrificing correctness: any edit to the artifact or
 * the codebase invalidates the cache entry automatically.
 *
 * Persisted at `.planr/reports/.revise-cache.json`. JSON was chosen over
 * a line-oriented format because the cache is small (one entry per
 * artifact) and atomic updates via atomicWriteFile are simpler with JSON.
 *
 * Cache semantics are best-effort: if the cache file is missing or
 * malformed, reads return empty (never throw). Writes are fire-and-forget.
 */
export interface ReviseCacheEntry {
    artifactHash: string;
    /** Digest over codebase-context-relevant state (folder tree, architecture files) — optional. */
    codebaseHash?: string;
    lastOutcome: 'skipped-by-agent' | 'applied' | 'would-apply' | 'flagged';
    lastRunAt: string;
}
export interface ReviseCache {
    entries: Record<string, ReviseCacheEntry>;
}
export declare function defaultCachePath(projectDir: string): string;
export declare function loadCache(projectDir: string): ReviseCache;
export declare function saveCache(projectDir: string, cache: ReviseCache): Promise<void>;
/** SHA-256 of the artifact raw content (body + frontmatter) used as cache key. */
export declare function hashArtifactContent(raw: string): string;
/** Optional SHA-256 over the codebase context string, so code changes invalidate cache. */
export declare function hashCodebaseContext(formatted?: string): string | undefined;
/**
 * Returns true when the given artifact + codebase hash matches the cache
 * entry from a prior successful revise — caller may skip the AI call.
 * A mismatch on either dimension invalidates the entry.
 */
export declare function shouldSkipArtifact(cache: ReviseCache, artifactId: string, artifactHash: string, codebaseHash: string | undefined): boolean;
/**
 * Record an outcome in the cache. Returns a new cache object (pure) so
 * callers can decide when to flush.
 */
export declare function recordOutcome(cache: ReviseCache, artifactId: string, artifactHash: string, codebaseHash: string | undefined, outcome: ReviseCacheEntry['lastOutcome']): ReviseCache;
//# sourceMappingURL=revise-cache-service.d.ts.map