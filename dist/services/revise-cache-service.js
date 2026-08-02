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
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from './atomic-write-service.js';
const EMPTY = { entries: {} };
export function defaultCachePath(projectDir) {
    return path.join(projectDir, '.planr', 'reports', '.revise-cache.json');
}
export function loadCache(projectDir) {
    const p = defaultCachePath(projectDir);
    if (!existsSync(p))
        return { entries: {} };
    try {
        const raw = readFileSync(p, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.entries) {
            return { entries: parsed.entries };
        }
        return EMPTY;
    }
    catch {
        return EMPTY;
    }
}
export async function saveCache(projectDir, cache) {
    await atomicWriteFile(defaultCachePath(projectDir), JSON.stringify(cache, null, 2));
}
/** SHA-256 of the artifact raw content (body + frontmatter) used as cache key. */
export function hashArtifactContent(raw) {
    return createHash('sha256').update(raw).digest('hex');
}
/** Optional SHA-256 over the codebase context string, so code changes invalidate cache. */
export function hashCodebaseContext(formatted) {
    if (!formatted)
        return undefined;
    return createHash('sha256').update(formatted).digest('hex');
}
/**
 * Returns true when the given artifact + codebase hash matches the cache
 * entry from a prior successful revise — caller may skip the AI call.
 * A mismatch on either dimension invalidates the entry.
 */
export function shouldSkipArtifact(cache, artifactId, artifactHash, codebaseHash) {
    const entry = cache.entries[artifactId];
    if (!entry)
        return false;
    if (entry.artifactHash !== artifactHash)
        return false;
    if (entry.codebaseHash !== codebaseHash)
        return false;
    // Only cache-skip when the prior outcome indicated "nothing to do".
    return entry.lastOutcome === 'skipped-by-agent';
}
/**
 * Record an outcome in the cache. Returns a new cache object (pure) so
 * callers can decide when to flush.
 */
export function recordOutcome(cache, artifactId, artifactHash, codebaseHash, outcome) {
    return {
        entries: {
            ...cache.entries,
            [artifactId]: {
                artifactHash,
                codebaseHash,
                lastOutcome: outcome,
                lastRunAt: new Date().toISOString(),
            },
        },
    };
}
//# sourceMappingURL=revise-cache-service.js.map