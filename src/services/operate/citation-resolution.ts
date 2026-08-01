import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolvePipelinePackage } from '../pipeline-package-service.js';
import { resolvePlanrArtifactCitation } from './artifacts.js';
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
} from './types.js';
import { isPathInside } from './workspace.js';

/**
 * FR3 (E-003) — resolve every citation an advisor returns against the cycle's
 * pinned revision and snapshot the cited content into machine-local evidence.
 *
 * This module owns NO precedence and NO citation/gap shape. Every fact/reason
 * mapping (path → line → revision → artifact) and the canonical resolution and
 * unresolvable-citation gap records come from the installed pipeline's
 * `lib/operate/citation.mjs` (`operating-citation@1.3.0`). This module supplies
 * the facts — computed honestly against live git/`.planr/` state at the pinned
 * revision — and, on a resolved outcome, snapshots the cited bytes through the
 * standard redaction + secret-scan path before attaching the resulting evidence
 * ID to the proposal. A citation with any unresolvable component NEVER produces
 * an evidence ID: it fails closed into a gap, and its proposal never reaches
 * consolidation.
 *
 * The one classification this module adds beyond the library — which by design
 * has no repo access and cannot make it — is the DISTINCT dirty-working-tree
 * rejection. The pin is frozen at cycle start; a citation into content that is
 * present in the working tree but not committed at the pin would otherwise be
 * indistinguishable from a fabricated path. Naming it distinctly keeps a
 * legitimate finding that points at in-flight work from being silently
 * discarded as a fabrication.
 */

const DEFAULT_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1_000;

export type CitationRejectionReason =
  | 'fabricated-path'
  | 'wrong-line-range'
  | 'stale-revision'
  | 'unresolvable'
  | 'dirty-working-tree';

/** The canonical `operating-citation@1.3.0` anchor shape (exactly one locator). */
export interface OperatingCitation {
  citationKey?: string;
  repositoryPath?: string;
  lineRange?: { start: number; end: number };
  gitRevision?: string;
  planrArtifactId?: string;
  pinnedRevision: string;
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

interface CitationResolutionOutcome {
  kind: 'operating-citation-resolution';
  schemaVersion: '1.0.0';
  protocolVersion: '1.3.0';
  citationKey: string;
  outcome: 'resolved' | 'rejected';
  evidenceId?: string;
  snapshotDigest?: `sha256:${string}`;
  reason?: 'fabricated-path' | 'wrong-line-range' | 'stale-revision' | 'unresolvable';
  gapId?: string;
}

interface OperatingCitationModule {
  resolveOperatingCitation(
    citation: OperatingCitation,
    facts: CitationFacts,
  ): CitationResolutionOutcome;
  validateOperatingCitation(citation: OperatingCitation): OperatingCitation;
  buildUnresolvableCitationGap(
    citation: OperatingCitation,
    rejection: CitationResolutionOutcome,
    context: {
      cycleId: string;
      createdAt: string;
      updatedAt?: string;
      owner?: string;
      affectedRoles?: string[];
      unblocks?: string[];
    },
  ): OperatingCitationGap;
}

let cachedModule: Promise<OperatingCitationModule> | null = null;

async function loadCitationModule(): Promise<OperatingCitationModule> {
  cachedModule ??= (async () => {
    const pkg = resolvePipelinePackage(false);
    if (!pkg) {
      throw new OperateError(
        'E_PIPELINE_NOT_INSTALLED',
        'Citation resolution requires the pipeline package with Protocol v1.3 (operating-citation@1.3.0).',
      );
    }
    const modulePath = path.join(pkg.root, 'lib', 'operate', 'citation.mjs');
    const loaded = (await import(
      pathToFileURL(modulePath).href
    )) as Partial<OperatingCitationModule>;
    if (
      typeof loaded.resolveOperatingCitation !== 'function' ||
      typeof loaded.validateOperatingCitation !== 'function' ||
      typeof loaded.buildUnresolvableCitationGap !== 'function'
    ) {
      throw new OperateError(
        'E_PIPELINE_VERSION_INCOMPATIBLE',
        `Installed planr-pipeline ${pkg.version} does not export the Protocol v1.3 citation resolver.`,
      );
    }
    return loaded as OperatingCitationModule;
  })();
  return cachedModule;
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
  /** Sensitivity a snapshot inherits when the cited source declares none (defaults to `internal`). */
  defaultSensitivity?: OperatingSensitivity;
  /** Per-citation sensitivity inherited from the cited file (T-002's evidence-item sensitivity). */
  sensitivityFor?(citation: OperatingCitation): OperatingSensitivity | undefined;
}

export interface ResolvedCitation {
  citation: OperatingCitation;
  citationKey: string;
  outcome: 'resolved' | 'rejected';
  reason?: CitationRejectionReason;
  evidenceId?: string;
  snapshotDigest?: `sha256:${string}`;
  gap?: OperatingCitationGap;
  sensitivity: OperatingSensitivity;
}

function citationKind(
  citation: OperatingCitation,
): 'repo-path' | 'git-revision' | 'planr-artifact' | null {
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
  sensitivity: OperatingSensitivity,
): Promise<CitationObservation> {
  const kind = citationKind(citation);
  if (kind === 'repo-path' && citation.repositoryPath) {
    const blob = await readGitPathAtRevision(
      context.projectRoot,
      citation.pinnedRevision,
      citation.repositoryPath,
    );
    const inWorkingTree = blob.exists
      ? true
      : await workingTreeHasFile(context.projectRoot, citation.repositoryPath);
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
    const resolves = await gitRevisionResolves(context.projectRoot, citation.gitRevision);
    const summary = resolves
      ? await readGitCommitSummary(context.projectRoot, citation.gitRevision)
      : null;
    return {
      kind,
      revisionResolves: resolves,
      content: summary ?? `commit ${citation.gitRevision}`,
      location: `git:${citation.gitRevision}`,
    };
  }
  // planr-artifact
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
  const module = await loadCitationModule();
  try {
    module.validateOperatingCitation(citation);
  } catch (error) {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      `Citation is not a valid operating-citation@1.3.0 anchor: ${
        error instanceof Error ? error.message : String(error)
      }.`,
    );
  }
  const now = context.now ?? new Date();
  const citationKey = stableCitationKey(citation);
  const keyed: OperatingCitation = { ...citation, citationKey };
  const sensitivity =
    context.sensitivityFor?.(citation) ?? context.defaultSensitivity ?? 'internal';

  const observation = await observeCitation(keyed, context, sensitivity);

  // Distinct dirty-working-tree classification, ahead of the library's
  // path-existence precedence: a cited path absent at the pin but present and
  // uncommitted in a dirty working tree is named separately from a fabrication.
  if (
    observation.kind === 'repo-path' &&
    observation.pathExistsAtRevision === false &&
    observation.inWorkingTree === true &&
    context.descriptor.dirtyFingerprint !== null
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
      gap,
      sensitivity,
    };
  }

  const facts = factsFor(keyed, observation, context.descriptor.pinnedRevision, sensitivity);
  const resolution = module.resolveOperatingCitation(keyed, facts);

  if (resolution.outcome === 'rejected') {
    const gap = module.buildUnresolvableCitationGap(keyed, resolution, {
      cycleId: context.cycleId,
      createdAt: now.toISOString(),
      owner: context.owner,
      affectedRoles: context.affectedRoles,
    });
    return {
      citation: keyed,
      citationKey,
      outcome: 'rejected',
      reason: resolution.reason,
      gap,
      sensitivity,
    };
  }

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
      gap,
      sensitivity,
    };
  }
  const content = observation.preRedacted ? rawContent : redactSensitiveText(rawContent).value;
  await context.cache.putCitationSnapshot(
    {
      evidenceId: resolution.evidenceId as string,
      citationKey,
      snapshotDigest: resolution.snapshotDigest as `sha256:${string}`,
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
    evidenceId: resolution.evidenceId,
    snapshotDigest: resolution.snapshotDigest,
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
