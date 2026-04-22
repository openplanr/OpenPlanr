/**
 * Replay a previously-written revise audit to disk without any model calls.
 *
 * Implements after `planr revise --dry-run` produces an audit log
 * with the proposed diffs, `planr revise --apply-from <audit>` reads those
 * diffs and writes them to the corresponding artifacts. Zero tokens spent
 * in this mode.
 *
 * Pipeline:
 *   1. Clean-tree gate (same as normal revise)
 *   2. Parse the audit (via `revise-plan-service`) → list of replayable entries
 *   3. Filter to `would-apply` entries that have a diff + artifact path
 *   4. Per entry:
 *      a. Read current artifact content
 *      b. Apply the stored diff; if the diff doesn't land cleanly (the
 *         source has drifted since the dry-run), skip the entry and
 *         record the skip reason in the new audit
 *      c. Atomic write with sidecar backup
 *      d. Append an `applied-from-plan` entry to the new audit log
 *   5. Post-flight graph-integrity check + git rollback on break
 *
 * Safety gates preserved vs. normal apply:
 * - Clean-tree gate ✓
 * - Atomic writes (temp file + rename) ✓
 * - Post-flight graph integrity + git rollback ✓
 * - Per-artifact confirmation (prompt unless `--yes`) ✓
 *
 * Note: sidecar `.bak` files are deliberately NOT written on this path.
 * Rollback already flows through git (clean-tree gate guarantees HEAD is a
 * valid restore point), so per-file backups would be redundant noise in
 * `.planr/reports/`. The atomic-write guarantee covers partial-write
 * crashes; git covers "I wish I hadn't applied that."
 *
 * Deliberately NOT run on replay:
 * - AI model calls (the point of this feature)
 * - Evidence verification (the dry-run already verified; nothing changes
 *   between dry-run and apply that evidence verification would catch that
 *   the diff-apply staleness check doesn't already catch)
 * - `--cascade` / `--all` orchestration (the audit already encodes the
 *   cascade order as entry order)
 */

import path from 'node:path';
import chalk from 'chalk';
import type { OpenPlanrConfig, ReviseAuditEntry } from '../models/types.js';
import { applyUnifiedDiff } from '../utils/diff.js';
import { readFile } from '../utils/fs.js';
import { display, logger } from '../utils/logger.js';
import { atomicWriteFile } from './atomic-write-service.js';
import { createAuditLogWriter } from './audit-log-service.js';
import { checkCleanTree, checkoutPaths } from './git-service.js';
import { checkGraphIntegrity } from './graph-integrity.js';
import { confirmBulkRevise, promptReviseConfirm } from './prompt-service.js';
import { filterReplayable, type ReplayablePlan, readPlanFromAudit } from './revise-plan-service.js';

export interface ApplyFromAuditOptions {
  projectDir: string;
  config: OpenPlanrConfig;
  auditPath: string;
  allowDirty: boolean;
  /** Print the plan without writing — useful to confirm what would replay. */
  dryRun: boolean;
  /** Skip per-artifact confirmation; still requires typed-YES in an interactive TTY. */
  yes: boolean;
}

/** Returns the process exit code. 0 on success, 1 on fatal error, non-zero on partial/rollback. */
export async function runApplyFromAudit(opts: ApplyFromAuditOptions): Promise<number> {
  const { projectDir, config, auditPath, allowDirty, dryRun, yes } = opts;

  logger.heading(`Apply revise plan from ${path.basename(auditPath)}${dryRun ? ' (dry-run)' : ''}`);
  logger.dim('Mode: replay — zero AI tokens will be spent.');

  // --- Layer 1: clean-tree gate -------------------------------------------
  const treeCheck = await checkCleanTree(projectDir, { allowDirty });
  if (!treeCheck.ok) {
    logger.error(treeCheck.message);
    return 1;
  }
  if (treeCheck.status.kind !== 'clean') {
    logger.warn(treeCheck.message);
  }

  // --- Layer 2: parse the audit -------------------------------------------
  let plan: ReplayablePlan;
  try {
    plan = readPlanFromAudit(auditPath);
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const replayable = filterReplayable(plan);

  logger.info(
    `Parsed ${plan.entries.length} audit entries (${replayable.length} replayable, ${plan.entries.length - replayable.length} skipped/flagged without diff).`,
  );
  if (replayable.length === 0) {
    logger.warn('No replayable entries (would-apply + diff + artifact path). Nothing to do.');
    return 0;
  }

  // --- Bulk confirmation: typed-YES for TTY, flag-only for CI -------------
  if (yes && !dryRun) {
    const summary = buildReplaySummary(auditPath, replayable);
    const confirmed = await confirmBulkRevise(summary);
    if (!confirmed) {
      logger.dim('Confirmation declined — exiting without changes.');
      return 0;
    }
  }

  // --- New audit log for the apply-from-plan run --------------------------
  const writer = createAuditLogWriter({
    projectDir,
    scope: `${plan.scope}-applied`,
    cascade: false,
    dryRun,
    format: 'md',
  });
  logger.dim(`Apply audit log: ${writer.path}`);

  // --- Per-entry replay ---------------------------------------------------
  const affectedPaths: string[] = [];
  let applied = 0;
  let stale = 0;
  let conflicts = 0;
  let skipped = 0;
  let userQuit = false;

  for (let i = 0; i < replayable.length; i++) {
    if (userQuit) break;
    const entry = replayable[i];
    const progress = `[${i + 1}/${replayable.length}] ${entry.artifactId}`;

    if (!entry.artifactPath) {
      skipped++;
      recordSkip(writer, entry, 'stale-skipped', 'no artifact path recorded in plan');
      continue;
    }

    let currentContent: string;
    try {
      currentContent = await readFile(entry.artifactPath);
    } catch (err) {
      stale++;
      recordSkip(
        writer,
        entry,
        'stale-skipped',
        `cannot read artifact: ${err instanceof Error ? err.message : String(err)}`,
      );
      logger.warn(`${progress}: stale — artifact not readable.`);
      continue;
    }

    const patch = applyUnifiedDiff(currentContent, entry.diff ?? '');
    if (!patch.ok) {
      conflicts++;
      recordSkip(writer, entry, 'conflict-skipped', patch.error ?? 'diff did not apply cleanly');
      logger.warn(`${progress}: conflict — ${patch.error}`);
      continue;
    }

    // Per-artifact confirmation (skipped when --yes or --dry-run).
    if (!dryRun && !yes) {
      display.separator(60);
      display.heading(`  ${progress}: ${chalk.yellow('REPLAY REVISE')}`);
      display.line(`  Artifact: ${entry.artifactId}`);
      display.line(`  Rationale: ${entry.rationale}`);
      display.line('');
      display.line('  Diff:');
      const diffPreview = (entry.diff ?? '')
        .split('\n')
        .map((l) => `    ${colorizeDiffLine(l)}`)
        .join('\n');
      display.line(diffPreview);
      display.separator(60);

      const action = await promptReviseConfirm(entry.artifactId);
      if (action === 'skip') {
        skipped++;
        recordSkip(writer, entry, 'skipped-by-user', 'user declined at replay prompt');
        logger.dim(`${progress}: skipped by user.`);
        continue;
      }
      if (action === 'quit') {
        recordSkip(writer, entry, 'skipped-by-user', 'user quit replay at this entry');
        userQuit = true;
        break;
      }
      // For 'diff-again' we just continue; the diff was already shown. For
      // 'edit-rationale' we accept as-is (replay doesn't let you edit).
    }

    if (dryRun) {
      writer.appendEntry({
        ...entry,
        outcome: 'would-apply',
        timestamp: new Date().toISOString(),
      });
      applied++;
      logger.info(`${progress}: would apply (dry-run).`);
      continue;
    }

    // Atomic write (temp file + rename). No sidecar backup — git covers
    // rollback via the clean-tree gate + post-flight checkout.
    try {
      await atomicWriteFile(entry.artifactPath, patch.result ?? '');
      affectedPaths.push(path.relative(projectDir, entry.artifactPath) || entry.artifactPath);
      applied++;
      writer.appendEntry({
        ...entry,
        outcome: 'applied-from-plan',
        timestamp: new Date().toISOString(),
      });
      logger.info(`${progress}: ${chalk.green('applied')}.`);
    } catch (err) {
      conflicts++;
      recordSkip(
        writer,
        entry,
        'conflict-skipped',
        `write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      logger.error(`${progress}: write failed — ${err}`);
    }
  }

  // --- Post-flight graph integrity + rollback -----------------------------
  let exitCode = 0;
  if (!dryRun && affectedPaths.length > 0) {
    const integrity = await checkGraphIntegrity(projectDir, config);
    if (!integrity.ok) {
      logger.error(
        `Post-flight graph integrity broken: ${integrity.issues.length} issue(s). Rolling back…`,
      );
      if (treeCheck.status.kind === 'clean') {
        await checkoutPaths(projectDir, affectedPaths);
        logger.info(`Rolled back ${affectedPaths.length} artifact path(s) to HEAD.`);
      } else {
        logger.warn('Cannot rollback — pre-run tree was dirty. Inspect changes manually.');
      }
      exitCode = 1;
    } else {
      logger.dim('Post-flight graph integrity: ok.');
    }
  }

  writer.close();

  // --- Summary ------------------------------------------------------------
  display.separator(60);
  display.heading('  Replay summary');
  display.line(`  Applied:          ${chalk.green(String(applied))}`);
  display.line(`  Stale-skipped:    ${stale}  (artifact missing or unreadable)`);
  display.line(`  Conflict-skipped: ${conflicts}  (diff did not apply cleanly)`);
  display.line(`  User-skipped:     ${skipped}`);
  display.line(`  ${chalk.bold('AI tokens spent:  0')}  (replay mode — zero model calls)`);
  if (!dryRun && applied > 0 && exitCode === 0) {
    display.line('');
    display.line(
      `  Suggested commit: ${chalk.cyan(`git commit -am "chore(plan): apply revise plan ${plan.scope}"`)}`,
    );
  }
  display.separator(60);

  return exitCode;
}

function recordSkip(
  writer: ReturnType<typeof createAuditLogWriter>,
  entry: ReviseAuditEntry,
  outcome: ReviseAuditEntry['outcome'],
  reason: string,
): void {
  writer.appendEntry({
    ...entry,
    outcome,
    error: reason,
    timestamp: new Date().toISOString(),
  });
}

function buildReplaySummary(auditPath: string, entries: ReviseAuditEntry[]): string {
  const head = `About to replay ${entries.length} revise entries from ${path.basename(auditPath)}.`;
  const sample = entries
    .slice(0, 8)
    .map((e) => `  - ${e.artifactId} (${e.outcome} → applied-from-plan)`)
    .join('\n');
  const tail = entries.length > 8 ? `\n  … and ${entries.length - 8} more` : '';
  return `${head}\nZero model calls will be made.\n${sample}${tail}`;
}

function colorizeDiffLine(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return chalk.bold(line);
  if (line.startsWith('@@')) return chalk.cyan(line);
  if (line.startsWith('+')) return chalk.green(line);
  if (line.startsWith('-')) return chalk.red(line);
  return chalk.dim(line);
}
