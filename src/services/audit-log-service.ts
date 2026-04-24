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

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
export function createAuditLogWriter(options: AuditLogWriterOptions): AuditLogWriter {
  const audit: ReviseAudit = {
    scope: options.scope,
    cascade: options.cascade,
    dryRun: options.dryRun,
    startedAt: new Date().toISOString(),
    entries: [],
  };

  const logPath = options.overridePath ?? defaultAuditPath(options);
  mkdirSync(path.dirname(logPath), { recursive: true });

  if (options.format === 'md') {
    writeFileSync(logPath, renderHeader(audit), 'utf-8');
  } else {
    writeFileSync(logPath, JSON.stringify(audit, null, 2), 'utf-8');
  }

  return {
    path: logPath,
    appendEntry(entry: ReviseAuditEntry) {
      audit.entries.push(entry);
      if (options.format === 'md') {
        appendFileSync(logPath, renderEntry(entry), 'utf-8');
      } else {
        // JSON: rewrite the envelope each append. O(n²) over the run, but
        // for a typical cascade (<100 artifacts) this is well under 10ms.
        // The guarantee we need is durability, not write efficiency.
        writeFileSync(logPath, JSON.stringify(audit, null, 2), 'utf-8');
      }
    },
    close(summary) {
      audit.completedAt = new Date().toISOString();
      if (summary?.interrupted) audit.interrupted = summary.interrupted;
      if (summary?.tokenUsage) audit.tokenUsage = summary.tokenUsage;
      if (options.format === 'md') {
        appendFileSync(logPath, renderFooter(audit), 'utf-8');
      } else {
        writeFileSync(logPath, JSON.stringify(audit, null, 2), 'utf-8');
      }
    },
  };
}

function defaultAuditPath(options: AuditLogWriterOptions): string {
  const date = options.dateStamp ?? toIsoDate(new Date());
  const ext = options.format === 'json' ? 'json' : 'md';
  const file = `revise-${options.scope}-${date}.${ext}`;
  return path.join(options.projectDir, '.planr', 'reports', file);
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function renderHeader(audit: ReviseAudit): string {
  const mode = audit.dryRun ? 'dry-run' : 'apply';
  const cascade = audit.cascade ? 'on' : 'off';
  return [
    `# Revise audit — ${audit.scope} (${toIsoDate(new Date(audit.startedAt))})`,
    `> mode=${mode} · cascade=${cascade} · started=${audit.startedAt}`,
    '',
    '## Entries',
    '',
    '',
  ].join('\n');
}

function renderEntry(entry: ReviseAuditEntry): string {
  const out: string[] = [];
  out.push(`### [${entry.outcome}] ${entry.artifactId}`);
  if (entry.artifactPath) out.push(`> ${entry.artifactPath}`);
  out.push(`> timestamp=${entry.timestamp}`);
  out.push('');
  out.push(`**Rationale:** ${entry.rationale}`);

  if (entry.evidence.length > 0) {
    out.push('');
    out.push('**Evidence:**');
    for (const ev of entry.evidence) {
      const quote = ev.quote ? ` — "${truncate(ev.quote, 120)}"` : '';
      out.push(`- [${ev.type}] \`${ev.ref}\`${quote}`);
    }
  }

  if (entry.ambiguous.length > 0) {
    out.push('');
    out.push('**Ambiguous (human decision required):**');
    for (const a of entry.ambiguous) {
      out.push(`- §${a.section}: ${a.reason}`);
    }
  }

  if (entry.error) {
    out.push('');
    out.push(`**Error:** \`${entry.error}\``);
  }

  if (entry.diff && entry.diff.length > 0) {
    out.push('');
    out.push('**Diff:**');
    out.push('```diff');
    out.push(entry.diff);
    out.push('```');
  }

  out.push('');
  return `${out.join('\n')}\n`;
}

function renderFooter(audit: ReviseAudit): string {
  const counts = audit.entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.outcome] = (acc[e.outcome] ?? 0) + 1;
    return acc;
  }, {});
  const summaryRows = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([outcome, n]) => `- ${outcome}: ${n}`);

  const out: string[] = [];
  out.push('');
  out.push('## Summary');
  out.push(`> completed=${audit.completedAt ?? 'n/a'} · entries=${audit.entries.length}`);
  out.push('');
  if (summaryRows.length > 0) {
    out.push(...summaryRows);
  } else {
    out.push('- (no entries recorded)');
  }

  // Cascade-level grouping — only emitted when at least one entry carries
  // a level tag. Includes empty groups (with a count of 0) so readers can
  // see which levels had nothing to process.
  if (audit.cascade) {
    const levels: Array<'epic' | 'features' | 'stories' | 'tasks'> = [
      'epic',
      'features',
      'stories',
      'tasks',
    ];
    const byLevel = audit.entries.reduce<
      Record<string, Array<{ outcome: string; artifactId: string }>>
    >((acc, e) => {
      const key = e.cascadeLevel ?? 'unlabeled';
      if (!acc[key]) acc[key] = [];
      acc[key].push({ outcome: e.outcome, artifactId: e.artifactId });
      return acc;
    }, {});
    out.push('');
    out.push('### By cascade level');
    for (const level of levels) {
      const rows = byLevel[level] ?? [];
      out.push('');
      out.push(`**${level}** (${rows.length}):`);
      if (rows.length === 0) {
        out.push('- (no artifacts at this level)');
        continue;
      }
      for (const row of rows) {
        out.push(`- [${row.outcome}] ${row.artifactId}`);
      }
    }
  }

  if (audit.interrupted) {
    out.push('');
    out.push(
      `**Interrupted:** reason=${audit.interrupted.reason}${audit.interrupted.atArtifactId ? ` (at ${audit.interrupted.atArtifactId})` : ''}`,
    );
  }
  if (audit.tokenUsage) {
    out.push('');
    out.push(
      `**Tokens:** ${audit.tokenUsage.inputTokens.toLocaleString()} in → ${audit.tokenUsage.outputTokens.toLocaleString()} out`,
    );
  }
  out.push('');
  return `${out.join('\n')}\n`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

// ---------------------------------------------------------------------------
// Convenience: load an audit log back into a ReviseAudit (for tooling).
// Not used by the revise command itself but required by future `planr
// revise feedback <finding-id>` in this release.
// ---------------------------------------------------------------------------

export function readAuditJson(logPath: string): ReviseAudit {
  if (!existsSync(logPath)) {
    throw new Error(`Audit log not found at ${logPath}`);
  }
  const raw = readFileSync(logPath, 'utf-8');
  return JSON.parse(raw) as ReviseAudit;
}
