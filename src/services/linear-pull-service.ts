/**
 * Linear → OpenPlanr pull-direction sync.
 *
 * Two concerns consolidated here because both are strictly pull and share
 * the same client lifecycle and auth surface:
 *
 *   1. **Workflow-status sync**: for Features and Stories with a stored
 *      `linearIssueId`, fetch the current Linear workflow state name and
 *      write OpenPlanr `status` frontmatter when mapped.
 *
 *   2. **Task checkbox sync**: bidirectional 3-way merge between local
 *      TASK markdown and Linear TaskList issue description bodies.
 *      Pull-side lives here; push-side lives in `linear-push-service.ts`.
 *
 * Keeping them in one module reduces call-site noise for
 * `planr linear sync` and gives the next reader one file to understand
 * everything that pulls state from Linear.
 */

import type { LinearClient } from '@linear/sdk';
import type { ParsedSubtask } from '../agents/task-parser.js';
import { parseTaskMarkdown } from '../agents/task-parser.js';
import type { BacklogStatus, OpenPlanrConfig, TaskStatus } from '../models/types.js';
import { isVerbose, logger } from '../utils/logger.js';
import {
  applyTaskCheckboxStateMap,
  parseTaskCheckboxLines,
  parseTaskCheckboxReconciled,
  serializeTaskCheckboxReconciled,
} from '../utils/markdown.js';
import {
  listArtifacts,
  readArtifact,
  readArtifactRaw,
  updateArtifact,
  updateArtifactFields,
} from './artifact-service.js';
import { isNonInteractive } from './interactive-state.js';
import {
  ensureAutoStateIdMap,
  ensureTeamEstimationType,
  formatTaskCheckboxBody,
  getAutoStateIdMap,
  resolveBacklogStateIdForPush,
  resolveTaskStateIdForPush,
} from './linear-push-service.js';
import {
  fetchLinearIssueStateNames,
  getLinearIssueDescription,
  isLikelyLinearIssueId,
  isLikelyLinearWorkflowStateId,
  updateLinearIssue,
} from './linear-service.js';
import { promptSelect } from './prompt-service.js';

// ---------------------------------------------------------------------------
// Workflow-status sync
// ---------------------------------------------------------------------------

function asTaskStatus(s: unknown): TaskStatus {
  if (s === 'pending' || s === 'in-progress' || s === 'done' || s === 'blocked') return s;
  return 'pending';
}

function normalizeStateKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Default Linear workflow state name → OpenPlanr `TaskStatus` (case-insensitive keys).
 * User `linear.statusMap` overrides/extends these.
 */
const DEFAULT_LINEAR_STATE_TO_OP: [string, TaskStatus][] = [
  ['backlog', 'pending'],
  ['triage', 'pending'],
  ['unstarted', 'pending'],
  ['todo', 'pending'],
  ['canceled', 'done'],
  ['cancelled', 'done'],
  ['done', 'done'],
  ['completed', 'done'],
  ['in progress', 'in-progress'],
  ['in development', 'in-progress'],
  ['in review', 'in-progress'],
  ['blocked', 'blocked'],
];

export function buildNameToStatusMap(
  user: Record<string, string> | undefined,
): Map<string, TaskStatus> {
  const m = new Map<string, TaskStatus>();
  for (const [k, v] of DEFAULT_LINEAR_STATE_TO_OP) {
    m.set(normalizeStateKey(k), v);
  }
  if (user) {
    for (const [linearName, raw] of Object.entries(user)) {
      if (isLikelyLinearWorkflowStateId(raw)) continue;
      if (raw === 'pending' || raw === 'in-progress' || raw === 'done' || raw === 'blocked') {
        m.set(normalizeStateKey(linearName), raw);
      }
    }
  }
  return m;
}

export function mapLinearNameToTaskStatus(
  stateName: string,
  byName: Map<string, TaskStatus>,
): TaskStatus | undefined {
  return byName.get(normalizeStateKey(stateName));
}

/**
 * Linear state name → BacklogStatus. Backlog items use a different vocabulary
 * from tasks/stories/features: any "in flight" Linear state (Todo, In Progress,
 * In Review) maps to `open`, while Linear "done" states (Done, Completed,
 * Canceled) map to `closed`. We deliberately never emit `promoted` from the
 * pull path — that state implies a local target pointer we don't have from
 * Linear. User `linear.statusMap` can override defaults.
 */
const DEFAULT_LINEAR_STATE_TO_BACKLOG: [string, BacklogStatus][] = [
  ['backlog', 'open'],
  ['triage', 'open'],
  ['unstarted', 'open'],
  ['todo', 'open'],
  ['in progress', 'open'],
  ['in development', 'open'],
  ['in review', 'open'],
  ['canceled', 'closed'],
  ['cancelled', 'closed'],
  ['done', 'closed'],
  ['completed', 'closed'],
];

export function buildNameToBacklogStatusMap(
  user: Record<string, string> | undefined,
): Map<string, BacklogStatus> {
  const m = new Map<string, BacklogStatus>();
  for (const [k, v] of DEFAULT_LINEAR_STATE_TO_BACKLOG) {
    m.set(normalizeStateKey(k), v);
  }
  if (user) {
    for (const [linearName, raw] of Object.entries(user)) {
      if (isLikelyLinearWorkflowStateId(raw)) continue;
      if (raw === 'open' || raw === 'closed' || raw === 'promoted') {
        m.set(normalizeStateKey(linearName), raw);
      }
    }
  }
  return m;
}

export function mapLinearNameToBacklogStatus(
  stateName: string,
  byName: Map<string, BacklogStatus>,
): BacklogStatus | undefined {
  return byName.get(normalizeStateKey(stateName));
}

export interface LinearStatusSyncSummary {
  /** Local artifacts overwritten with Linear's state (the pull direction). */
  updated: number;
  /** Linear issues updated from local state (the push-on-sync direction). */
  pushedToLinear: number;
  /** Local and Linear already agree — no write either direction. */
  unchanged: number;
  /** Per-artifact conflicts resolved via `--on-conflict` (includes non-interactive defaults). */
  conflictDecisions: number;
  /** Linear returned a state name we don't know how to map. */
  unmapped: number;
  /** Artifact had no `linearIssueId` or an unparseable one. */
  skippedNoId: number;
  /** Linear didn't return the issue (deleted / no access). */
  missingFromApi: number;
  /** Push-back to Linear failed (API error); local frontmatter left unchanged. */
  pushFailures: number;
}

/**
 * Shared three-way merge strategy — governs how both checkbox sync and
 * status sync resolve conflicts. Reused from the existing checkbox merge
 * so users get one flag (`--on-conflict`) for both.
 */
export type ConflictStrategy = 'prompt' | 'local' | 'linear';

/**
 * One side of a three-way status decision. Analogous to the `CheckboxConflict`
 * record used by the task-checkbox merge, but scalar (single `status` value
 * per artifact, not per-checkbox).
 */
export interface StatusConflict {
  base: string | undefined; // last-synced value from `linearStatusReconciled`
  local: string; // current frontmatter status
  remote: string; // mapped Linear state (via mapLinearNameTo{Task,Backlog}Status)
}

/**
 * Pure three-way merge decision for a single artifact's workflow status.
 *
 * Mirrors `resolveTaskCheckboxFinalStates` but on a scalar. Returns
 * `side='unchanged'` when local and remote already agree (counter path),
 * `side='linear'` when the remote changed and should be pulled, `side='local'`
 * when the local changed and should be pushed back to Linear. True
 * conflicts (both diverged from base, or no base and they disagree) are
 * resolved per `strategy`.
 */
export function resolveStatusFinalState(
  c: StatusConflict,
  strategy: ConflictStrategy,
): {
  final: string;
  side: 'unchanged' | 'local' | 'linear';
  conflictDecisions: number;
  isTrueConflict: boolean;
} {
  const { base, local, remote } = c;

  // Fast path: nothing to do.
  if (local === remote) {
    return { final: local, side: 'unchanged', conflictDecisions: 0, isTrueConflict: false };
  }

  // Only one side diverged from base — propagate its change.
  if (base !== undefined) {
    if (base === local && local !== remote) {
      // Linear changed since last sync → pull.
      return { final: remote, side: 'linear', conflictDecisions: 0, isTrueConflict: false };
    }
    if (base === remote && local !== remote) {
      // Local changed since last sync → push.
      return { final: local, side: 'local', conflictDecisions: 0, isTrueConflict: false };
    }
  }

  // True conflict: both changed, or no base and they disagree.
  // Strategy dictates which wins; we always record a conflict decision so
  // the summary + audit log reflect reality.
  if (strategy === 'local') {
    return { final: local, side: 'local', conflictDecisions: 1, isTrueConflict: true };
  }
  if (strategy === 'linear') {
    return { final: remote, side: 'linear', conflictDecisions: 1, isTrueConflict: true };
  }
  // strategy === 'prompt': caller resolves interactively after seeing the
  // conflict. Report the true-conflict marker so the sync loop can dispatch
  // to promptSelect and increment the counter.
  return { final: local, side: 'local', conflictDecisions: 1, isTrueConflict: true };
}

type Tracked = {
  type: 'feature' | 'story' | 'quick' | 'backlog';
  id: string;
  linearIssueId: string;
  localStatus: string;
  baseStatus: string | undefined;
};

/**
 * Non-interactive auto-resolution audit entry for a status conflict —
 * parallel to `AutoResolvedConflict` for checkboxes. Keys are strings, not
 * booleans, so we keep this as a separate type instead of reusing the
 * checkbox one.
 */
interface AutoResolvedStatusConflict {
  kind: 'feature' | 'story' | 'quick' | 'backlog';
  id: string;
  base: string | undefined;
  local: string;
  remote: string;
  chosen: 'local' | 'linear';
  timestamp: string;
}

export async function syncLinearStatusIntoArtifacts(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  options?: { dryRun?: boolean; onConflict?: ConflictStrategy },
): Promise<LinearStatusSyncSummary> {
  const dryRun = options?.dryRun === true;
  const strategy: ConflictStrategy = options?.onConflict ?? 'prompt';
  const summary: LinearStatusSyncSummary = {
    updated: 0,
    pushedToLinear: 0,
    unchanged: 0,
    conflictDecisions: 0,
    unmapped: 0,
    skippedNoId: 0,
    missingFromApi: 0,
    pushFailures: 0,
  };

  const teamId = config.linear?.teamId;
  if (!teamId) {
    // Without a team id we can't push back. Fall back to pull-only behavior
    // — the rest of the function handles `side: 'local'` as best-effort
    // (skipping the API call when teamId is missing).
    logger.debug('linear sync: no linear.teamId configured; skipping push-back path');
  } else {
    // Prime the auto-derived state-id map + estimation-type cache the same
    // way `runLinearPush` does, so conflict resolutions that flip to `local`
    // can call `updateLinearIssue(stateId)` without a separate fetch.
    await ensureAutoStateIdMap(client, teamId);
    await ensureTeamEstimationType(client, teamId);
  }

  const byNameTask = buildNameToStatusMap(config.linear?.statusMap);
  const byNameBacklog = buildNameToBacklogStatusMap(config.linear?.statusMap);
  const tracked: Tracked[] = [];

  for (const type of ['feature', 'story', 'quick', 'backlog'] as const) {
    const list = await listArtifacts(projectDir, config, type);
    for (const row of list) {
      const art = await readArtifact(projectDir, config, type, row.id);
      if (!art) continue;
      const linearId = art.data.linearIssueId as string | undefined;
      if (!linearId) {
        logger.debug(`linear sync: skip ${row.id} (no linearIssueId in frontmatter)`);
        summary.skippedNoId++;
        continue;
      }
      // Same validation as checkbox sync: don't feed malformed ids to the API.
      if (!isLikelyLinearIssueId(linearId)) {
        logger.warn(
          `${type} ${row.id}: linearIssueId "${linearId}" is not a valid Linear id (expected uuid or \`ENG-42\` identifier). Skipping status sync — re-run \`planr linear push\` to repair.`,
        );
        summary.skippedNoId++;
        continue;
      }
      // For backlog items we keep the raw status so the `promoted` guard and
      // `open/closed/promoted` comparisons stay honest. For the other types,
      // the task-status coercion preserves existing behavior.
      const localStatus =
        type === 'backlog' ? String(art.data.status ?? 'open') : asTaskStatus(art.data.status);
      const rawBase = art.data.linearStatusReconciled;
      const baseStatus =
        typeof rawBase === 'string' && rawBase.trim().length > 0 ? rawBase.trim() : undefined;
      tracked.push({ type, id: row.id, linearIssueId: linearId, localStatus, baseStatus });
    }
  }

  if (tracked.length === 0) {
    return summary;
  }

  const ids = tracked.map((t) => t.linearIssueId);
  const fromLinear = await fetchLinearIssueStateNames(client, ids);
  const autoResolvedConflicts: AutoResolvedStatusConflict[] = [];

  for (const t of tracked) {
    const stateName = fromLinear.get(t.linearIssueId);
    if (stateName === undefined) {
      logger.warn(
        `linear sync: issue ${t.linearIssueId} (${t.type} ${t.id}) not returned by Linear (deleted or no access) — left unchanged.`,
      );
      summary.missingFromApi++;
      continue;
    }
    const mapped: string | undefined =
      t.type === 'backlog'
        ? mapLinearNameToBacklogStatus(stateName, byNameBacklog)
        : mapLinearNameToTaskStatus(stateName, byNameTask);
    if (mapped === undefined) {
      logger.warn(
        `linear sync: unmapped Linear state "${stateName}" for ${t.type} ${t.id} — left unchanged.`,
      );
      summary.unmapped++;
      continue;
    }
    // `promoted` is a local-only BL state (the BL was promoted to a QT/story
    // with a target pointer recorded in the BL body). Linear has no equivalent
    // signal, so pulling `Done` back would destroy the `promoted → target`
    // linkage. Treat as unchanged.
    if (t.type === 'backlog' && t.localStatus === 'promoted') {
      if (isVerbose()) {
        logger.debug(`linear sync: backlog ${t.id} kept as "promoted" (local-only state)`);
      }
      summary.unchanged++;
      continue;
    }

    // Three-way merge: local vs remote vs base (`linearStatusReconciled`).
    const decision = resolveStatusFinalState(
      { base: t.baseStatus, local: t.localStatus, remote: mapped },
      strategy,
    );

    if (decision.side === 'unchanged') {
      if (isVerbose()) {
        logger.debug(`linear sync: ${t.type} ${t.id} unchanged (${mapped})`);
      }
      summary.unchanged++;
      continue;
    }

    // For true conflicts under `prompt`, ask the user. The pure helper
    // returned a placeholder; `promptSelect` picks the real winner here.
    let resolvedSide: 'local' | 'linear' = decision.side;
    let resolvedFinal = decision.final;
    if (decision.isTrueConflict) {
      summary.conflictDecisions++;
      const label = `${t.type} ${t.id}`;
      if (strategy === 'prompt' && !isNonInteractive()) {
        const picked = await promptSelect(
          `${label}: status conflict (base=${t.baseStatus ?? '—'} local=${t.localStatus} remote=${mapped}). Use which side?`,
          [
            { name: 'Local file', value: 'local' as const },
            { name: 'Linear', value: 'linear' as const },
          ],
          'linear',
        );
        resolvedSide = picked;
        resolvedFinal = picked === 'local' ? t.localStatus : mapped;
      } else if (strategy === 'prompt' && isNonInteractive()) {
        logger.dim(
          `  [auto] ${label} status conflict (base=${t.baseStatus ?? '—'} local=${t.localStatus} remote=${mapped}): using Linear (set --on-conflict local|linear to override)`,
        );
        resolvedSide = 'linear';
        resolvedFinal = mapped;
        autoResolvedConflicts.push({
          kind: t.type,
          id: t.id,
          base: t.baseStatus,
          local: t.localStatus,
          remote: mapped,
          chosen: 'linear',
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Apply the resolution.
    if (resolvedSide === 'linear') {
      // Pull: write local frontmatter to match Linear.
      if (!dryRun) {
        await updateArtifactFields(projectDir, config, t.type, t.id, {
          status: resolvedFinal,
          linearStatusReconciled: resolvedFinal,
          linearStatusSyncedAt: new Date().toISOString(),
        });
      }
      if (isVerbose()) {
        logger.debug(
          `linear sync: ${t.type} ${t.id} pulled Linear → local: ${t.localStatus} → ${resolvedFinal} (Linear: "${stateName}")`,
        );
      }
      summary.updated++;
    } else {
      // Push: write Linear's state to match local.
      if (!teamId) {
        logger.warn(
          `linear sync: ${t.type} ${t.id} has local change (${t.localStatus}) but no linear.teamId configured — skipping push-back.`,
        );
        summary.pushFailures++;
        continue;
      }
      const stateId =
        t.type === 'backlog'
          ? resolveBacklogStateIdForPush(config, resolvedFinal, getAutoStateIdMap(client))
          : resolveTaskStateIdForPush(config, resolvedFinal, getAutoStateIdMap(client));
      if (!stateId) {
        logger.warn(
          `linear sync: ${t.type} ${t.id} local status "${resolvedFinal}" has no matching Linear state (check linear.pushStateIds or team workflow states). Skipping push-back.`,
        );
        summary.pushFailures++;
        continue;
      }
      if (!dryRun) {
        try {
          await updateLinearIssue(client, t.linearIssueId, { stateId });
          await updateArtifactFields(projectDir, config, t.type, t.id, {
            linearStatusReconciled: resolvedFinal,
            linearStatusSyncedAt: new Date().toISOString(),
          });
        } catch (err) {
          logger.warn(
            `linear sync: push-back failed for ${t.type} ${t.id} (${(err as Error).message}) — local frontmatter unchanged, will retry on next sync.`,
          );
          summary.pushFailures++;
          continue;
        }
      }
      if (isVerbose()) {
        logger.debug(
          `linear sync: ${t.type} ${t.id} pushed local → Linear: ${resolvedFinal} (was Linear: "${stateName}")`,
        );
      }
      summary.pushedToLinear++;
    }
  }

  if (!dryRun && autoResolvedConflicts.length > 0) {
    await appendStatusSyncConflictAudit(projectDir, autoResolvedConflicts);
  }

  return summary;
}

async function appendStatusSyncConflictAudit(
  projectDir: string,
  entries: readonly AutoResolvedStatusConflict[],
): Promise<void> {
  const { appendFile, mkdir } = await import('node:fs/promises');
  const path = await import('node:path');
  const { existsSync } = await import('node:fs');
  const today = new Date().toISOString().slice(0, 10);
  const dir = path.join(projectDir, '.planr', 'reports');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `linear-sync-conflicts-${today}.md`);
  const isNew = !existsSync(file);
  const fmt = (v: string | undefined): string => (v === undefined ? '—' : v);
  const rows = entries
    .map(
      (e) =>
        `| ${e.timestamp} | status | ${e.kind} ${e.id} | ${fmt(e.base)} | ${e.local} | ${e.remote} | ${e.chosen} |`,
    )
    .join('\n');
  const header = isNew
    ? `# Linear sync conflict audit — ${today}\n\n> Auto-resolved conflicts from non-interactive \`planr linear sync\` runs. Each row is one artifact where local and Linear disagreed and the default resolution was picked without human confirmation.\n\n| timestamp | kind | artifact | base | local | remote | chosen |\n| --- | --- | --- | --- | --- | --- | --- |\n`
    : '';
  await appendFile(file, `${header}${rows}\n`, 'utf-8');
  logger.dim(
    `Recorded ${entries.length} auto-resolved status conflict(s) to ${path.relative(projectDir, file)}`,
  );
}

export function formatLinearStatusSyncLine(s: LinearStatusSyncSummary): string {
  return `${s.updated} pulled from Linear, ${s.pushedToLinear} pushed to Linear, ${s.unchanged} unchanged, ${s.conflictDecisions} conflict(s), ${s.unmapped} unmapped, ${s.skippedNoId} skipped (no linearIssueId), ${s.missingFromApi} not returned by API${s.pushFailures > 0 ? `, ${s.pushFailures} push failure(s)` : ''}`;
}

// ---------------------------------------------------------------------------
// Task checkbox sync — three-way merge between local TASK markdown and Linear issue body
// ---------------------------------------------------------------------------

export type TaskCheckboxConflictStrategy = 'prompt' | 'local' | 'linear';

export interface LinearTaskCheckboxSyncSummary {
  filesProcessed: number;
  filesUpdatedLocal: number;
  linearIssuesUpdated: number;
  /** Number of per-id decisions for divergent local vs Linear (includes non-interactive defaults). */
  conflictDecisions: number;
  skippedNoIssue: number;
  /** Artifacts whose `linearIssueId` frontmatter was present but malformed (H1). */
  skippedStaleId: number;
}

function toDoneMap(parsed: ParsedSubtask[]): Map<string, boolean> {
  return new Map(parsed.map((t) => [t.id, t.done]));
}

/**
 * Rebuild a `ParsedSubtask` list in document order: local file order, then any ids only in remote, then apply `final` done flags.
 */
export function mergeByIdForFormat(
  local: ParsedSubtask[],
  remote: ParsedSubtask[],
  final: ReadonlyMap<string, boolean>,
): ParsedSubtask[] {
  const fromLocal = new Map(local.map((t) => [t.id, t]));
  const out: ParsedSubtask[] = [];
  const used = new Set<string>();
  for (const t of local) {
    if (!final.has(t.id) || used.has(t.id)) continue;
    const d = final.get(t.id);
    if (d === undefined) continue;
    out.push({ ...t, done: d });
    used.add(t.id);
  }
  for (const t of remote) {
    if (used.has(t.id) || !final.has(t.id)) continue;
    const d = final.get(t.id);
    if (d === undefined) continue;
    out.push({ ...(fromLocal.get(t.id) ?? t), done: d });
    used.add(t.id);
  }
  return out;
}

/** Merged issue body: return text for an artifact’s section, or the whole body when a single file owns the issue. */
export function extractTaskSectionFromMergedDescription(
  merged: string,
  taskFileId: string,
  siblingFileCount: number,
): string {
  const token = `## ${taskFileId}`;
  if (siblingFileCount === 1) {
    if (!merged.includes('## ')) {
      return merged.trim();
    }
    if (merged.includes(token)) {
      return extractBlockAfterH2(merged, taskFileId);
    }
    return merged.trim();
  }
  if (merged.includes(token)) {
    return extractBlockAfterH2(merged, taskFileId);
  }
  if (merged.includes('## ')) {
    return '';
  }
  return merged.trim();
}

function extractBlockAfterH2(merged: string, taskFileId: string): string {
  const token = `## ${taskFileId}`;
  const idx = merged.indexOf(token);
  if (idx === -1) {
    return merged.trim();
  }
  const after = merged.slice(idx + token.length).replace(/^\n+/, '');
  const nextH2 = after.search(/^## /m);
  return (nextH2 === -1 ? after : after.slice(0, nextH2)).trim();
}

export function replaceTaskSectionInMergedDescription(
  merged: string,
  taskFileId: string,
  newSectionBody: string,
): string {
  if (!merged.includes('## ')) {
    return newSectionBody.trim();
  }
  const token = `## ${taskFileId}`;
  const idx = merged.indexOf(token);
  if (idx === -1) {
    return newSectionBody.trim();
  }
  const before = merged.slice(0, idx);
  const afterHeader = merged.slice(idx + token.length);
  const nextH2 = afterHeader.search(/^## /m);
  const tail = nextH2 === -1 ? '' : afterHeader.slice(nextH2);
  return `${before}${token}\n\n${newSectionBody.trim()}\n\n${tail}`.replace(/\n\n\n+/g, '\n\n');
}

export interface CheckboxConflict {
  id: string;
  base: boolean | undefined;
  local: boolean | undefined;
  remote: boolean | undefined;
}

/**
 * One auto-resolved conflict entry (M4). Captured when a non-interactive
 * default picks the Linear or local side so the user can review decisions
 * after the fact in `.planr/reports/linear-sync-conflicts-<date>.md`.
 */
export interface AutoResolvedConflict {
  label: string;
  id: string;
  base: boolean | undefined;
  local: boolean | undefined;
  remote: boolean | undefined;
  chosen: 'local' | 'linear';
  timestamp: string;
}

/**
 * Three-way merge for checkbox `id -> done` and presence. A key is **absent** in a version when the task line is not in that side’s parse.
 * Exported for unit tests.
 */
export async function resolveTaskCheckboxFinalStates(
  local: Map<string, boolean>,
  remote: Map<string, boolean>,
  base: Map<string, boolean>,
  strategy: TaskCheckboxConflictStrategy,
  label: string,
  onAutoResolve?: (entry: AutoResolvedConflict) => void,
): Promise<{ final: Map<string, boolean>; conflictDecisions: number }> {
  const ids = new Set([...local.keys(), ...remote.keys(), ...base.keys()]);
  const final = new Map<string, boolean>();
  let conflictDecisions = 0;

  for (const id of ids) {
    const lh = local.has(id);
    const rh = remote.has(id);
    const bh = base.has(id);
    const l = lh ? (local.get(id) as boolean) : undefined;
    const r = rh ? (remote.get(id) as boolean) : undefined;
    const b = bh ? (base.get(id) as boolean) : undefined;

    if (lh && rh && l === r) {
      if (l !== undefined) {
        final.set(id, l);
      }
      continue;
    }
    if (!lh && !rh) {
      continue;
    }
    if (b === l && l !== r) {
      if (r !== undefined) {
        final.set(id, r);
      }
      continue;
    }
    if (b === r && l !== r) {
      if (l !== undefined) {
        final.set(id, l);
      }
      continue;
    }
    if (bh && lh && !rh && l !== b && l !== undefined) {
      final.set(id, l);
      continue;
    }
    if (bh && rh && !lh && r !== b && r !== undefined) {
      final.set(id, r);
      continue;
    }
    if (!bh && l !== undefined && r === undefined) {
      final.set(id, l);
      continue;
    }
    if (!bh && r !== undefined && l === undefined) {
      final.set(id, r);
      continue;
    }

    const choice = await pickConflict(strategy, { id, base: b, local: l, remote: r }, label);
    if (l !== undefined && r !== undefined) {
      final.set(id, choice === 'local' ? l : r);
    } else if (l !== undefined) {
      final.set(id, l);
    } else if (r !== undefined) {
      final.set(id, r);
    }
    conflictDecisions++;
    // Record non-interactive auto-resolutions for the audit log. We
    // only record when strategy was 'prompt' AND we're non-interactive (i.e.
    // the default was picked without human input); explicit `--on-conflict
    // local|linear` choices are user intent, not silent defaults.
    if (onAutoResolve && strategy === 'prompt' && isNonInteractive()) {
      onAutoResolve({
        label,
        id,
        base: b,
        local: l,
        remote: r,
        chosen: choice,
        timestamp: new Date().toISOString(),
      });
    }
  }
  return { final, conflictDecisions };
}

async function pickConflict(
  strategy: TaskCheckboxConflictStrategy,
  c: CheckboxConflict,
  label: string,
): Promise<'local' | 'linear'> {
  if (strategy === 'local') {
    if (c.local === undefined) return 'linear';
    return 'local';
  }
  if (strategy === 'linear') {
    if (c.remote === undefined) return 'local';
    return 'linear';
  }
  if (isNonInteractive()) {
    logger.dim(
      `  [auto] ${label} task ${c.id} conflict: using Linear (set --on-conflict local|linear)`,
    );
    return c.remote !== undefined ? 'linear' : 'local';
  }
  const def: 'local' | 'linear' = c.remote !== undefined ? 'linear' : 'local';
  return promptSelect(
    `${label}: checkbox conflict on ${c.id} (base=${String(c.base)} local=${String(c.local)} remote=${String(c.remote)}). Use which side?`,
    [
      { name: 'Local file', value: 'local' as const },
      { name: 'Linear', value: 'linear' as const },
    ],
    def,
  );
}

const TASK_CHECKBOX = /^(\s*)- \[(x| )]\s+\*{0,2}(\d+\.\d+)\*{0,2}\s+(.+)$/;

/** Drop checkbox lines for ids that should be absent, apply done states, append new lines for ids in `rebuilt` that are still missing. */
export function applyCheckboxMergeToLocalBody(
  body: string,
  final: ReadonlyMap<string, boolean>,
  rebuilt: ParsedSubtask[],
): string {
  const lines: string[] = [];
  for (const line of body.split('\n')) {
    const m = line.match(TASK_CHECKBOX);
    if (m) {
      const id = m[3] as string;
      if (!final.has(id)) {
        continue;
      }
    }
    lines.push(line);
  }
  let out = lines.join('\n');
  out = applyTaskCheckboxStateMap(out, final);
  const present = new Set(parseTaskCheckboxLines(out).map((t) => t.id));
  const toAdd = rebuilt.filter((t) => final.has(t.id) && !present.has(t.id));
  if (toAdd.length === 0) {
    return out;
  }
  const block = formatTaskCheckboxBody(toAdd);
  if (!block) {
    return out;
  }
  const trimmed = out.trimEnd();
  return `${trimmed ? `${trimmed}\n\n` : ''}${block}\n`;
}

/**
 * For each `task` artifact with `linearIssueId`, load the shared Linear description (once per issue id),
 * reconcile checkboxes with the local file using three-way merge, then write back local and/or Linear.
 */
export async function runLinearTaskCheckboxSync(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  opts: { onConflict?: TaskCheckboxConflictStrategy; dryRun?: boolean } = {},
): Promise<LinearTaskCheckboxSyncSummary> {
  const onConflict: TaskCheckboxConflictStrategy = opts.onConflict ?? 'prompt';
  const dryRun = opts.dryRun === true;
  const summary: LinearTaskCheckboxSyncSummary = {
    filesProcessed: 0,
    filesUpdatedLocal: 0,
    linearIssuesUpdated: 0,
    conflictDecisions: 0,
    skippedNoIssue: 0,
    skippedStaleId: 0,
  };
  // Collect non-interactive auto-resolutions so we can audit them to
  // disk after the run (CI-friendly — logger.dim lines don't survive long).
  const autoResolvedConflicts: AutoResolvedConflict[] = [];

  const allTasks = await listArtifacts(projectDir, config, 'task');
  const byIssue = new Map<string, string[]>();
  for (const t of allTasks) {
    const a = await readArtifact(projectDir, config, 'task', t.id);
    const issueId = a?.data.linearIssueId as string | undefined;
    if (!issueId) {
      continue;
    }
    // Reject only values that don't match a valid Linear issue form
    // (UUID or `ENG-42` identifier). We deliberately do NOT pre-screen for
    // "looks like a workflow state UUID" — Linear issue ids and workflow-state
    // ids are both UUIDv4, so shape alone cannot distinguish them. Healthy
    // pushed issue ids are UUIDs and must pass through (BL-016).
    if (!isLikelyLinearIssueId(issueId)) {
      summary.skippedStaleId++;
      logger.warn(
        `Task ${t.id}: linearIssueId "${issueId}" is not a valid Linear issue id (expected uuid or \`ENG-42\` identifier). Re-run \`planr linear push\` to repair.`,
      );
      continue;
    }
    if (!byIssue.has(issueId)) {
      byIssue.set(issueId, []);
    }
    const group = byIssue.get(issueId);
    if (group) {
      group.push(t.id);
    }
  }

  for (const [issueId, taskIds] of byIssue) {
    let merged = await getLinearIssueDescription(client, issueId);
    const sortedFiles = [...taskIds].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    const siblingFileCount = sortedFiles.length;
    let issueDirty = false;

    for (const taskFileId of sortedFiles) {
      summary.filesProcessed++;
      const raw = await readArtifactRaw(projectDir, config, 'task', taskFileId);
      if (!raw) {
        continue;
      }
      const data = (await readArtifact(projectDir, config, 'task', taskFileId))?.data;
      const li = (data?.linearIssueId as string) ?? issueId;
      if (!li) {
        summary.skippedNoIssue++;
        continue;
      }

      const open = raw.indexOf('---');
      const close = raw.indexOf('\n---', open + 3);
      if (open === -1 || close === -1) {
        continue;
      }
      const body = raw.slice(close + 4);

      const localParsed = parseTaskMarkdown(body);
      const localMap = toDoneMap(localParsed);
      const section = extractTaskSectionFromMergedDescription(merged, taskFileId, siblingFileCount);
      const remoteParsed = parseTaskMarkdown(section);
      const remoteMap = toDoneMap(remoteParsed);

      const baseStr = (data?.linearChecklistReconciled as string) ?? undefined;
      const baseMap = parseTaskCheckboxReconciled(baseStr);

      // A baseline was persisted but parses to ~nothing: it's likely
      // corrupted (hand-edited frontmatter, truncated write, format drift).
      // Warn because without a reliable base the 3-way merge degrades
      // silently to a 2-way merge, losing the "last agreed" reference.
      if (typeof baseStr === 'string' && baseStr.trim().length > 0) {
        const expected = Math.max(localMap.size, remoteMap.size);
        if (expected > 0 && baseMap.size * 2 < expected) {
          logger.warn(
            `Task ${taskFileId}: linearChecklistReconciled looks corrupted (${baseMap.size} parsed vs ${expected} expected). Re-run \`planr linear push\` to restore the reconciliation baseline.`,
          );
        }
      }

      const { final, conflictDecisions: cd } = await resolveTaskCheckboxFinalStates(
        localMap,
        remoteMap,
        baseMap,
        onConflict,
        taskFileId,
        (entry) => autoResolvedConflicts.push(entry),
      );
      summary.conflictDecisions += cd;

      const rebuilt = mergeByIdForFormat(localParsed, remoteParsed, final);
      const newSection = formatTaskCheckboxBody(rebuilt);
      const newBody = applyCheckboxMergeToLocalBody(body, final, rebuilt);
      const merged2 = replaceTaskSectionInMergedDescription(merged, taskFileId, newSection);
      if (merged2 !== merged) {
        merged = merged2;
        issueDirty = true;
      }
      if (newBody !== body) {
        if (!dryRun) {
          const newRaw = raw.slice(0, close + 4) + newBody;
          await updateArtifact(projectDir, config, 'task', taskFileId, newRaw);
        }
        summary.filesUpdatedLocal++;
      }
      const newRecon = serializeTaskCheckboxReconciled(final);
      if (newRecon !== (baseStr ?? '')) {
        if (!dryRun) {
          await updateArtifactFields(projectDir, config, 'task', taskFileId, {
            linearChecklistReconciled: newRecon,
            linearTaskChecklistSyncedAt: new Date().toISOString(),
          });
        }
      }
    }

    if (issueDirty) {
      if (!dryRun) {
        await updateLinearIssue(client, issueId, { description: merged });
      }
      summary.linearIssuesUpdated++;
    }
  }

  // Persist any non-interactive auto-resolutions to a Markdown audit log.
  // Matches the filename convention used by revise's audit-log-service so users
  // find it in the same `.planr/reports/` directory they already look at.
  // Never mutates anything in dry-run mode.
  if (!dryRun && autoResolvedConflicts.length > 0) {
    await appendSyncConflictAudit(projectDir, autoResolvedConflicts);
  }

  return summary;
}

/**
 * Append a Markdown audit entry for non-interactive conflict auto-resolutions
 * (M4). File is created on first write per day at
 * `.planr/reports/linear-sync-conflicts-<YYYY-MM-DD>.md`. Appends preserve
 * prior entries across multiple `planr linear sync` runs on the same day.
 */
async function appendSyncConflictAudit(
  projectDir: string,
  entries: readonly AutoResolvedConflict[],
): Promise<void> {
  const { appendFile, mkdir } = await import('node:fs/promises');
  const path = await import('node:path');
  const { existsSync } = await import('node:fs');
  const today = new Date().toISOString().slice(0, 10);
  const dir = path.join(projectDir, '.planr', 'reports');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `linear-sync-conflicts-${today}.md`);
  const isNew = !existsSync(file);
  const fmtBool = (v: boolean | undefined): string => (v === undefined ? '—' : String(v));
  const rows = entries
    .map(
      (e) =>
        `| ${e.timestamp} | ${e.label} | ${e.id} | ${fmtBool(e.base)} | ${fmtBool(e.local)} | ${fmtBool(e.remote)} | ${e.chosen} |`,
    )
    .join('\n');
  const header = isNew
    ? `# Linear sync conflict audit — ${today}\n\n> Auto-resolved conflicts from non-interactive \`planr linear sync\` runs. Each row is one checkbox where local and Linear disagreed and the default resolution was picked without human confirmation.\n\n| timestamp | task file | task id | base | local | remote | chosen |\n| --- | --- | --- | --- | --- | --- | --- |\n`
    : '';
  await appendFile(file, `${header}${rows}\n`, 'utf-8');
  logger.dim(
    `Recorded ${entries.length} auto-resolved conflict(s) to ${path.relative(projectDir, file)}`,
  );
}
