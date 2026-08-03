import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { recordOperatingLastRunAt } from './config.js';
import { resolveOperatingPipelineRoot } from './protocol.js';
import { OperateError, type OperatingConfig } from './types.js';

/**
 * Cadence state (FR8 / E-008).
 *
 * This module is the engine-side seam onto the pipeline's PURE cadence calculator
 * (`planr-pipeline@0.33.0` → `lib/operate/cadence.mjs`, validated against
 * `operating-cadence-status@1.3.0`). The calendar math is never reimplemented
 * here; this file only:
 *
 *  1. loads and caches the published calculator, and
 *  2. surfaces the next-due instant with an INJECTED clock — the calculator has
 *     no `Date.now()` on its path, so `operate status` stays deterministic under
 *     test — and
 *  3. records the machine-local `lastRunAt` marker at cycle completion, delegating
 *     the atomic preferences write to the preferences owner (`config.ts`).
 *
 * There is no code path here — and, structurally, none in the calculator — that
 * can accept a finding, apply a route, invoke PLAN, or invoke SHIP: the calculator
 * takes only `(cadence, lastRunAt, now)`, so no caller can request an action. See
 * `assertOperatingCadenceCannotMutate`.
 */

export type OperatingCadence = OperatingConfig['cadence'];

interface OperatingCadenceStatus {
  kind: 'operating-cadence-status';
  cadence: OperatingCadence;
  lastRunAt: string | null;
  nextDueAt: string | null;
}

interface PipelineCadenceModule {
  computeNextDueDate(
    cadence: string,
    lastRunAt: string | null,
    now: string,
  ): OperatingCadenceStatus;
  assertCadenceCannotMutate(): boolean;
}

let cachedCadenceModule: Promise<PipelineCadenceModule> | null = null;

async function loadCadenceModule(): Promise<PipelineCadenceModule> {
  cachedCadenceModule ??= (async () => {
    const root = resolveOperatingPipelineRoot();
    if (!root) {
      throw new OperateError(
        'E_PIPELINE_NOT_INSTALLED',
        'Operating cadence status requires the planr-pipeline cadence calculator.',
      );
    }
    const module = (await import(
      pathToFileURL(path.join(root, 'lib', 'operate', 'cadence.mjs')).href
    )) as unknown as Partial<PipelineCadenceModule>;
    if (
      typeof module.computeNextDueDate !== 'function' ||
      typeof module.assertCadenceCannotMutate !== 'function'
    ) {
      throw new OperateError(
        'E_PIPELINE_NOT_INSTALLED',
        'The installed pipeline does not expose the Protocol v1.3 cadence calculator.',
      );
    }
    return module as PipelineCadenceModule;
  })();
  return cachedCadenceModule;
}

/**
 * Compute the surfaced next-due instant for a cadence via the pipeline's pure
 * calculator (FR8 / E-008). `clock` is the injected `now` supplied by the CLI
 * boundary — the computation reads no wall clock. `manual` yields `null`;
 * `weekly` / `monthly` yield the calculator's RFC 3339 UTC instant (due
 * immediately when `lastRunAt` is absent).
 */
export async function computeNextDueAt(
  cadence: OperatingCadence,
  lastRunAt: string | null,
  clock: string,
): Promise<string | null> {
  const module = await loadCadenceModule();
  return module.computeNextDueDate(cadence, lastRunAt, clock).nextDueAt;
}

/**
 * Record the cadence `lastRunAt` marker when a cycle reaches a terminal
 * reviewable/blocked/closed state (FR8 / E-008). Delegates the atomic
 * machine-local preferences write to `config.ts`, keeping cadence policy in one
 * module while persistence stays with the preferences owner. `runAt` is the
 * injected cycle instant (RFC 3339 UTC), never a wall-clock read here.
 */
export async function recordOperatingCadenceRun(input: {
  projectRoot: string;
  localRoot?: string;
  runAt: string;
}): Promise<void> {
  await recordOperatingLastRunAt({
    projectRoot: input.projectRoot,
    localRoot: input.localRoot,
    lastRunAt: input.runAt,
  });
}

/**
 * FR8 never-acts anchor. Re-exposes the pipeline's structural guarantee that the
 * cadence path cannot accept a finding, apply a route, or invoke PLAN/SHIP. The
 * guarantee is the SHAPE of `computeNextDueAt` (no action parameter exists);
 * this returns `true` purely as an explicit review anchor.
 */
export async function assertOperatingCadenceCannotMutate(): Promise<boolean> {
  return (await loadCadenceModule()).assertCadenceCannotMutate();
}
