/**
 * Audit log writer for `planr revise`.
 *
 * Every revise run — dry-run included — produces an audit log capturing
 * applied / skipped / flagged / failed artifacts with rationale, evidence,
 * ambiguities, and unified diffs. Entries are *flushed immediately* to
 * disk as they are produced (see `appendEntry`), not batched at cascade
 * end, so an interrupted run still leaves an accurate record of exactly
 * what was written.
 *
 * Two output formats: Markdown (human-readable, default) and JSON (for CI /
 * tooling / future telemetry workflows). Core structure lives here so
 * token-usage and cache-hit/miss stats can layer on additively.
 */
import type { ReviseAudit, ReviseAuditEntry, ReviseAuditFormat } from '../models/types.js';
export interface AuditLogWriterOptions {
    projectDir: string;
    scope: string;
    cascade: boolean;
    dryRun: boolean;
    format: ReviseAuditFormat;
    /** Override the default path (.planr/reports/revise-<scope>-<date>.<ext>). */
    overridePath?: string;
    /** ISO date used in the default filename. Defaults to today in local time. */
    dateStamp?: string;
}
export interface AuditLogWriter {
    /** Absolute path of the audit file being written. */
    path: string;
    /** Append one artifact entry and flush to disk immediately. */
    appendEntry(entry: ReviseAuditEntry): void;
    /**
     * Close the audit — records `completedAt`, final summary, and (for JSON
     * format) rewrites the file with the accumulated entries wrapped in a
     * ReviseAudit envelope. Markdown output is append-only and closes with a
     * trailing summary section.
     */
    close(summary?: Partial<Pick<ReviseAudit, 'interrupted' | 'tokenUsage'>>): void;
}
/**
 * Create a writer. For Markdown output, writes the header immediately so
 * users can `tail -f` the log during long cascades. For JSON output, the
 * accumulated entries are materialized on close (JSON is not line-oriented).
 */
export declare function createAuditLogWriter(options: AuditLogWriterOptions): AuditLogWriter;
export declare function readAuditJson(logPath: string): ReviseAudit;
//# sourceMappingURL=audit-log-service.d.ts.map