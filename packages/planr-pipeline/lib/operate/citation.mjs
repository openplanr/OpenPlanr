import { assertProtocolArtifact, listOperatingRoles } from '../protocol/contracts.mjs';
import { PipelineError } from '../pipeline/errors.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';

/**
 * Pure, deterministic citation-shape validation and the canonical
 * resolution-outcome builder for FR3 (citation resolution as the audit
 * mechanism).
 *
 * Shapes are the CANONICAL Protocol v1.3.0 contracts registered by T-001:
 * `operating-citation` (a lean anchor — exactly one of `repositoryPath` +
 * optional `lineRange`, `gitRevision`, or `planrArtifactId`, each bound to the
 * cycle's frozen `pinnedRevision`) and `operating-citation-resolution` (the
 * engine's typed verdict, keyed back to the citation by `citationKey`). This
 * module owns NO schema text: it validates every citation and every produced
 * resolution through `lib/protocol/contracts.mjs` with an explicit
 * `protocolVersion: '1.3.0'`, so the registry stays the single source of truth
 * and a citation produced here satisfies the
 * `operating-advisor-response.citations[] -> $ref operating-citation` chain
 * verbatim.
 *
 * This module performs NO repository, git, network, or filesystem *resolution*.
 * Every fact about whether a cited path/line-range/revision/artifact resolves at
 * the cycle's pinned revision is supplied by the caller in the `facts` object —
 * the OpenPlanr citation resolver computes those booleans against live
 * repo/git/planr state and hands them in. Keeping resolution facts external
 * makes this a self-contained, unit-testable contract that the resolver
 * *satisfies* rather than duplicating.
 *
 * A citation with any unresolvable component NEVER reaches a `resolved` outcome:
 * resolution fails closed, rejecting the proposal and deriving a deterministic
 * gap ID so a fabricated or drifted citation is caught after the fact instead of
 * being confabulated over a preloaded dump.
 *
 * Snapshot sensitivity/classification: the canonical `operating-citation-resolution`
 * contract deliberately carries no `sensitivity`/`classification` field (it
 * declares `additionalProperties: false`). Those attributes live on the
 * `operating-evidence` record the resolver mints under the resolution's
 * `evidenceId`, which the existing (OpenPlanr-owned, unchanged) evidence
 * redaction/secret-scan pipeline enforces. To keep that binding deterministic
 * and tamper-evident, the caller MAY pass snapshot metadata (e.g. `sensitivity`,
 * `classification`) alongside the resolution facts; because `evidenceId` and
 * `snapshotDigest` are `sha256Jcs` over the citation + the whole `facts` object,
 * any change to the declared sensitivity/classification changes the snapshot
 * binding — snapshotted citation content therefore flows through the identical
 * redaction path as collected evidence, with no separate unredacted route.
 */

const DIGEST_PREFIX = 'sha256:';

const REJECTION_REASONS = Object.freeze([
  'fabricated-path',
  'wrong-line-range',
  'stale-revision',
  'unresolvable',
]);

function citationFail(detail) {
  throw new PipelineError('E_OPERATE_CITATION_INVALID', `operating-citation: ${detail}`);
}

function hexDigest(digest) {
  return digest.startsWith(DIGEST_PREFIX) ? digest.slice(DIGEST_PREFIX.length) : digest;
}

/**
 * The citation kind implied by which locator field is present. The canonical
 * schema's `oneOf` guarantees exactly one is set on a valid citation, so this is
 * total for any citation that has passed `validateOperatingCitation`.
 */
function citationKind(citation) {
  if (typeof citation.repositoryPath === 'string') return 'repo-path';
  if (typeof citation.gitRevision === 'string') return 'git-revision';
  if (typeof citation.planrArtifactId === 'string') return 'planr-artifact';
  return null;
}

/**
 * Which resolution facts a citation actually depends on. Facts that do not apply
 * to a citation kind are never consulted, so a git-revision citation is not
 * rejected for a missing path fact.
 */
function relevantFacts(citation) {
  const kind = citationKind(citation);
  return {
    path: kind === 'repo-path',
    line: kind === 'repo-path' && citation.lineRange !== undefined && citation.lineRange !== null,
    revision: kind === 'repo-path' || kind === 'git-revision',
    artifact: kind === 'planr-artifact',
  };
}

/**
 * Choose the rejection reason as the first failing fact in a fixed precedence
 * order: path existence, then line range, then revision freshness, then artifact
 * existence. Any relevant fact that is not strictly `true` fails closed, so a
 * missing or non-boolean fact rejects rather than silently resolving.
 */
function firstFailingReason(facts, relevant) {
  if (relevant.path && facts.pathExistsAtRevision !== true) return 'fabricated-path';
  if (relevant.line && facts.lineRangeInBounds !== true) return 'wrong-line-range';
  if (relevant.revision && facts.revisionIsCurrent !== true) return 'stale-revision';
  if (relevant.artifact && facts.artifactExists !== true) return 'unresolvable';
  return null;
}

function describeCitationSubject(citation) {
  const kind = citationKind(citation);
  if (kind === 'repo-path') {
    const range = citation.lineRange
      ? ` lines ${citation.lineRange.start}-${citation.lineRange.end}`
      : '';
    return `path "${citation.repositoryPath}"${range}`;
  }
  if (kind === 'git-revision') return `revision ${citation.gitRevision}`;
  return `artifact ${citation.planrArtifactId}`;
}

/**
 * Validate a citation against the canonical `operating-citation` v1.3.0 contract
 * (via `lib/protocol/contracts.mjs`). Rejects any citation missing
 * `pinnedRevision` before any further check — a citation that is not bound to the
 * cycle's pinned revision cannot be audited and fails closed. Throws
 * `E_OPERATE_CITATION_INVALID` for the pre-check and `E_PROTOCOL_ARTIFACT_INVALID`
 * for a contract violation; returns the citation on success.
 */
export function validateOperatingCitation(citation) {
  if (citation === null || typeof citation !== 'object' || Array.isArray(citation)) {
    citationFail('citation must be a plain object.');
  }
  if (typeof citation.pinnedRevision !== 'string' || citation.pinnedRevision.length === 0) {
    citationFail("pinnedRevision is required — a citation must bind to the cycle's pinned revision.");
  }
  assertProtocolArtifact('operating-citation', citation, { protocolVersion: '1.3.0' });
  return citation;
}

/**
 * Resolve a citation against caller-supplied facts. Returns a canonical
 * `operating-citation-resolution` v1.3.0 record: either a `resolved` outcome with
 * a deterministic snapshot evidence ID and digest, or a `rejected` outcome with a
 * typed reason and a deterministic linked gap ID — never a silent pass-through.
 * The snapshot binding (`evidenceId`/`snapshotDigest`) and the `gapId` are
 * computed via `sha256Jcs` so identical inputs reproduce identical outputs. The
 * produced record is validated against the registered contract before it is
 * returned.
 *
 * @param {object} citation an `operating-citation` v1.3.0 record (must carry a
 *   `citationKey` so the resolution can key back to it).
 * @param {{ pathExistsAtRevision?: boolean, lineRangeInBounds?: boolean,
 *           revisionIsCurrent?: boolean, artifactExists?: boolean,
 *           sensitivity?: string, classification?: string }} facts booleans the
 *   OpenPlanr resolver computes against live state, plus optional snapshot
 *   metadata that binds into the snapshot digest (see module comment).
 */
export function resolveOperatingCitation(citation, facts = {}) {
  validateOperatingCitation(citation);
  if (typeof citation.citationKey !== 'string' || citation.citationKey.length === 0) {
    citationFail('citationKey is required to resolve a citation — the resolution keys back to it.');
  }
  const suppliedFacts = facts ?? {};
  const relevant = relevantFacts(citation);
  const reason = firstFailingReason(suppliedFacts, relevant);

  let outcome;
  if (reason === null) {
    const snapshotDigest = sha256Jcs({ citation, facts: suppliedFacts });
    outcome = {
      kind: 'operating-citation-resolution',
      schemaVersion: '1.0.0',
      protocolVersion: '1.3.0',
      citationKey: citation.citationKey,
      outcome: 'resolved',
      evidenceId: `EVD-${hexDigest(snapshotDigest)}`,
      snapshotDigest,
    };
  } else {
    outcome = {
      kind: 'operating-citation-resolution',
      schemaVersion: '1.0.0',
      protocolVersion: '1.3.0',
      citationKey: citation.citationKey,
      outcome: 'rejected',
      reason,
      gapId: `GAP-${hexDigest(sha256Jcs({ citation, reason }))}`,
    };
  }

  assertProtocolArtifact('operating-citation-resolution', outcome, { protocolVersion: '1.3.0' });
  return outcome;
}

/**
 * Build an `operating-data-gap` v1.3 record (`category: "unresolvable-citation"`)
 * from a rejected resolution outcome, suitable for the existing generic
 * `gap.open` event payload — no new event discriminator is introduced. The
 * canonical citation is a lean anchor, so cycle/timestamp/owner context the gap
 * record requires is supplied by the caller (the citation resolver already has
 * it). The record is deterministic given identical inputs: its ID is the
 * rejection's `gapId`. The produced gap is validated against the registered
 * contract before it is returned.
 *
 * @param {object} citation the rejected `operating-citation` record.
 * @param {object} rejection the `rejected` resolution outcome from
 *   `resolveOperatingCitation`.
 * @param {{ cycleId: string, createdAt: string, updatedAt?: string,
 *           owner?: string, affectedRoles?: string[], unblocks?: string[] }}
 *   context cycle/timestamp/ownership the lean citation does not carry.
 */
export function buildUnresolvableCitationGap(citation, rejection, context = {}) {
  validateOperatingCitation(citation);
  if (
    rejection === null
    || typeof rejection !== 'object'
    || rejection.outcome !== 'rejected'
    || typeof rejection.gapId !== 'string'
    || !REJECTION_REASONS.includes(rejection.reason)
  ) {
    throw new PipelineError(
      'E_OPERATE_CITATION_INVALID',
      'operating-data-gap: buildUnresolvableCitationGap requires a rejected resolution outcome.',
    );
  }
  if (context === null || typeof context !== 'object') {
    throw new PipelineError(
      'E_OPERATE_CITATION_INVALID',
      'operating-data-gap: buildUnresolvableCitationGap requires a context object with cycleId and createdAt.',
    );
  }

  const createdAt = context.createdAt;
  const gap = {
    kind: 'operating-data-gap',
    schemaVersion: '1.0.0',
    protocolVersion: '1.3.0',
    id: rejection.gapId,
    cycleId: context.cycleId,
    category: 'unresolvable-citation',
    question:
      `The ${citationKind(citation)} citation ${describeCitationSubject(citation)} could not be `
      + `resolved at pinned revision ${citation.pinnedRevision} (${rejection.reason}); `
      + 'provide a resolvable citation before this proposal can be accepted.',
    reason: rejection.reason,
    unblocks: Array.isArray(context.unblocks) ? [...context.unblocks] : [],
    status: 'open',
    owner: typeof context.owner === 'string' && context.owner.length > 0 ? context.owner : 'chair',
    evidenceRefs: [],
    createdAt,
    updatedAt: typeof context.updatedAt === 'string' ? context.updatedAt : createdAt,
  };
  if (Array.isArray(context.affectedRoles) && context.affectedRoles.length > 0) {
    const advisoryRoleIds = new Set(listOperatingRoles().map(({ id }) => id));
    gap.affectedRoles = context.affectedRoles.filter((role) => advisoryRoleIds.has(role));
    if (gap.affectedRoles.length === 0) delete gap.affectedRoles;
  }

  assertProtocolArtifact('operating-data-gap', gap, { protocolVersion: '1.3.0' });
  return gap;
}
