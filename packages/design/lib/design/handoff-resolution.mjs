import { canonicalizeJson, sha256Hex } from '@openplanr/protocol/canonical-json';

const OUTCOMES = new Set(['accepted', 'open', 'blocking', 'deferred', 'declined']);
const CATEGORIES = new Set(['question', 'suggestion', 'change-request', 'blocker']);
const DISPOSITIONS = new Set(['accepted', 'deferred', 'rejected', 'declined']);
const MAX_COMMENTS = 10_000;
const MAX_ISSUES = 10_000;
const digestPattern = /^[a-f0-9]{64}$/u;

const revisionOf = (pin) => pin.revisionId ?? pin.reviewId;
const keyOf = (pin) => `${revisionOf(pin)}:${pin.id}`;
const compare = (left, right) => left.localeCompare(right, 'en');

function assertPlainData(value, depth = 0, seen = new Set()) {
  if (depth > 64) throw new TypeError('Review resolution data exceeds the maximum nesting depth.');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || seen.has(value))
    throw new TypeError('Review resolution data must be finite, acyclic JSON.');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Review resolution data must contain only plain JSON objects.');
  seen.add(value);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (
      ['__proto__', 'prototype', 'constructor'].includes(key) ||
      !Object.hasOwn(descriptor, 'value')
    )
      throw new TypeError('Review resolution data contains a forbidden property.');
    assertPlainData(descriptor.value, depth + 1, seen);
  }
  seen.delete(value);
}

const clone = (value) => {
  assertPlainData(value);
  return JSON.parse(canonicalizeJson(value));
};

function issue(code, severity, message, { pinId, revisionId, recoveryAction } = {}) {
  return {
    code,
    severity,
    message,
    ...(revisionId ? { revisionId } : {}),
    ...(pinId ? { pinId } : {}),
    recoveryAction: recoveryAction ?? {
      id: 'refresh-review-resolution',
      label: 'Refresh review decisions',
    },
  };
}

function validatePin(pin) {
  if (!pin || typeof pin !== 'object' || Array.isArray(pin))
    throw new TypeError('Every review comment must be an object.');
  if (typeof pin.id !== 'string' || !pin.id || pin.id.length > 160)
    throw new TypeError('Every review comment requires a stable identity.');
  const revisionId = revisionOf(pin);
  if (typeof revisionId !== 'string' || !revisionId || revisionId.length > 160)
    throw new TypeError('Every review comment requires its original revision identity.');
  if (typeof pin.reviewOf !== 'string' || !digestPattern.test(pin.reviewOf))
    throw new TypeError('Every review comment requires its original review basis.');
  if (pin.screenId !== undefined && (typeof pin.screenId !== 'string' || !pin.screenId))
    throw new TypeError('Review screen references must be stable identities.');
  if (
    pin.elementId !== undefined &&
    (typeof pin.elementId !== 'string' || !pin.elementId || !pin.screenId)
  )
    throw new TypeError('Review element references require a stable screen identity.');
}

function scopedMetadata(metadata, pin, duplicatePinIds, diagnostics) {
  const revisionId = revisionOf(pin);
  const scoped = metadata.byRevision?.[revisionId] ?? {};
  let category = scoped.categories?.[pin.id];
  let disposition = scoped.dispositions?.[pin.id];
  if (category === undefined && Object.hasOwn(metadata.categories ?? {}, pin.id)) {
    if (duplicatePinIds.has(pin.id))
      diagnostics.push(
        issue(
          'AMBIGUOUS_LEGACY_CATEGORY',
          'blocked',
          'A legacy category cannot be matched to one original revision.',
          { pinId: pin.id, revisionId },
        ),
      );
    else category = metadata.categories[pin.id];
  }
  if (disposition === undefined && Object.hasOwn(metadata.dispositions ?? {}, pin.id)) {
    if (duplicatePinIds.has(pin.id))
      diagnostics.push(
        issue(
          'AMBIGUOUS_LEGACY_DISPOSITION',
          'blocked',
          'A legacy owner decision cannot be matched to one original revision.',
          { pinId: pin.id, revisionId },
        ),
      );
    else disposition = metadata.dispositions[pin.id];
  }
  if (category !== undefined && !CATEGORIES.has(category)) {
    diagnostics.push(
      issue('UNKNOWN_CATEGORY', 'blocked', 'The comment category is not supported.', {
        pinId: pin.id,
        revisionId,
      }),
    );
    category = undefined;
  }
  const dispositionValue = typeof disposition === 'string' ? disposition : disposition?.disposition;
  if (dispositionValue !== undefined && !DISPOSITIONS.has(dispositionValue)) {
    diagnostics.push(
      issue('UNKNOWN_DISPOSITION', 'blocked', 'The owner decision is not supported.', {
        pinId: pin.id,
        revisionId,
      }),
    );
    disposition = undefined;
  }
  return {
    category,
    disposition,
    dispositionValue: typeof disposition === 'string' ? disposition : disposition?.disposition,
  };
}

function unknownMetadata(metadata, known, diagnostics) {
  for (const [revisionId, value] of Object.entries(metadata.byRevision ?? {}).sort(
    ([left], [right]) => compare(left, right),
  )) {
    for (const field of ['categories', 'dispositions']) {
      for (const pinId of Object.keys(value?.[field] ?? {}).sort(compare)) {
        if (!known.has(`${revisionId}:${pinId}`))
          diagnostics.push(
            issue(
              'UNKNOWN_COMMENT_METADATA',
              'blocked',
              'Review metadata targets a comment that is not present in the recorded review history.',
              { revisionId, pinId },
            ),
          );
      }
    }
  }
}

/**
 * Compile the closed, deterministic owner-decision projection used by handoff
 * drafting and readiness. Review text remains evidence; only explicit metadata
 * can accept, defer, or decline implementation work.
 */
export function compileDesignHandoffResolution(input) {
  const source = clone(input ?? {});
  const pins = Array.isArray(source.pins) ? source.pins : [];
  if (pins.length > MAX_COMMENTS)
    throw new RangeError('Review resolution exceeds the comment limit.');
  const metadata =
    source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
      ? source.metadata
      : {};
  const diagnostics = [];
  const counts = new Map();
  for (const pin of pins) {
    validatePin(pin);
    counts.set(pin.id, (counts.get(pin.id) ?? 0) + 1);
  }
  const duplicatePinIds = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
  const known = new Set();
  for (const pin of pins) {
    const key = keyOf(pin);
    if (known.has(key)) throw new TypeError(`Duplicate review comment identity: ${key}.`);
    known.add(key);
  }
  unknownMetadata(metadata, known, diagnostics);

  const items = [...pins]
    .sort((left, right) => compare(keyOf(left), keyOf(right)))
    .map((pin) => {
      const revisionId = revisionOf(pin);
      const current =
        pin.stale !== true && (!source.currentReviewOf || pin.reviewOf === source.currentReviewOf);
      const resolved = scopedMetadata(metadata, pin, duplicatePinIds, diagnostics);
      let outcome;
      if (resolved.dispositionValue === 'accepted') outcome = 'accepted';
      else if (resolved.dispositionValue === 'deferred') outcome = 'deferred';
      else if (['rejected', 'declined'].includes(resolved.dispositionValue)) outcome = 'declined';
      else if (['blocker', 'change-request'].includes(resolved.category)) outcome = 'blocking';
      else outcome = 'open';
      if (!OUTCOMES.has(outcome)) throw new Error('Review resolution produced an invalid outcome.');
      if (!current && outcome === 'accepted')
        diagnostics.push(
          issue(
            'STALE_ACCEPTED_DECISION',
            'stale',
            'An accepted change belongs to an earlier design revision and must be reviewed again.',
            {
              pinId: pin.id,
              revisionId,
              recoveryAction: {
                id: 'review-stale-decision',
                label: 'Review this decision against the current design',
              },
            },
          ),
        );
      if (current && outcome === 'blocking')
        diagnostics.push(
          issue(
            'UNRESOLVED_BLOCKING_COMMENT',
            'blocked',
            'A blocking comment still needs an owner decision.',
            {
              pinId: pin.id,
              revisionId,
              recoveryAction: {
                id: 'resolve-blocking-comment',
                label: 'Record the owner decision',
              },
            },
          ),
        );
      return {
        id: keyOf(pin),
        pinId: pin.id,
        reviewId: pin.reviewId,
        revisionId,
        reviewOf: pin.reviewOf,
        current,
        category: resolved.category ?? 'question',
        outcome,
        implementationScope: current && outcome === 'accepted',
        anchor: pin.elementId
          ? { screenId: pin.screenId, elementId: pin.elementId }
          : pin.screenId
            ? { screenId: pin.screenId }
            : pin.anchor?.planrId
              ? { planrId: pin.anchor.planrId }
              : { artifactId: pin.artifactId },
        source: {
          text: pin.comment,
          author: clone(pin.author),
          status: pin.status,
          ...(resolved.disposition && typeof resolved.disposition === 'object'
            ? { decision: clone(resolved.disposition) }
            : {}),
        },
      };
    });

  if (source.historyComplete === false)
    diagnostics.push(
      issue('INCOMPLETE_REVIEW_HISTORY', 'blocked', 'The complete review history is unavailable.', {
        recoveryAction: {
          id: 'restore-review-history',
          label: 'Restore the complete review history',
        },
      }),
    );
  if (source.synchronizationPending === true)
    diagnostics.push(
      issue(
        'SYNCHRONIZATION_PENDING',
        'blocked',
        'A review decision is still waiting to synchronize.',
        {
          recoveryAction: {
            id: 'retry-review-sync',
            label: 'Retry review synchronization',
          },
        },
      ),
    );
  for (const value of (source.synchronizationIssues ?? []).slice(0, MAX_ISSUES))
    diagnostics.push(
      issue(
        'UNTRUSTED_HOSTED_FEEDBACK',
        'blocked',
        value?.reason || 'Hosted feedback could not be validated.',
        {
          pinId: value?.pinId,
          revisionId: value?.revisionId,
          recoveryAction: {
            id: 'inspect-review-sync',
            label: 'Inspect the rejected hosted feedback',
          },
        },
      ),
    );
  if ((source.synchronizationIssues ?? []).length > MAX_ISSUES)
    throw new RangeError('Review resolution exceeds the synchronization issue limit.');

  diagnostics.sort((left, right) =>
    compare(
      `${left.code}:${left.revisionId ?? ''}:${left.pinId ?? ''}:${left.message}`,
      `${right.code}:${right.revisionId ?? ''}:${right.pinId ?? ''}:${right.message}`,
    ),
  );
  const severity = new Set(diagnostics.map((value) => value.severity));
  const status = severity.has('stale')
    ? 'stale'
    : severity.has('blocked')
      ? 'blocked'
      : items.some((item) => item.outcome === 'open')
        ? 'attention'
        : 'ready';
  return {
    kind: 'openplanr-design-handoff-resolution',
    schemaVersion: '1.0.0',
    currentReviewOf: source.currentReviewOf ?? null,
    status,
    complete: source.historyComplete !== false && !['blocked', 'stale'].includes(status),
    items,
    implementationScope: items.filter((item) => item.implementationScope).map((item) => item.id),
    diagnostics,
  };
}

export function designHandoffResolutionDigest(value) {
  return `sha256:${sha256Hex(canonicalizeJson(value))}`;
}

export function canApproveDesignHandoffResolution(value) {
  return Boolean(value?.complete && ['ready', 'attention'].includes(value.status));
}
