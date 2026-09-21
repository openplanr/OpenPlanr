import { canonicalizeJson } from '../protocol/canonical-json.mjs';
import {
  assertDesignImplementationHandoff,
  assertDesignPlanningLineage,
} from '../protocol/design-handoff-contracts.mjs';

const clone = (value) => JSON.parse(canonicalizeJson(value));
const identityMatches = (left, right) => left && right
  && left.id === right.id && left.version === right.version && left.contentDigest === right.contentDigest;

/** Derive delivery state from canonical artifacts without changing approved package bytes. */
export function projectDesignDeliveryStatus({ handoff, currentHandoff, lineage = null, tasks = [], shipClosure = null } = {}) {
  assertDesignImplementationHandoff(handoff);
  const inputDigest = canonicalizeJson(handoff);
  if (lineage) assertDesignPlanningLineage(lineage);
  const taskIds = new Set(lineage?.mappings.flatMap(({ taskIds: ids }) => ids) ?? []);
  const relevantTasks = tasks.filter(({ id }) => taskIds.has(id));
  const blockedTasks = relevantTasks.filter(({ status }) => status === 'blocked').map(({ id }) => id);
  const stale = handoff.status !== 'approved'
    || (currentHandoff ? !identityMatches(currentHandoff, handoff) || currentHandoff.status !== 'approved' : false)
    || (lineage ? !identityMatches(lineage.handoff, handoff) : false);
  let phase = 'approved';
  if (lineage) phase = 'planned';
  if (lineage && (relevantTasks.some(({ status }) => ['in_progress', 'addressed'].includes(status))
    || (shipClosure && !['passed', 'blocked'].includes(shipClosure.state)))) phase = 'implementing';
  if (lineage && shipClosure?.state === 'passed'
    && relevantTasks.length > 0 && relevantTasks.every(({ status }) => status === 'done')) phase = 'verified';
  const blocked = blockedTasks.length > 0 || shipClosure?.state === 'blocked';
  const result = Object.freeze({
    kind: 'openplanr-design-delivery-status',
    schemaVersion: '1.0.0',
    designPackage: clone({ id: handoff.id, version: handoff.version, contentDigest: handoff.contentDigest }),
    phase,
    stale,
    blocked,
    detail: stale ? 'The approved design package no longer matches current planning context.'
      : blocked ? 'Delivery has a recorded blocker.'
        : phase === 'verified' ? 'The separate Ship workflow recorded a passing closure for every mapped task.'
          : phase === 'implementing' ? 'A separate Ship workflow is implementing mapped tasks.'
            : phase === 'planned' ? 'Plan recorded complete requirement lineage.'
              : 'The implementation handoff is approved and ready for a separate Plan invocation.',
    taskIds: [...taskIds].sort(),
    blockedTaskIds: blockedTasks.sort(),
    shipRunId: shipClosure?.runId ?? null,
  });
  if (canonicalizeJson(handoff) !== inputDigest) throw new TypeError('Delivery projection mutated the approved implementation handoff.');
  return result;
}
