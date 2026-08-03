import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { OperatingEventStore } from './event-store.js';
import { OPERATING_BOARD_ROLES } from './projection.js';
import { listAbandonedOperatingScratch } from './scratch.js';
import type { OperatingState } from './types.js';
import { type OperatingPaths, resolveOperatingPaths } from './workspace.js';

/**
 * FR14 (T-005): the explicit A→F completion phase tracker.
 *
 * PLAN has phases, canonical output paths, phase verification, and a strict
 * completion contract; Operate did not, and that asymmetry is the root cause the
 * spec names — the reproduction called `operate run` "done" while four completed
 * analyses sat in runtime-chosen temp files that were never recorded, rendered,
 * or persisted. This module answers, FROM ON-DISK STATE ALONE, which phase a
 * cycle has actually reached:
 *
 *   A  inspect / bootstrap
 *   B  cycle start and runtime binding
 *   C  dispatch and incremental recording
 *   D  Chair consolidation
 *   E  report / drafts materialization
 *   F  review gate and stop
 *
 * A successful `run`, a successful `harness prepare`, launched advisors, some
 * agents returning, or the mere existence of temporary result files never move
 * the tracker on their own: every phase is gated on the durable artifact the
 * phase is supposed to produce. Completion (phase F) requires the expected role
 * records and Markdown, the Chair result, the final report, the actions file,
 * draft/provenance results, a terminal cycle state (`reviewable|blocked|failed`),
 * no abandoned OpenPlanr-owned scratch, a correct runtime binding, and no
 * unauthorized effects — all verifiable on disk.
 */
export type OperatingCompletionPhase = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export const OPERATING_COMPLETION_PHASE_LABELS: Record<OperatingCompletionPhase, string> = {
  A: 'inspect/bootstrap',
  B: 'cycle start and runtime binding',
  C: 'dispatch and incremental recording',
  D: 'Chair consolidation',
  E: 'report/drafts materialization',
  F: 'review gate and stop',
};

const PHASE_ORDER: readonly OperatingCompletionPhase[] = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * A runtime binding value that names no runtime at all — a cycle carrying one of
 * these was never bound, which FR14 counts as an incomplete phase B. `auto` is
 * deliberately NOT here: the engine legitimately stamps `producer.runtime: 'auto'`
 * for a structured/offline cycle, so treating it as unbound would wrongly fail a
 * genuinely reviewable board. Only an absent or blank binding is a missing one;
 * the engine never emits the other tokens, so they only ever mark a corrupt
 * record.
 */
const PLACEHOLDER_RUNTIMES = new Set(['', 'unknown', 'unspecified', 'none', 'pending']);

export interface OperatingCompletionPhaseCheck {
  phase: OperatingCompletionPhase;
  label: string;
  /** True only when this phase's own preconditions AND every earlier phase are met. */
  met: boolean;
  /** The exact on-disk artifacts this phase still lacks. */
  missing: string[];
}

export interface OperatingCompletionResult {
  cycleId: string;
  /** Highest contiguous phase whose on-disk preconditions are verifiably met. */
  reachedPhase: OperatingCompletionPhase | null;
  reachedLabel: string;
  /** True only when the cycle has genuinely reached phase F on disk. */
  complete: boolean;
  /** The first phase not yet met, or null when complete. */
  nextPhase: OperatingCompletionPhase | null;
  nextLabel: string | null;
  /** The exact artifacts blocking `nextPhase`. */
  missing: string[];
  phases: OperatingCompletionPhaseCheck[];
}

interface BoardArtifact {
  present: boolean;
  evaluated: boolean;
}

function cycleField(cycle: Record<string, unknown> | undefined, key: string): unknown {
  return cycle ? cycle[key] : undefined;
}

/**
 * A cycle carries its runtime under `producer.runtime` (the manifest producer
 * envelope); tolerate a flat `runtime`/`runtimeBinding` too so a hand-built
 * fixture or an older manifest shape is still recognised. A placeholder value
 * ("auto"/"unknown"/…) is treated as no binding.
 */
function hasRuntimeBinding(cycle: Record<string, unknown> | undefined): boolean {
  const producer = cycleField(cycle, 'producer');
  const producerRuntime =
    producer && typeof producer === 'object' && !Array.isArray(producer)
      ? (producer as Record<string, unknown>).runtime
      : undefined;
  const candidates = [
    producerRuntime,
    cycleField(cycle, 'runtime'),
    cycleField(cycle, 'runtimeBinding'),
  ];
  return candidates.some(
    (value) =>
      typeof value === 'string' &&
      value.trim() !== '' &&
      !PLACEHOLDER_RUNTIMES.has(value.trim().toLowerCase()),
  );
}

/**
 * The roles whose board Markdown a completed cycle must carry: the roles the
 * cycle enabled (or all board roles when the cycle recorded no explicit
 * selection), with Chair always expected at the review gate.
 */
function expectedRoleIds(cycle: Record<string, unknown> | undefined): string[] {
  const enabled = cycleField(cycle, 'enabledRoles');
  const selected = Array.isArray(enabled)
    ? enabled.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const wanted = new Set<string>(
    selected.length > 0 ? selected : OPERATING_BOARD_ROLES.map((role) => role.id),
  );
  wanted.add('chair');
  return OPERATING_BOARD_ROLES.map((role) => role.id).filter((id) => wanted.has(id));
}

async function readBoardArtifact(file: string): Promise<BoardArtifact> {
  const content = await readFile(file, 'utf8').catch(() => null);
  if (content === null || content.trim() === '') return { present: false, evaluated: false };
  // Both the rich lens renderer (`Status: proposals|quiet|failed`) and the
  // honest state-only fallback (`Status: evaluated|not_evaluated`) emit a
  // column-0 `Status:` line; anything other than `not_evaluated` is a recorded
  // role. Content with no Status line is still a present, recorded board file.
  const match = content.match(/^Status:\s*(.+)$/m);
  const status = match?.[1]?.trim().toLowerCase();
  return { present: true, evaluated: status !== 'not_evaluated' };
}

async function fileHasContent(file: string): Promise<boolean> {
  const content = await readFile(file, 'utf8').catch(() => null);
  return content !== null && content.trim() !== '';
}

async function readReportJson(file: string): Promise<{ present: boolean; hasDrafts: boolean }> {
  const content = await readFile(file, 'utf8').catch(() => null);
  if (content === null || content.trim() === '') return { present: false, hasDrafts: false };
  try {
    const parsed = JSON.parse(content) as unknown;
    const hasDrafts =
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as Record<string, unknown>).drafts);
    return { present: true, hasDrafts };
  } catch {
    return { present: false, hasDrafts: false };
  }
}

/**
 * The governance kernel forbids an automatic run from approving a draft. A
 * materialized draft for this cycle that has already been approved is therefore
 * an unauthorized effect at the runtime-completed review gate (proposed and
 * discarded drafts are fine — a human may propose, review, and discard).
 */
async function unauthorizedDraftEffects(paths: OperatingPaths, cycleId: string): Promise<string[]> {
  const dir = path.join(paths.root, 'drafts');
  const names = await readdir(dir).catch(() => []);
  const violations: string[] = [];
  for (const name of names) {
    if (!/^DRAFT-[A-Za-z0-9._-]+\.json$/.test(name)) continue;
    const raw = await readFile(path.join(dir, name), 'utf8').catch(() => null);
    if (raw === null) continue;
    let parsed: { draft?: { draftId?: unknown; cycleId?: unknown; status?: unknown } };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      continue;
    }
    const draft = parsed.draft;
    if (draft && draft.cycleId === cycleId && draft.status === 'approved') {
      const id = typeof draft.draftId === 'string' ? draft.draftId : name;
      violations.push(`draft ${id} was approved without an explicit human decision`);
    }
  }
  return violations;
}

/**
 * Verify, from the committed state and the on-disk artifact tree alone, the
 * highest completion phase (A–F) a cycle has reached, plus the exact artifacts
 * blocking the next phase. `state` is the committed projection the caller already
 * replayed; every other precondition is read from `paths` on disk.
 */
export async function verifyOperatingCompletionPhases(
  state: OperatingState,
  cycleId: string,
  paths: OperatingPaths,
): Promise<OperatingCompletionResult> {
  const cycle = state.cycles.find((entry) => entry.id === cycleId);
  const cycleDir = path.join(paths.cycles, cycleId);
  const boardDir = path.join(cycleDir, 'board');

  const boards = new Map<string, BoardArtifact>();
  for (const role of OPERATING_BOARD_ROLES) {
    boards.set(role.id, await readBoardArtifact(path.join(boardDir, `${role.id}.md`)));
  }
  const reportMdPresent = await fileHasContent(path.join(cycleDir, 'report.md'));
  const actionsMdPresent = await fileHasContent(path.join(cycleDir, 'actions.md'));
  const reportJson = await readReportJson(path.join(cycleDir, 'report.json'));
  const abandoned = await listAbandonedOperatingScratch(paths).catch(() => []);
  const scratchAbandonedForCycle = abandoned.some((entry) => entry.cycleId === cycleId);
  const unauthorized = await unauthorizedDraftEffects(paths, cycleId);

  const advisoryRoles = OPERATING_BOARD_ROLES.filter((role) => role.id !== 'chair');
  const recordedAdvisory = advisoryRoles.filter((role) => boards.get(role.id)?.evaluated).length;
  const chair = boards.get('chair') ?? { present: false, evaluated: false };

  const phaseMissing: Record<OperatingCompletionPhase, string[]> = {
    A: [],
    B: [],
    C: [],
    D: [],
    E: [],
    F: [],
  };

  // A — inspect / bootstrap: the Operating Board exists for this project.
  if (!existsSync(paths.config)) {
    phaseMissing.A.push('Operating Board configuration (config.json)');
  }

  // B — cycle start and runtime binding: the cycle is committed and bound to a
  // concrete runtime, and the workspace identity that binds it is on disk.
  if (!cycle) phaseMissing.B.push(`committed cycle record for ${cycleId}`);
  if (!existsSync(paths.workspace)) {
    phaseMissing.B.push('runtime/workspace binding (workspace.json)');
  }
  if (cycle && !hasRuntimeBinding(cycle)) {
    phaseMissing.B.push(`runtime binding on cycle ${cycleId} (producer.runtime)`);
  }

  // C — dispatch and incremental recording: at least one advisor lens has been
  // durably recorded and its Markdown materialized (the exact thing the
  // reproduction lost). A launched-but-unrecorded advisor never satisfies this.
  if (recordedAdvisory === 0) {
    phaseMissing.C.push(
      `at least one recorded advisor lens (no cycles/${cycleId}/board/<role>.md is recorded)`,
    );
  }

  // D — Chair consolidation: the Chair result is recorded and materialized.
  if (!chair.evaluated) {
    phaseMissing.D.push(`Chair consolidation result (cycles/${cycleId}/board/chair.md)`);
  }

  // E — report / drafts materialization: the final report, its machine sidecar
  // (which carries the draft/provenance results), and the proposed-actions file.
  if (!reportMdPresent) phaseMissing.E.push(`final report (cycles/${cycleId}/report.md)`);
  if (!reportJson.present) {
    phaseMissing.E.push(`report sidecar (cycles/${cycleId}/report.json)`);
  } else if (!reportJson.hasDrafts) {
    phaseMissing.E.push(`draft/provenance results in cycles/${cycleId}/report.json`);
  }
  if (!actionsMdPresent)
    phaseMissing.E.push(`proposed actions file (cycles/${cycleId}/actions.md)`);

  // F — review gate and stop: a terminal cycle state, the full board Markdown for
  // every expected role, no abandoned OpenPlanr-owned scratch, and no
  // unauthorized effect taken automatically.
  const terminalStates = new Set(['reviewable', 'blocked', 'failed']);
  const currentState = cycle ? String(cycle.state) : 'absent';
  if (!terminalStates.has(currentState)) {
    phaseMissing.F.push(
      `terminal cycle state reviewable|blocked|failed (current: ${currentState})`,
    );
  }
  for (const roleId of expectedRoleIds(cycle)) {
    if (!boards.get(roleId)?.present) {
      phaseMissing.F.push(`board Markdown for ${roleId} (cycles/${cycleId}/board/${roleId}.md)`);
    }
  }
  if (scratchAbandonedForCycle) {
    phaseMissing.F.push(`abandoned OpenPlanr-owned scratch for ${cycleId} must be cleaned`);
  }
  for (const violation of unauthorized) {
    phaseMissing.F.push(`unauthorized effect: ${violation}`);
  }

  const phases: OperatingCompletionPhaseCheck[] = [];
  let reached: OperatingCompletionPhase | null = null;
  let firstUnmet: { phase: OperatingCompletionPhase; missing: string[] } | null = null;
  let priorMet: boolean = true;
  for (const phase of PHASE_ORDER) {
    const missing = phaseMissing[phase];
    const met: boolean = priorMet && missing.length === 0;
    phases.push({ phase, label: OPERATING_COMPLETION_PHASE_LABELS[phase], met, missing });
    if (met) reached = phase;
    else if (!firstUnmet) firstUnmet = { phase, missing };
    priorMet = met;
  }

  const complete = reached === 'F';
  return {
    cycleId,
    reachedPhase: reached,
    reachedLabel: reached ? OPERATING_COMPLETION_PHASE_LABELS[reached] : 'not started',
    complete,
    nextPhase: complete ? null : (firstUnmet?.phase ?? null),
    nextLabel: complete || !firstUnmet ? null : OPERATING_COMPLETION_PHASE_LABELS[firstUnmet.phase],
    missing: complete ? [] : (firstUnmet?.missing ?? []),
    phases,
  };
}

/**
 * Convenience wrapper for callers that hold only a project root: replay the
 * committed state, resolve paths, and verify the requested (or current) cycle.
 * Returns null when there is no committed cycle to verify.
 */
export async function inspectOperatingCompletion(input: {
  projectRoot: string;
  cycleId?: string;
  localRoot?: string;
}): Promise<OperatingCompletionResult | null> {
  const options = input.localRoot ? { localRoot: input.localRoot } : {};
  const paths = resolveOperatingPaths(input.projectRoot, options);
  const state = await new OperatingEventStore(input.projectRoot, options).state();
  const cycleId = input.cycleId ?? state.summary.currentCycleId ?? undefined;
  if (!cycleId || !state.cycles.some((cycle) => cycle.id === cycleId)) return null;
  return verifyOperatingCompletionPhases(state, cycleId, paths);
}

/**
 * The human notice `operate review` prints before the report when a cycle has
 * NOT genuinely reached the review gate: it names the on-disk-verified phase,
 * the next required phase, and the exact missing artifacts — so the CLI, not the
 * orchestrating model, is authoritative on whether the review gate was reached.
 * Returns no lines for a complete cycle. Deliberately carries none of the
 * internal transport vocabulary (lease, idempotency key, evidence digest,
 * harness/adapter commands).
 */
export function renderOperatingReviewGateNotice(result: OperatingCompletionResult): string[] {
  if (result.complete) return [];
  const lines = [
    `Cycle ${result.cycleId} has not reached the review gate (phase F — ${OPERATING_COMPLETION_PHASE_LABELS.F}).`,
    `  Verified on disk: reached phase ${result.reachedPhase ?? 'none'}${
      result.reachedPhase ? ` (${result.reachedLabel})` : ''
    }.`,
  ];
  if (result.nextPhase) {
    lines.push(`  Next required phase: ${result.nextPhase} — ${result.nextLabel}.`);
    if (result.missing.length > 0) {
      lines.push('  Missing before that phase:');
      for (const item of result.missing) lines.push(`    - ${item}`);
    }
  }
  lines.push(
    '  Completion is verified from on-disk artifacts, not from a successful run or launched advisors.',
  );
  return lines;
}
