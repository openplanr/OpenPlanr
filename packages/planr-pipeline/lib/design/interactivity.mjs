/**
 * Decide what `/planr-pipeline:design` does when the structural screen resolver
 * finds **0 screens** (a "thin" or non-structural spec — e.g. one organized as
 * functional requirements rather than a `## Screens` list).
 *
 * The original v0.13.0 behavior dead-ended: it aborted preflight and told the
 * user to re-run with `--from describe`. That defeats the whole point of the
 * interactive flow (SPEC-015's "ask, don't fabricate"). The correct rule:
 *
 *   - an **interactive** run ASKS the user how to source the screens (clarify)
 *   - only a **headless** run (both `--format` and `--from` supplied, and not
 *     the `describe` source) ABORTS, because it cannot prompt
 *   - `--from describe` always PROCEEDS (it derives screens from the brief)
 *
 * Pure, stdlib-only. (v0.13.1 — fix the thin-spec dead-end.)
 */

/**
 * A run is headless — i.e. the Phase B clarification is skipped — only when
 * BOTH the `--format` and `--from` flags are supplied (mirrors
 * design-step1-clarify B.0).
 *
 * @param {{ format?: string, from?: string }} [flags]
 * @returns {boolean}
 */
export function isHeadless({ format = '', from = '' } = {}) {
  return Boolean(format) && Boolean(from);
}

/**
 * @param {{ screenCount?: number, from?: string, format?: string }} [input]
 * @returns {{ action: 'proceed'|'clarify'|'abort', reason: string }}
 */
export function decideThinSpec({ screenCount = 0, from = '', format = '' } = {}) {
  const n = Number.isFinite(screenCount) ? screenCount : 0;
  if (n > 0) {
    return { action: 'proceed', reason: `${n} screen${n === 1 ? '' : 's'} resolved` };
  }
  if (from === 'describe') {
    return { action: 'proceed', reason: 'describe source derives screens from the brief' };
  }
  if (isHeadless({ format, from })) {
    return {
      action: 'abort',
      reason: 'no screens and headless (both flags set, source is not describe) — cannot prompt; pass --from describe',
    };
  }
  return {
    action: 'clarify',
    reason: 'no screens, interactive — ask how to source them instead of aborting',
  };
}
