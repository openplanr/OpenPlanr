import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { recordOperatingLastRunAt } from './config.js';
import { resolveOperatingPipelineRoot } from './protocol.js';
import { OperateError } from './types.js';
let cachedCadenceModule = null;
async function loadCadenceModule() {
    cachedCadenceModule ??= (async () => {
        const root = resolveOperatingPipelineRoot();
        if (!root) {
            throw new OperateError('E_PIPELINE_NOT_INSTALLED', 'Operating cadence status requires the planr-pipeline cadence calculator.');
        }
        const module = (await import(pathToFileURL(path.join(root, 'lib', 'operate', 'cadence.mjs')).href));
        if (typeof module.computeNextDueDate !== 'function' ||
            typeof module.assertCadenceCannotMutate !== 'function') {
            throw new OperateError('E_PIPELINE_NOT_INSTALLED', 'The installed pipeline does not expose the Protocol v1.3 cadence calculator.');
        }
        return module;
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
export async function computeNextDueAt(cadence, lastRunAt, clock) {
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
export async function recordOperatingCadenceRun(input) {
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
export async function assertOperatingCadenceCannotMutate() {
    return (await loadCadenceModule()).assertCadenceCannotMutate();
}
//# sourceMappingURL=cadence.js.map