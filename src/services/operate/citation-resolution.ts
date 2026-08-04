import { stat } from 'node:fs/promises';
import path from 'node:path';
import { isPlanrArtifactId, resolvePlanrArtifactCitation } from './artifacts.js';
import { canonicalDigest } from './canonical.js';
import type { OperatingEvidenceCache } from './evidence-cache.js';
import { assertOperatingArtifact } from './protocol.js';
import {
  gitRevisionResolves,
  readGitCommitSummary,
  readGitPathAtRevision,
} from './read-only-providers.js';
import { detectSecretMetadata, redactSensitiveText } from './redaction.js';
import {
  OperateError,
  type OperatingSensitivity,
  type OperatingWorkspaceComponent,
  type OperatingWorkspaceManifest,
  type OperatingWorkspaceRoots,
} from './types.js';
import { isPathInside } from './workspace.js';

/**
 * FR3 (E-003) — resolve every citation an advisor returns against the cycle's
 * pinned revision and snapshot the cited content into machine-local evidence.
 *
 * Anchor shape is validated against `operating-citation@1.4.0` — the exact
 * contract the advisor RESPONSE is validated against. The installed pipeline
 * library only knows the frozen `operating-citation@1.3.0` anchor, whose
 * repository-path pattern rejects the dot-prefixed roots every advisor mandate
 * authorizes (`.github`, `.planr`, `.changeset`, …) and whose planr-artifact
 * pattern rejects the product's real backlog/quick-task classes — the very
 * anchors the v1.4.0 response schema ACCEPTS. Re-validating them under v1.3.0 at
 * record time contradicted the mandate and degraded ~line-precise repository
 * citations into bare `git` references. So this module owns the v1.4.0-aligned
 * anchor validation, the resolution precedence, and the unresolvable-citation
 * gap shape directly, until the Wave-3 protocol upgrade lets the library accept
 * v1.4.0 anchors. The resolution binding stays BYTE-IDENTICAL to the library's:
 * the snapshot digest is `canonicalDigest({ citation, facts })` — the same JCS
 * the library's `sha256Jcs` computes — and a conformance test pins it to the
 * installed library's output so the two can never silently drift.
 *
 * Beyond the library's four fail-closed reasons this module adds two DISTINCT
 * classifications the library — which has no repo/workspace access — cannot make:
 *  - `dirty-working-tree`: a cited path absent at the frozen pin but present and
 *    uncommitted in a dirty working tree, named separately from a fabrication so
 *    a finding that points at in-flight work is not discarded as invented; and
 *  - `external-component-unresolved`: a citation that names a sibling workspace
 *    component that cannot be resolved on this machine — an honest "cannot
 *    verify", never `fabricated-path`, which would accuse an advisor of inventing
 *    evidence into a repo it correctly named but this machine cannot check.
 *
 * A citation with any unresolvable component NEVER produces an evidence ID: it
 * fails closed into a gap and its proposal never reaches consolidation.
 */

const DEFAULT_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1_000;

export type CitationRejectionReason =
  | 'fabricated-path'
  | 'wrong-line-range'
  | 'stale-revision'
  | 'unresolvable'
  | 'dirty-working-tree'
  | 'external-component-unresolved';

/** A `firstFailingReason` verdict shared with the library's precedence. */
type CitationFailClosedReason =
  | 'fabricated-path'
  | 'wrong-line-range'
  | 'stale-revision'
  | 'unresolvable';

/**
 * The `operating-citation@1.4.0` anchor as carried through the resolver (exactly
 * one locator). `componentId` names the workspace component the locator resolves
 * against; absent, the citation resolves against the control repository.
 */
export interface OperatingCitation {
  citationKey?: string;
  componentId?: string;
  repositoryPath?: string;
  lineRange?: { start: number; end: number };
  gitRevision?: string;
  planrArtifactId?: string;
  pinnedRevision: string;
}

// Anchor patterns mirrored verbatim from `operating-citation@1.4.0`
// (`node_modules/planr-pipeline/schemas/v1.4.0/operating-citation.schema.json`).
// `pinnedRevision` is the resolver's cycle binding, not a schema field, but it
// shares the revision shape.
const CITATION_REVISION_PATTERN = /^[A-Fa-f0-9]{7,64}$/;
// Repository/git path: relative (no leading `/`), no `..` traversal segment.
// Dot-prefixed roots (`.github/…`, `.planr/…`) are explicitly permitted.
const CITATION_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/;
const CITATION_COMPONENT_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const CITATION_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Validate an anchor against `operating-citation@1.4.0` — the same shape the
 * advisor response was validated against. Throws `E_OPERATE_STATE_INVALID` with
 * a content-free diagnostic; returns nothing on success.
 *
 * Exported so the cross-component conformance suite can assert, against the real
 * record-time anchor rather than a re-derived copy, that every declared mandate
 * root and every bootstrap-reachable planr artifact class this same anchor must
 * accept is in fact accepted here.
 */
export function assertOperatingCitationAnchor(citation: OperatingCitation): void {
  const fail = (detail: string): never => {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      `Citation is not a valid operating-citation@1.4.0 anchor: ${detail}.`,
    );
  };
  if (citation === null || typeof citation !== 'object' || Array.isArray(citation)) {
    fail('citation must be a plain object');
  }
  if (
    typeof citation.pinnedRevision !== 'string' ||
    !CITATION_REVISION_PATTERN.test(citation.pinnedRevision)
  ) {
    fail("pinnedRevision must bind the citation to the cycle's 7–64 hex revision");
  }
  if (
    citation.citationKey !== undefined &&
    (typeof citation.citationKey !== 'string' ||
      citation.citationKey.length > 128 ||
      !CITATION_KEY_PATTERN.test(citation.citationKey))
  ) {
    fail('citationKey must match ^[A-Za-z0-9._-]+$ and be at most 128 characters');
  }
  if (
    citation.componentId !== undefined &&
    (typeof citation.componentId !== 'string' ||
      !CITATION_COMPONENT_ID_PATTERN.test(citation.componentId))
  ) {
    fail('componentId must match ^[a-z][a-z0-9-]{0,63}$');
  }
  const locators = (['repositoryPath', 'gitRevision', 'planrArtifactId'] as const).filter(
    (key) => typeof citation[key] === 'string',
  );
  if (locators.length !== 1) {
    fail('exactly one of repositoryPath, gitRevision, or planrArtifactId is required');
  }
  if (typeof citation.repositoryPath === 'string') {
    if (
      citation.repositoryPath.length < 1 ||
      citation.repositoryPath.length > 1024 ||
      !CITATION_PATH_PATTERN.test(citation.repositoryPath)
    ) {
      fail(
        `$.repositoryPath value ${JSON.stringify(
          citation.repositoryPath,
        )} must be a 1–1024 char relative path with no '..' traversal segment`,
      );
    }
  } else if (citation.lineRange !== undefined) {
    fail('lineRange is only valid on a repositoryPath citation');
  }
  if (
    typeof citation.gitRevision === 'string' &&
    !CITATION_REVISION_PATTERN.test(citation.gitRevision)
  ) {
    fail('gitRevision must be a 7–64 hex revision');
  }
  if (
    typeof citation.planrArtifactId === 'string' &&
    !isPlanrArtifactId(citation.planrArtifactId)
  ) {
    fail(
      `$.planrArtifactId value ${JSON.stringify(
        citation.planrArtifactId,
      )} is not a known planr artifact class`,
    );
  }
  if (citation.lineRange !== undefined) {
    const range: { start?: unknown; end?: unknown } = citation.lineRange;
    if (
      typeof range !== 'object' ||
      range === null ||
      typeof range.start !== 'number' ||
      typeof range.end !== 'number' ||
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 1 ||
      range.end < 1
    ) {
      fail('lineRange start and end must be integers ≥ 1');
    }
  }
}

/** A Protocol v1.3 `operating-data-gap` (`category: 'unresolvable-citation'`). */
export interface OperatingCitationGap {
  kind: 'operating-data-gap';
  schemaVersion: '1.0.0';
  protocolVersion: '1.3.0';
  id: string;
  cycleId: string;
  category: 'unresolvable-citation';
  question: string;
  reason: string;
  unblocks: string[];
  affectedRoles?: string[];
  status: 'open';
  owner: string;
  evidenceRefs: string[];
  createdAt: string;
  updatedAt: string;
}

interface CitationFacts {
  pathExistsAtRevision?: boolean;
  lineRangeInBounds?: boolean;
  revisionIsCurrent?: boolean;
  artifactExists?: boolean;
  sensitivity?: string;
  classification?: string;
}

/**
 * A workspace component a citation may resolve against. `root` is the machine-local
 * checkout the locator is read from and `descriptor` carries that checkout's frozen
 * pinned revision and dirty fingerprint. The control repository is always resolvable
 * by its own component ID; sibling components are supplied through the context so a
 * cross-repo citation is audited against the sibling's revision, not the control's.
 */
export interface OperatingCitationComponent {
  componentId: string;
  root: string;
  descriptor: OperatingWorkspaceComponent;
}

/**
 * Build the resolvable sibling components for a citation context by joining the
 * committed workspace manifest's component descriptors (each carrying that
 * component's frozen pinned revision) with the machine-local root map. A
 * component present in the manifest but absent from the root map is omitted — its
 * citations then classify `external-component-unresolved` rather than resolving
 * against the wrong checkout. The control repository is never listed here; it is
 * always resolvable by its own ID through the context's `descriptor`.
 */
export function citationComponentsFromWorkspace(
  workspace: OperatingWorkspaceManifest,
  roots: OperatingWorkspaceRoots | null,
): OperatingCitationComponent[] {
  const rootMap = roots?.roots ?? {};
  return workspace.components
    .map((descriptor): OperatingCitationComponent | null => {
      const root = rootMap[descriptor.componentId];
      return typeof root === 'string'
        ? { componentId: descriptor.componentId, root, descriptor }
        : null;
    })
    .filter((entry): entry is OperatingCitationComponent => entry !== null);
}

export interface CitationResolutionContext {
  projectRoot: string;
  /** Must match `^CYCLE-[0-9]{3,}$` so an unresolvable-citation gap validates. */
  cycleId: string;
  /** The control repository descriptor: the frozen pinned revision and the dirty fingerprint. */
  descriptor: OperatingWorkspaceComponent;
  cache: OperatingEvidenceCache;
  owner?: string;
  affectedRoles?: string[];
  snapshotTtlMs?: number;
  now?: Date;
  /**
   * Sibling workspace components a `componentId`-bearing citation may resolve
   * against (from `~/.planr/operate/<hash>/workspace-roots.json`). The control
   * repository is always resolvable by its own ID and need not be listed here; a
   * citation whose `componentId` matches nothing resolvable classifies as
   * `external-component-unresolved` rather than `fabricated-path`.
   */
  components?: readonly OperatingCitationComponent[];
  /** Sensitivity a snapshot inherits when the cited source declares none (defaults to `internal`). */
  defaultSensitivity?: OperatingSensitivity;
  /** Per-citation sensitivity inherited from the cited file (T-002's evidence-item sensitivity). */
  sensitivityFor?(citation: OperatingCitation): OperatingSensitivity | undefined;
}

export type CitationKind = 'repo-path' | 'git-revision' | 'planr-artifact';

export interface ResolvedCitation {
  citation: OperatingCitation;
  citationKey: string;
  outcome: 'resolved' | 'rejected';
  reason?: CitationRejectionReason;
  /**
   * The citation kind the classifier resolved the citation as (FR8): `.planr/`
   * planning artifacts are `planr-artifact`, git-tracked source is `repo-path`,
   * and a bare commit reference is `git-revision`. Surfaced so a validation
   * error names the expected kind without exposing the cited content.
   */
  expectedCitationKind: CitationKind;
  evidenceId?: string;
  snapshotDigest?: `sha256:${string}`;
  gap?: OperatingCitationGap;
  sensitivity: OperatingSensitivity;
}

function citationKind(citation: OperatingCitation): CitationKind | null {
  if (typeof citation.repositoryPath === 'string') return 'repo-path';
  if (typeof citation.gitRevision === 'string') return 'git-revision';
  if (typeof citation.planrArtifactId === 'string') return 'planr-artifact';
  return null;
}

function stableCitationKey(citation: OperatingCitation): string {
  if (typeof citation.citationKey === 'string' && /^[A-Za-z0-9._-]+$/.test(citation.citationKey)) {
    return citation.citationKey;
  }
  return `cite-${canonicalDigest(citation).slice('sha256:'.length, 34)}`;
}

function lineRangeWithin(range: { start: number; end: number }, lineCount: number): boolean {
  return (
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    range.start >= 1 &&
    range.end >= range.start &&
    range.end <= lineCount
  );
}

async function workingTreeHasFile(projectRoot: string, relativePath: string): Promise<boolean> {
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, relativePath);
  if (!isPathInside(root, target)) return false;
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

function dirtyWorkingTreeGap(
  citation: OperatingCitation,
  context: CitationResolutionContext,
  now: Date,
): OperatingCitationGap {
  const range = citation.lineRange
    ? ` lines ${citation.lineRange.start}-${citation.lineRange.end}`
    : '';
  const createdAt = now.toISOString();
  const gap: OperatingCitationGap = {
    kind: 'operating-data-gap',
    schemaVersion: '1.0.0',
    protocolVersion: '1.3.0',
    id: `GAP-${canonicalDigest({ citation, reason: 'dirty-working-tree' }).slice('sha256:'.length)}`,
    cycleId: context.cycleId,
    category: 'unresolvable-citation',
    question:
      `The repository path "${citation.repositoryPath}"${range} cites uncommitted working-tree ` +
      `content that is not present at pinned revision ${citation.pinnedRevision}; commit the change ` +
      'or cite the pinned revision before this proposal can be accepted.',
    reason: 'dirty-working-tree',
    unblocks: [],
    status: 'open',
    owner: context.owner && context.owner.length > 0 ? context.owner : 'chair',
    evidenceRefs: [],
    createdAt,
    updatedAt: createdAt,
  };
  return gap;
}

/**
 * FR2 safety property (replaces the retired candidate-diagnose workflow): a
 * resolved citation whose cited bytes carry a HARD-BLOCKED secret category
 * (a known token, an authorization header, a private key, a JWT, or a
 * credential URL) is rejected as an `unresolvable` citation gap rather than
 * redacted-and-accepted into a snapshot. The soft categories (a bare
 * secret-shaped assignment or structured value) stay redacted-and-accepted —
 * only a definite, hard-blocked secret refuses the citation outright, so a
 * hard secret never reaches even a redacted evidence-of-record.
 */
function hardBlockedSecretGap(
  citation: OperatingCitation,
  context: CitationResolutionContext,
  now: Date,
): OperatingCitationGap {
  const location =
    citation.repositoryPath ?? citation.gitRevision ?? citation.planrArtifactId ?? 'cited content';
  const createdAt = now.toISOString();
  return {
    kind: 'operating-data-gap',
    schemaVersion: '1.0.0',
    protocolVersion: '1.3.0',
    id: `GAP-${canonicalDigest({ citation, reason: 'hard-blocked-secret' }).slice('sha256:'.length)}`,
    cycleId: context.cycleId,
    category: 'unresolvable-citation',
    question:
      `The cited content at "${location}" carries a hard-blocked secret; it is rejected as ` +
      'unresolvable rather than snapshotted, even redacted. Remove the secret from the cited ' +
      'source or cite content that does not disclose it.',
    reason: 'unresolvable',
    unblocks: [],
    status: 'open',
    owner: context.owner && context.owner.length > 0 ? context.owner : 'chair',
    evidenceRefs: [],
    createdAt,
    updatedAt: createdAt,
  };
}

interface CitationObservation {
  kind: 'repo-path' | 'git-revision' | 'planr-artifact';
  pathExistsAtRevision?: boolean;
  inWorkingTree?: boolean;
  revisionResolves?: boolean;
  artifactExists?: boolean;
  content?: string | null;
  lineCount?: number;
  location?: string | null;
  /** Set when the source already redacted (planr artifacts); otherwise redact here. */
  preRedacted?: boolean;
}

async function observeCitation(
  citation: OperatingCitation,
  context: CitationResolutionContext,
  component: OperatingCitationComponent,
  sensitivity: OperatingSensitivity,
): Promise<CitationObservation> {
  const kind = citationKind(citation);
  if (kind === 'repo-path' && citation.repositoryPath) {
    // Repository and git locators read from the resolved component's checkout —
    // the control repository by default, or a named sibling for a cross-repo
    // citation — so the locator is audited against that component's revision.
    const blob = await readGitPathAtRevision(
      component.root,
      citation.pinnedRevision,
      citation.repositoryPath,
    );
    const inWorkingTree = blob.exists
      ? true
      : await workingTreeHasFile(component.root, citation.repositoryPath);
    return {
      kind,
      pathExistsAtRevision: blob.exists,
      inWorkingTree,
      content: blob.content,
      lineCount: blob.lineCount,
      location: citation.repositoryPath,
    };
  }
  if (kind === 'git-revision' && citation.gitRevision) {
    const resolves = await gitRevisionResolves(component.root, citation.gitRevision);
    const summary = resolves
      ? await readGitCommitSummary(component.root, citation.gitRevision)
      : null;
    return {
      kind,
      revisionResolves: resolves,
      content: summary ?? `commit ${citation.gitRevision}`,
      location: `git:${citation.gitRevision}`,
    };
  }
  // planr-artifact — planning artifacts live only in the control repository's
  // `.planr/` tree (the v1.4.0 planr citation carries no componentId), so they
  // always resolve against the control project root.
  const resolution = await resolvePlanrArtifactCitation({
    projectRoot: context.projectRoot,
    pinnedRevision: citation.pinnedRevision,
    artifactId: citation.planrArtifactId as string,
    sensitivity,
  });
  return {
    kind: 'planr-artifact',
    artifactExists: resolution.artifactExists,
    content: resolution.content,
    location: resolution.location,
    preRedacted: true,
  };
}

/** The cited locator, described without exposing any cited content. */
function describeCitationSubject(citation: OperatingCitation): string {
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
 * The fail-closed rejection reason, as the FIRST failing fact in the fixed
 * precedence the library defines: path existence, then line-range bounds, then
 * revision freshness, then artifact existence. Any relevant fact that is not
 * strictly `true` fails closed, so a missing or non-boolean fact rejects rather
 * than silently resolving. Byte-for-byte the same order as the pipeline library.
 */
function firstFailingReason(
  kind: CitationKind,
  facts: CitationFacts,
  hasLineRange: boolean,
): CitationFailClosedReason | null {
  if (kind === 'repo-path') {
    if (facts.pathExistsAtRevision !== true) return 'fabricated-path';
    if (hasLineRange && facts.lineRangeInBounds !== true) return 'wrong-line-range';
    if (facts.revisionIsCurrent !== true) return 'stale-revision';
    return null;
  }
  if (kind === 'git-revision') {
    if (facts.revisionIsCurrent !== true) return 'stale-revision';
    return null;
  }
  if (facts.artifactExists !== true) return 'unresolvable';
  return null;
}

/**
 * The unresolvable-citation gap for a fail-closed rejection. Its shape and its
 * deterministic id (`GAP-<hex of canonicalDigest({ citation, reason })>`) match
 * the pipeline library's `buildUnresolvableCitationGap` verbatim so a rejection
 * routed here is indistinguishable from one the library would have produced.
 */
function unresolvableCitationGap(
  citation: OperatingCitation,
  reason: CitationFailClosedReason,
  context: CitationResolutionContext,
  now: Date,
): OperatingCitationGap {
  const createdAt = now.toISOString();
  const gap: OperatingCitationGap = {
    kind: 'operating-data-gap',
    schemaVersion: '1.0.0',
    protocolVersion: '1.3.0',
    id: `GAP-${canonicalDigest({ citation, reason }).slice('sha256:'.length)}`,
    cycleId: context.cycleId,
    category: 'unresolvable-citation',
    question:
      `The ${citationKind(citation)} citation ${describeCitationSubject(citation)} could not be ` +
      `resolved at pinned revision ${citation.pinnedRevision} (${reason}); provide a resolvable ` +
      'citation before this proposal can be accepted.',
    reason,
    unblocks: [],
    status: 'open',
    owner: context.owner && context.owner.length > 0 ? context.owner : 'chair',
    evidenceRefs: [],
    createdAt,
    updatedAt: createdAt,
  };
  if (context.affectedRoles && context.affectedRoles.length > 0) {
    gap.affectedRoles = [...new Set(context.affectedRoles)].sort();
  }
  return gap;
}

/**
 * The gap for a citation that names a workspace component that cannot be resolved
 * on this machine. This is an honest "cannot verify" — never `fabricated-path`,
 * which would accuse the advisor of inventing evidence into a sibling repository
 * it correctly named but whose checkout this machine does not have.
 */
function externalComponentUnresolvedGap(
  citation: OperatingCitation,
  componentId: string,
  context: CitationResolutionContext,
  now: Date,
): OperatingCitationGap {
  const createdAt = now.toISOString();
  const gap: OperatingCitationGap = {
    kind: 'operating-data-gap',
    schemaVersion: '1.0.0',
    protocolVersion: '1.3.0',
    id: `GAP-${canonicalDigest({ citation, reason: 'external-component-unresolved' }).slice(
      'sha256:'.length,
    )}`,
    cycleId: context.cycleId,
    category: 'unresolvable-citation',
    question:
      `The ${citationKind(citation)} citation ${describeCitationSubject(citation)} names workspace ` +
      `component "${componentId}", which is not resolvable on this machine; register the ` +
      'component root (or cite the control repository) before this proposal can be accepted. This ' +
      'is an unverifiable external-component reference, not a fabricated citation.',
    reason: 'external-component-unresolved',
    unblocks: [],
    status: 'open',
    owner: context.owner && context.owner.length > 0 ? context.owner : 'chair',
    evidenceRefs: [],
    createdAt,
    updatedAt: createdAt,
  };
  if (context.affectedRoles && context.affectedRoles.length > 0) {
    gap.affectedRoles = [...new Set(context.affectedRoles)].sort();
  }
  return gap;
}

/**
 * Resolve which workspace component a citation is audited against. A citation
 * with no `componentId` — and one that names the control repository's own
 * component ID — resolves against the control project root. A `componentId`
 * naming a supplied sibling component resolves against that sibling's checkout.
 * A `componentId` that matches nothing resolvable returns `null`, which the
 * resolver classifies `external-component-unresolved`.
 */
function selectCitationComponent(
  citation: OperatingCitation,
  context: CitationResolutionContext,
): OperatingCitationComponent | null {
  const control: OperatingCitationComponent = {
    componentId: context.descriptor.componentId,
    root: context.projectRoot,
    descriptor: context.descriptor,
  };
  if (typeof citation.componentId !== 'string') return control;
  if (citation.componentId === context.descriptor.componentId) return control;
  return context.components?.find((entry) => entry.componentId === citation.componentId) ?? null;
}

function factsFor(
  citation: OperatingCitation,
  observation: CitationObservation,
  cyclePinnedRevision: string,
  sensitivity: OperatingSensitivity,
): CitationFacts {
  const facts: CitationFacts = { sensitivity };
  if (observation.kind === 'repo-path') {
    facts.pathExistsAtRevision = observation.pathExistsAtRevision === true;
    if (citation.lineRange) {
      facts.lineRangeInBounds =
        observation.pathExistsAtRevision === true &&
        lineRangeWithin(citation.lineRange, observation.lineCount ?? 0);
    }
    facts.revisionIsCurrent = citation.pinnedRevision === cyclePinnedRevision;
  } else if (observation.kind === 'git-revision') {
    facts.revisionIsCurrent =
      citation.pinnedRevision === cyclePinnedRevision && observation.revisionResolves === true;
  } else {
    facts.artifactExists = observation.artifactExists === true;
  }
  return facts;
}

/**
 * Resolve one citation against the cycle's pinned revision. Never throws for a
 * resolvable/unresolvable outcome: a resolved citation carries an `evidenceId`
 * whose snapshot has been persisted to machine-local evidence; a rejected one
 * carries a distinct `reason` and a single unresolvable-citation `gap`.
 */
export async function resolveOperatingCitationAtPin(
  citation: OperatingCitation,
  context: CitationResolutionContext,
): Promise<ResolvedCitation> {
  assertOperatingCitationAnchor(citation);
  const now = context.now ?? new Date();
  const citationKey = stableCitationKey(citation);
  const keyed: OperatingCitation = { ...citation, citationKey };
  const sensitivity =
    context.sensitivityFor?.(citation) ?? context.defaultSensitivity ?? 'internal';
  // A citation that passed the anchor validation always carries exactly one
  // locator, so the kind is total here (the `?? 'planr-artifact'` is unreachable
  // and only keeps the type non-nullable).
  const expectedCitationKind: CitationKind = citationKind(keyed) ?? 'planr-artifact';

  // Resolve the workspace component the locator is audited against. A citation
  // that names a component this machine cannot resolve is an honest "cannot
  // verify" (external-component-unresolved), never a fabrication.
  const component = selectCitationComponent(keyed, context);
  if (component === null) {
    const gap = await assertOperatingArtifact(
      'operating-data-gap',
      externalComponentUnresolvedGap(keyed, keyed.componentId as string, context, now),
    );
    return {
      citation: keyed,
      citationKey,
      outcome: 'rejected',
      reason: 'external-component-unresolved',
      expectedCitationKind,
      gap,
      sensitivity,
    };
  }

  const observation = await observeCitation(keyed, context, component, sensitivity);

  // Distinct dirty-working-tree classification, ahead of the path-existence
  // precedence: a cited path absent at the pin but present and uncommitted in the
  // resolved component's dirty working tree is named separately from a fabrication.
  if (
    observation.kind === 'repo-path' &&
    observation.pathExistsAtRevision === false &&
    observation.inWorkingTree === true &&
    component.descriptor.dirtyFingerprint !== null
  ) {
    const gap = await assertOperatingArtifact(
      'operating-data-gap',
      dirtyWorkingTreeGap(keyed, context, now),
    );
    return {
      citation: keyed,
      citationKey,
      outcome: 'rejected',
      reason: 'dirty-working-tree',
      expectedCitationKind,
      gap,
      sensitivity,
    };
  }

  const facts = factsFor(keyed, observation, component.descriptor.pinnedRevision, sensitivity);
  // Byte-identical to the pipeline library's `resolveOperatingCitation`: the
  // snapshot binding is `canonicalDigest({ citation, facts })` (the same JCS the
  // library computes) and the evidence id is `EVD-<hex of that digest>`. The
  // rejection reason follows the identical fail-closed precedence. A conformance
  // test pins both to the installed library's output.
  const reason = firstFailingReason(observation.kind, facts, keyed.lineRange !== undefined);
  if (reason !== null) {
    const gap = await assertOperatingArtifact(
      'operating-data-gap',
      unresolvableCitationGap(keyed, reason, context, now),
    );
    return {
      citation: keyed,
      citationKey,
      outcome: 'rejected',
      reason,
      expectedCitationKind,
      gap,
      sensitivity,
    };
  }
  const snapshotDigest = canonicalDigest({ citation: keyed, facts });
  const evidenceId = `EVD-${snapshotDigest.slice('sha256:'.length)}`;

  // Resolved: snapshot the cited bytes through the standard redaction path and
  // persist them as machine-local evidence under the resolver-minted id.
  const rawContent = observation.content ?? '';
  // Extend the redaction step (FR2): a hard-blocked secret in the cited content
  // is rejected as an `unresolvable` citation gap rather than redacted-and-
  // accepted, so a definite secret never lands in the evidence-of-record even
  // redacted. `preRedacted` planr-artifact content already passed the redaction
  // path (which fails closed on a surviving hard secret) at its source.
  if (
    !observation.preRedacted &&
    detectSecretMetadata(rawContent).some((entry) => entry.hardBlock)
  ) {
    const gap = await assertOperatingArtifact(
      'operating-data-gap',
      hardBlockedSecretGap(keyed, context, now),
    );
    return {
      citation: keyed,
      citationKey,
      outcome: 'rejected',
      reason: 'unresolvable',
      expectedCitationKind,
      gap,
      sensitivity,
    };
  }
  const content = observation.preRedacted ? rawContent : redactSensitiveText(rawContent).value;
  await context.cache.putCitationSnapshot(
    {
      evidenceId,
      citationKey,
      snapshotDigest,
      sourceLocation: observation.location ?? citationKey,
      sensitivity,
      content,
    },
    context.snapshotTtlMs ?? DEFAULT_SNAPSHOT_TTL_MS,
    now,
  );

  return {
    citation: keyed,
    citationKey,
    outcome: 'resolved',
    expectedCitationKind,
    evidenceId,
    snapshotDigest,
    sensitivity,
  };
}

/** A proposal that carries the citations an advisor returned instead of pre-loaded evidence IDs. */
export interface CitationBearingProposal {
  proposalKey: string;
  citations: OperatingCitation[];
}

export interface RejectedProposalCitation {
  proposalKey: string;
  /** The primary rejection reason (the single gap opened for this proposal). */
  reason: CitationRejectionReason;
  /**
   * The expected citation kind of the primary rejected citation (FR8), so a
   * validation error names the affected claim/action (`proposalKey`) and the
   * kind of citation that was expected without exposing the cited content.
   */
  expectedCitationKind: CitationKind;
  /** Every distinct rejection reason across the proposal's citations. */
  reasons: CitationRejectionReason[];
  gapId: string;
}

export interface ProposalCitationEnforcement<P extends CitationBearingProposal> {
  /** Proposals whose every citation resolved, with the minted evidence IDs attached. */
  accepted: Array<{ proposal: P; evidenceRefs: string[] }>;
  /** Proposals dropped before consolidation because a citation could not be resolved. */
  rejected: RejectedProposalCitation[];
  /** Exactly one unresolvable-citation gap per rejected proposal. */
  gaps: OperatingCitationGap[];
  evidenceIds: string[];
  resolutions: ResolvedCitation[];
}

/**
 * Resolve and enforce every proposal's citations before consolidation. A
 * proposal whose citations all resolve is accepted with its minted evidence IDs
 * attached; a proposal with ANY unresolvable citation is dropped and a single
 * unresolvable-citation gap is opened in its place. Nothing with an unresolved
 * citation is ever returned in `accepted`, so it can never reach consolidation.
 */
export async function enforceProposalCitations<P extends CitationBearingProposal>(
  proposals: readonly P[],
  context: CitationResolutionContext,
): Promise<ProposalCitationEnforcement<P>> {
  const accepted: Array<{ proposal: P; evidenceRefs: string[] }> = [];
  const rejected: RejectedProposalCitation[] = [];
  const gapsById = new Map<string, OperatingCitationGap>();
  const evidenceIds = new Set<string>();
  const resolutions: ResolvedCitation[] = [];

  for (const proposal of proposals) {
    const citations = Array.isArray(proposal.citations) ? proposal.citations : [];
    const proposalResolutions: ResolvedCitation[] = [];
    for (const citation of citations) {
      const resolved = await resolveOperatingCitationAtPin(citation, context);
      proposalResolutions.push(resolved);
      resolutions.push(resolved);
    }
    const rejectedCitations = proposalResolutions.filter(
      (resolution) => resolution.outcome === 'rejected',
    );
    if (rejectedCitations.length > 0) {
      // Exactly one gap per rejected proposal: the first rejected citation is the
      // representative cause and owns the opened gap.
      const primary = rejectedCitations[0];
      if (primary.gap) gapsById.set(primary.gap.id, primary.gap);
      rejected.push({
        proposalKey: proposal.proposalKey,
        reason: primary.reason as CitationRejectionReason,
        expectedCitationKind: primary.expectedCitationKind,
        reasons: [
          ...new Set(
            rejectedCitations
              .map((resolution) => resolution.reason)
              .filter((reason): reason is CitationRejectionReason => Boolean(reason)),
          ),
        ].sort(),
        gapId: primary.gap?.id ?? '',
      });
      continue;
    }
    const evidenceRefs = [
      ...new Set(
        proposalResolutions
          .map((resolution) => resolution.evidenceId)
          .filter((id): id is string => Boolean(id)),
      ),
    ].sort();
    for (const id of evidenceRefs) evidenceIds.add(id);
    accepted.push({ proposal, evidenceRefs });
  }

  return {
    accepted,
    rejected,
    gaps: [...gapsById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    evidenceIds: [...evidenceIds].sort(),
    resolutions,
  };
}
