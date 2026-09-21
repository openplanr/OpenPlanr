import { canonicalizeJson } from '../protocol/canonical-json.mjs';
import { assertDesignImplementationHandoff } from '../protocol/design-handoff-contracts.mjs';

const clone = (value) => JSON.parse(canonicalizeJson(value));

/**
 * Prepare an explicit host handoff. This projection is pure: it does not invoke Plan,
 * write planning files, dispatch an agent, touch Git, or start Ship.
 */
export function prepareDesignPlanHandoff(handoff, { subject } = {}) {
  assertDesignImplementationHandoff(handoff);
  if (handoff.status !== 'approved') throw new TypeError('Continue to Plan requires an approved implementation handoff.');
  const target = String(subject ?? handoff.basis.designId).trim();
  if (!target || /[\r\n]/u.test(target)) throw new TypeError('Plan subject must be one non-empty line.');
  return Object.freeze({
    kind: 'openplanr-design-plan-handoff',
    schemaVersion: '1.0.0',
    authority: 'prepare-plan',
    handoff: clone({ id: handoff.id, version: handoff.version, contentDigest: handoff.contentDigest }),
    subject: target,
    invocations: Object.freeze({
      claudeCode: `/planr:plan ${target}`,
      codex: `$planr:plan ${target}`,
      chatgpt: `$planr:plan ${target}`,
      cursor: `$planr:plan ${target}`,
      fallback: `$planr:plan ${target}`,
    }),
    effects: Object.freeze({ planningFilesWritten: false, agentDispatched: false, shipStarted: false, gitChanged: false }),
  });
}
