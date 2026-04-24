/**
 * Revise plan parser.
 *
 * A "plan" is a previously-written revise audit log that we replay to disk
 * without any model calls. This service parses a Markdown audit file
 * emitted by `audit-log-service.ts` back into structured `ReviseAuditEntry`
 * records that the CLI's apply-from-audit path can replay.
 *
 * Parsing is deliberately strict about structure but tolerant of
 * whitespace — audit files are written by us and edited by no-one, so we
 * can rely on the heading hierarchy and section markers. If a user has
 * hand-edited the audit, the parser surfaces specific errors so the user
 * can fix or discard the file rather than silently getting bad replays.
 *
 * Future extension: we may emit a sidecar `.plan.json` next to the
 * Markdown audit to carry content hashes and `revisedMarkdown` without
 * parsing overhead. The Markdown path remains supported indefinitely —
 * older audits predate any sidecar format and still need replay support.
 */

import { readFileSync } from 'node:fs';
import type {
  ReviseAuditEntry,
  ReviseAuditOutcome,
  ReviseEvidence,
  ReviseEvidenceType,
} from '../models/types.js';

export interface ReplayablePlan {
  /** Absolute path of the audit file this plan was parsed from. */
  sourcePath: string;
  /** Scope recorded in the audit header (e.g., "EPIC-001"). */
  scope: string;
  /** When the dry-run was started, from the audit header. */
  startedAt?: string;
  /** All entries, preserving original order. Includes skipped/flagged for the summary. */
  entries: ReviseAuditEntry[];
}

/**
 * Parse a revise Markdown audit log into its constituent entries.
 * Throws if the file cannot be read, is empty, or has no entries.
 */
export function readPlanFromAudit(auditPath: string): ReplayablePlan {
  let raw: string;
  try {
    raw = readFileSync(auditPath, 'utf-8');
  } catch (err) {
    throw new Error(
      `Cannot read audit file at ${auditPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (raw.length === 0) {
    throw new Error(`Audit file ${auditPath} is empty.`);
  }

  const { scope, startedAt } = parseHeader(raw, auditPath);
  const entries = parseEntries(raw, auditPath);

  if (entries.length === 0) {
    throw new Error(
      `Audit file ${auditPath} contains no entries — nothing to apply. Re-run revise with --dry-run first.`,
    );
  }

  return { sourcePath: auditPath, scope, startedAt, entries };
}

/** Entries that can actually be written on replay (have a diff and target path). */
export function filterReplayable(plan: ReplayablePlan): ReviseAuditEntry[] {
  return plan.entries.filter(
    (e) => e.outcome === 'would-apply' && e.artifactPath && e.diff && e.diff.length > 0,
  );
}

// ---------------------------------------------------------------------------
// Parsing internals
// ---------------------------------------------------------------------------

function parseHeader(raw: string, auditPath: string): { scope: string; startedAt?: string } {
  const title = raw.match(/^#\s+Revise audit\s+—\s+([A-Z]+-\d{3,})\b/m);
  if (!title) {
    throw new Error(
      `Audit file ${auditPath} does not start with a recognizable header (expected "# Revise audit — <SCOPE>").`,
    );
  }
  const scope = title[1];
  const started = raw.match(/started=([0-9T:\-.Z]+)/);
  return { scope, startedAt: started ? started[1] : undefined };
}

/**
 * Split the audit body into entries by the `### [outcome] ArtifactId` heading.
 * Each entry then parses independently; any entry that fails to parse is
 * collected with a reason in its error field rather than aborting the whole
 * parse — the caller filters to `would-apply` for replay, so skipped/malformed
 * entries simply won't be replayed.
 */
function parseEntries(raw: string, auditPath: string): ReviseAuditEntry[] {
  // The `## Entries` / `## Summary` headings bookend the body; we scan between them.
  const entriesStart = raw.indexOf('\n## Entries');
  const summaryStart = raw.indexOf('\n## Summary');
  const body =
    entriesStart >= 0
      ? raw.slice(entriesStart, summaryStart >= 0 ? summaryStart : raw.length)
      : raw;

  // Split on the entry heading. Each chunk (except the first, which is the
  // `## Entries` preamble) corresponds to one entry.
  const chunks = body.split(/\n(?=### \[)/);
  const entries: ReviseAuditEntry[] = [];
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith('### [')) continue;
    const parsed = parseEntry(trimmed, auditPath);
    if (parsed) entries.push(parsed);
  }
  return entries;
}

function parseEntry(chunk: string, _auditPath: string): ReviseAuditEntry | null {
  const heading = chunk.match(/^### \[([^\]]+)\]\s+(\S+)/);
  if (!heading) return null;
  const outcome = heading[1] as ReviseAuditOutcome;
  const artifactId = heading[2];

  const artifactPathMatch = chunk.match(/\n>\s+(\/[^\s\n]+\.md)/);
  const artifactPath = artifactPathMatch ? artifactPathMatch[1] : undefined;

  const timestampMatch = chunk.match(/timestamp=([0-9T:\-.Z]+)/);
  const timestamp = timestampMatch ? timestampMatch[1] : new Date().toISOString();

  const rationaleMatch = chunk.match(/\*\*Rationale:\*\*\s+([\s\S]*?)(?=\n\n\*\*|\n\n```|$)/);
  const rationale = rationaleMatch ? rationaleMatch[1].trim() : '';

  const evidence = parseEvidenceList(chunk);
  const ambiguous = parseAmbiguousList(chunk);
  const diff = parseDiffBlock(chunk);

  return {
    artifactId,
    artifactPath,
    outcome,
    rationale,
    evidence,
    ambiguous,
    diff,
    timestamp,
    // Older audits don't carry these; the replay flow is responsible for
    // computing / verifying them against live content when present.
  };
}

function parseEvidenceList(chunk: string): ReviseEvidence[] {
  // Match from `**Evidence:**` heading to the next `**Xxx:**` / `## ` /
  // fenced-diff / end.
  const section = chunk.match(/\*\*Evidence:\*\*\s*\n([\s\S]*?)(?=\n\n\*\*[A-Z]|\n\n```|\n## |$)/);
  if (!section) return [];
  const out: ReviseEvidence[] = [];
  const lineRe = /^-\s+\[([a-z_]+)\]\s+`([^`]+)`(?:\s+—\s+"([\s\S]*?)"\s*$)?/gm;
  let m: RegExpExecArray | null = lineRe.exec(section[1]);
  while (m !== null) {
    out.push({
      type: m[1] as ReviseEvidenceType,
      ref: m[2],
      quote: m[3],
    });
    m = lineRe.exec(section[1]);
  }
  return out;
}

function parseAmbiguousList(chunk: string): ReviseAuditEntry['ambiguous'] {
  const section = chunk.match(
    /\*\*Ambiguous[^*]*\*\*\s*\n([\s\S]*?)(?=\n\n\*\*[A-Z]|\n\n```|\n## |$)/,
  );
  if (!section) return [];
  const out: NonNullable<ReviseAuditEntry['ambiguous']> = [];
  const lineRe = /^-\s+§([^:]+):\s+(.+)$/gm;
  let m: RegExpExecArray | null = lineRe.exec(section[1]);
  while (m !== null) {
    out.push({ section: m[1].trim(), reason: m[2].trim() });
    m = lineRe.exec(section[1]);
  }
  return out;
}

function parseDiffBlock(chunk: string): string | undefined {
  const m = chunk.match(/\*\*Diff:\*\*\s*\n```diff\n([\s\S]*?)\n```/);
  return m ? m[1] : undefined;
}
