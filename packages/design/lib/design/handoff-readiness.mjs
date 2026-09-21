import { canonicalizeJson, sha256Hex } from '@openplanr/protocol/canonical-json';
import {
  assertDesignHandoffReadiness,
  isDesignHandoffRelativePath,
} from '@openplanr/protocol/design-handoff-contracts';

const CHECKS = Object.freeze([
  'current-revision',
  'selected-direction',
  'design-specification',
  'rendered-verification',
  'review-freshness',
  'review-dispositions',
  'unresolved-blockers',
  'approved-review-handoff',
]);

const action = Object.freeze({
  'current-revision': Object.freeze({ id: 'render-design', label: 'Render the current design' }),
  'selected-direction': Object.freeze({ id: 'select-direction', label: 'Choose one ready direction' }),
  'design-specification': Object.freeze({ id: 'complete-design-specification', label: 'Complete the design specification' }),
  'rendered-verification': Object.freeze({ id: 'verify-rendered-design', label: 'Verify the rendered design' }),
  'review-freshness': Object.freeze({ id: 'refresh-review', label: 'Refresh review against the current design' }),
  'review-dispositions': Object.freeze({ id: 'resolve-review-decisions', label: 'Record the remaining review decisions' }),
  'unresolved-blockers': Object.freeze({ id: 'resolve-review-blockers', label: 'Resolve the blocking feedback' }),
  'approved-review-handoff': Object.freeze({ id: 'approve-review-handoff', label: 'Prepare and approve the current review handoff' }),
});

const message = Object.freeze({
  'current-revision': Object.freeze({
    pass: 'The current design has a completed render.',
    blocked: 'Render the design before preparing work for engineering.',
  }),
  'selected-direction': Object.freeze({
    pass: 'One ready design direction is selected.',
    blocked: 'Choose one ready design direction before continuing.',
    stale: 'The selected direction changed after the review handoff was prepared.',
  }),
  'design-specification': Object.freeze({
    pass: 'The design specification is complete for this revision.',
    blocked: 'Complete the design specification before continuing.',
    stale: 'The design specification belongs to an earlier revision.',
  }),
  'rendered-verification': Object.freeze({
    pass: 'The rendered design is verified for this revision.',
    blocked: 'Complete rendered design verification before continuing.',
    stale: 'Rendered verification belongs to an earlier revision.',
  }),
  'review-freshness': Object.freeze({
    pass: 'Review feedback is current for this revision.',
    blocked: 'Review feedback contains ambiguous identities or anchors.',
    stale: 'Review feedback belongs to an earlier revision.',
  }),
  'review-dispositions': Object.freeze({
    pass: 'Every current review comment has a recorded outcome.',
    attention: 'Some non-blocking review comments still need an owner decision.',
    blocked: 'Review decisions are incomplete or ambiguous.',
  }),
  'unresolved-blockers': Object.freeze({
    pass: 'No blocking feedback remains open.',
    blocked: 'Blocking feedback must be resolved before continuing.',
    stale: 'A prior decision must be reviewed against the current design.',
  }),
  'approved-review-handoff': Object.freeze({
    pass: 'The current review handoff is approved.',
    blocked: 'Prepare and approve the review handoff before continuing.',
    stale: 'The approved review handoff no longer matches the current design.',
  }),
});

const priority = Object.freeze({ pass: 0, attention: 1, blocked: 2, stale: 3 });
const digestPattern = /^(?:sha256:)?[a-f0-9]{64}$/u;
const normalizeDigest = (value, label) => {
  if (typeof value !== 'string' || !digestPattern.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256 value.`);
  return value.startsWith('sha256:') ? value : `sha256:${value}`;
};
const optionalDigest = (value, label) => value === undefined || value === null ? undefined : normalizeDigest(value, label);
const plainClone = value => value === undefined ? undefined : JSON.parse(canonicalizeJson(value));
const logicalPath = (value, fallback, label) => {
  const result = value ?? fallback;
  if (!isDesignHandoffRelativePath(result) || /[?#%]/u.test(result)) throw new TypeError(`${label} must be a repository-relative logical path.`);
  return result;
};
const evidenceDigest = value => `sha256:${sha256Hex(canonicalizeJson(value))}`;

function ensureUnique(items, select, label) {
  const values = items.map(select);
  if (new Set(values).size !== values.length) throw new TypeError(`Duplicate ${label}.`);
}

function evidence(id, kind, path, value, { revision, anchor } = {}) {
  return {
    id,
    kind,
    path,
    ...(revision ? { revision: normalizeDigest(revision, `${id} revision`) } : {}),
    digest: optionalDigest(value?.digest, `${id} integrity`) ?? evidenceDigest(value),
    ...(anchor ? { anchor } : {}),
  };
}

function checked(id, status, evidenceRefs = []) {
  return {
    id,
    status,
    message: message[id][status],
    evidenceRefs,
    ...(status === 'pass' ? {} : { recoveryAction: action[id] }),
  };
}

function selectedDirection(document, studioState) {
  const selected = studioState?.selectedVariant ?? document?.selectedVariant ?? null;
  const variants = Array.isArray(document?.variants) ? document.variants : [];
  ensureUnique(variants, item => item?.id, 'design direction identity');
  const matches = variants.filter(item => item?.id === selected && item?.status === 'ready');
  return { selected, ready: matches.length === 1 };
}

function normalizedPins(review, revision) {
  const pins = Array.isArray(review?.pins) ? review.pins.map(pin => ({ ...pin })) : [];
  ensureUnique(pins, pin => `${pin.revisionId ?? pin.reviewId ?? ''}:${pin.id ?? ''}`, 'review comment identity');
  for (const pin of pins) {
    if (typeof pin.id !== 'string' || !pin.id) throw new TypeError('Review comments require stable identities.');
    if (pin.elementId && !pin.screenId) throw new TypeError('An element review anchor must identify its screen.');
    if (pin.anchorCount !== undefined && pin.anchorCount !== 1) throw new TypeError('Review comments must identify exactly one anchor.');
  }
  return pins.sort((left, right) => `${left.revisionId ?? left.reviewId}:${left.id}`.localeCompare(`${right.revisionId ?? right.reviewId}:${right.id}`)).map(pin => ({
    ...pin,
    current: !pin.stale && (!revision || !pin.revisionId || normalizeDigest(pin.revisionId, 'review revision') === revision),
  }));
}

function reviewState(input, revision) {
  if (!input) return { pins: [], stale: false, ambiguous: false };
  const pins = normalizedPins(input, revision);
  const recordedRevision = optionalDigest(input.revision, 'review revision');
  return {
    pins,
    stale: input.current === false || (recordedRevision !== undefined && recordedRevision !== revision) || pins.some(pin => !pin.current),
    ambiguous: input.ambiguous === true,
  };
}

function handoffState(handoff, designId, revision, selectedVariant) {
  if (!handoff) return 'blocked';
  if (handoff.status !== 'approved' || !handoff.approval || handoff.approval.contentHash !== handoff.contentHash) return 'blocked';
  const basisRevision = optionalDigest(handoff.basis?.sourceRevision, 'review handoff revision');
  if (handoff.current === false || handoff.basis?.designId !== designId || basisRevision !== revision || handoff.basis?.selectedVariant !== selectedVariant) return 'stale';
  return 'pass';
}

/**
 * Compile a deterministic, side-effect-free readiness projection from canonical
 * in-memory design and review evidence. Callers own file loading and custody.
 */
export function compileDesignHandoffReadiness(input) {
  if (input === null || input === undefined) return designHandoffReadinessAbsence();
  const source = plainClone(input);
  const document = source.document;
  if (!document || document.kind !== 'openplanr-design-document' || document.schemaVersion !== '1.0.0' || typeof document.id !== 'string' || !document.id) throw new TypeError('Readiness requires one supported design document.');

  const revision = source.sourceRevision === null || source.sourceRevision === undefined
    ? null
    : normalizeDigest(source.sourceRevision, 'design revision');
  const direction = selectedDirection(document, source.studioState);
  const evidenceItems = [];
  if (revision) evidenceItems.push(evidence('design-revision', 'design-revision', logicalPath(source.documentPath, 'design-document.json', 'design document path'), document, { revision }));

  const directionEvidence = direction.selected && revision ? evidence(
    'selected-direction',
    'selected-direction',
    logicalPath(source.studioStatePath, '.design/studio-state.json', 'Studio state path'),
    { selectedVariant: direction.selected },
    { revision, anchor: { section: direction.selected } },
  ) : null;
  if (directionEvidence) evidenceItems.push(directionEvidence);

  const specification = source.specification;
  if (specification) evidenceItems.push(evidence(
    'design-specification',
    'design-specification',
    logicalPath(specification.path, 'design-spec.md', 'design specification path'),
    specification,
    { revision: specification.revision },
  ));

  const verification = source.verification;
  if (verification) evidenceItems.push(evidence(
    'rendered-verification',
    'rendered-verification',
    logicalPath(verification.path, '.design/verification/current.json', 'verification path'),
    verification,
    { revision: verification.revision },
  ));

  const review = reviewState(source.review, revision);
  if (source.review) evidenceItems.push(evidence(
    'review-feedback',
    'review-feedback',
    logicalPath(source.review.path, '.design/review.json', 'review feedback path'),
    source.review,
    { revision: source.review.revision },
  ));

  const handoff = source.reviewHandoff;
  if (handoff) evidenceItems.push(evidence(
    'review-handoff',
    'review-handoff',
    logicalPath(handoff.path, 'review-handoff.json', 'review handoff path'),
    handoff,
    { revision: handoff.basis?.sourceRevision },
  ));

  const checks = [];
  checks.push(checked('current-revision', revision ? 'pass' : 'blocked', revision ? ['design-revision'] : []));

  const handoffDirection = handoff?.basis?.selectedVariant;
  const directionStatus = !direction.ready ? 'blocked' : handoffDirection && handoffDirection !== direction.selected ? 'stale' : 'pass';
  checks.push(checked('selected-direction', directionStatus, directionEvidence ? ['selected-direction'] : []));

  let specificationStatus = 'blocked';
  if (specification?.complete === true) {
    const specificationRevision = optionalDigest(specification.revision, 'design specification revision');
    specificationStatus = revision && specificationRevision && specificationRevision !== revision ? 'stale' : 'pass';
  }
  checks.push(checked('design-specification', specificationStatus, specification ? ['design-specification'] : []));

  let verificationStatus = 'blocked';
  if (verification) {
    const verificationRevision = optionalDigest(verification.revision, 'rendered verification revision');
    if (revision && verificationRevision && verificationRevision !== revision) verificationStatus = 'stale';
    else if (verification.status === 'verified') verificationStatus = 'pass';
  }
  checks.push(checked('rendered-verification', verificationStatus, verification ? ['rendered-verification'] : []));

  const reviewRefs = source.review ? ['review-feedback'] : [];
  const freshnessStatus = review.ambiguous ? 'blocked' : review.stale ? 'stale' : 'pass';
  checks.push(checked('review-freshness', freshnessStatus, reviewRefs));

  const undecided = review.pins.filter(pin => pin.current && !['accepted', 'deferred', 'rejected'].includes(pin.disposition));
  const invalidDisposition = review.pins.some(pin => pin.disposition && !['accepted', 'deferred', 'rejected'].includes(pin.disposition));
  const dispositionStatus = invalidDisposition || review.ambiguous ? 'blocked' : undecided.length ? 'attention' : 'pass';
  checks.push(checked('review-dispositions', dispositionStatus, reviewRefs));

  const openBlockers = review.pins.filter(pin => pin.current && ['blocker', 'change-request'].includes(pin.category) && !['accepted', 'deferred', 'rejected'].includes(pin.disposition));
  const staleAccepted = review.pins.some(pin => !pin.current && pin.disposition === 'accepted');
  const blockerStatus = staleAccepted ? 'stale' : openBlockers.length ? 'blocked' : 'pass';
  checks.push(checked('unresolved-blockers', blockerStatus, reviewRefs));

  const approvalStatus = handoffState(handoff, document.id, revision, direction.selected);
  checks.push(checked('approved-review-handoff', approvalStatus, handoff ? ['review-handoff'] : []));

  if (checks.map(item => item.id).join('\n') !== CHECKS.join('\n')) throw new TypeError('Readiness checks are not in canonical order.');
  const worst = checks.reduce((current, item) => priority[item.status] > priority[current] ? item.status : current, 'pass');
  const status = worst === 'pass' ? 'ready' : worst;
  const blockers = checks.filter(item => ['blocked', 'stale'].includes(item.status)).map(item => item.id);
  const nextActions = checks.filter(item => item.status !== 'pass').map(item => item.recoveryAction);
  return assertDesignHandoffReadiness({
    kind: 'openplanr-design-handoff-readiness',
    schemaVersion: '1.0.0',
    scope: 'design-originated',
    authority: 'none',
    designId: document.id,
    sourceRevision: revision,
    selectedVariant: direction.selected,
    status,
    continuation: { action: 'prepare-plan', available: ['ready', 'attention'].includes(status) },
    checks,
    evidence: evidenceItems.sort((left, right) => left.id.localeCompare(right.id)),
    blockers,
    nextActions,
  });
}

export function designHandoffReadinessAbsence(reason = 'not-computed') {
  return assertDesignHandoffReadiness({
    kind: 'openplanr-design-handoff-readiness-absence',
    schemaVersion: '1.0.0',
    status: 'absent',
    reason,
    message: 'No design handoff readiness has been prepared.',
    nextAction: { id: 'inspect-design', label: 'Open the design when you want to prepare a handoff' },
  });
}

export function designHandoffReadinessDigest(value) {
  assertDesignHandoffReadiness(value);
  return `sha256:${sha256Hex(canonicalizeJson(value))}`;
}

export function canContinueDesignHandoff(value) {
  if (value?.kind !== 'openplanr-design-handoff-readiness') return false;
  return assertDesignHandoffReadiness(value).continuation.available === true;
}
