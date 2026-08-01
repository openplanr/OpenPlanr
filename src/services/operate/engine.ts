import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { OPENPLANR_VERSION } from '../../utils/package-version.js';
import { loadConfig } from '../config-service.js';
import {
  type AdvisorAdapter,
  type AdvisorDispatchResult,
  advisorFailureGaps,
  buildAdvisorOperatingContext,
  configuredAdvisorProviderPolicy,
  createConfiguredStructuredAdapter,
  createOfflineAdvisorAdapter,
  dispatchOperatingAdvisors,
  ensureOperatingProviderConsent,
} from './advisors.js';
import { recordOperatingCadenceRun } from './cadence.js';
import { canonicalDigest, canonicalize } from './canonical.js';
import type {
  CitationBearingProposal,
  CitationResolutionContext,
  OperatingCitation,
} from './citation-resolution.js';
import { operatingProjectKey, validateOperatingConfiguration } from './config.js';
import { consolidateOperatingResults } from './consolidation.js';
import { type AppendOperatingEventInput, OperatingEventStore } from './event-store.js';
import { evidenceProjectionSources } from './evidence.js';
import { OperatingEvidenceCache } from './evidence-cache.js';
import { nextCycleId } from './ids.js';
import { enforceRecordedProposalCitations } from './interaction/action-service.js';
import {
  applyJournalTransaction,
  prepareJournalTransaction,
  readJournal,
  rollbackJournalTransaction,
} from './journal.js';
import { reconcileOperatingDecisionDeadlines } from './lifecycle.js';
import { type OperatingLock, withOperatingLock } from './lock-service.js';
import { reconcileOperatingOutcomeFiles } from './outcomes.js';
import { persistOperatingProjections } from './projection-persistence.js';
import { assertOperatingArtifact, loadOperatingProtocol } from './protocol.js';
import { maximumSensitivity } from './redaction.js';
import { createOperatingRoutePlan, nextOperatingSpecOrdinal } from './routes.js';
import {
  OPERATE_MISSION_PROTOCOL_VERSION,
  OPERATE_PROTOCOL_VERSION,
  OPERATE_SCHEMA_VERSION,
  OperateError,
  type OperatingCycleManifest,
  type OperatingDataGap,
  type OperatingDecision,
  type OperatingEvent,
  type OperatingEvidence,
  type OperatingEvidenceItem,
  type OperatingEvidenceReadiness,
  type OperatingFinding,
  type OperatingLocalPreferences,
  type OperatingProviderManifest,
  type OperatingRoleId,
  type OperatingRoleResult,
  type OperatingRoutePlan,
  type OperatingSensitivity,
  type OperatingState,
  type OperatingWorkspaceManifest,
} from './types.js';
import {
  assertOperatingProject,
  refreshOperatingWorkspaceManifest,
  resolveOperatingPaths,
} from './workspace.js';

export interface RunOperatingCycleInput {
  projectRoot: string;
  cycleId?: string;
  focus?: OperatingCycleManifest['focus'];
  depth?: OperatingCycleManifest['depth'];
  runtime?: string;
  offline?: boolean;
  reviewOnly?: boolean;
  preview?: boolean;
  dryRun?: boolean;
  confirmed?: boolean;
  quiet?: boolean;
  localRoot?: string;
  now?: Date;
  adapter?: AdvisorAdapter;
  /** Stop after preparing a cycle when a certified runtime executes mandates. */
  deferAdvisors?: boolean;
}

export interface NativeAdvisorHandoff {
  phase: 'advisors' | 'chair';
  cycleId: string;
  evidenceDigest: `sha256:${string}`;
  roles: string[];
}

export interface RunOperatingCycleResult {
  preview: boolean;
  dryRun: boolean;
  cycle: OperatingCycleManifest;
  evidence?: OperatingEvidence;
  readiness?: OperatingEvidenceReadiness;
  roleResults?: OperatingRoleResult[];
  findings?: OperatingFinding[];
  decisions?: OperatingDecision[];
  gaps?: OperatingDataGap[];
  routes?: OperatingRoutePlan[];
  provider?: OperatingProviderManifest | null;
  state?: OperatingState;
  modelCalls: number;
  warnings: string[];
  nativeHandoff?: NativeAdvisorHandoff;
  /** Per-role isolation provenance from this run's mandate dispatch. */
  dispatchProvenance?: AdvisorDispatchResult['provenance'];
}

function normalizeFocus(
  focus: OperatingCycleManifest['focus'] | undefined,
): OperatingCycleManifest['focus'] {
  const supported = new Set(['strategy', 'product', 'growth', 'operations', 'technology', 'all']);
  const normalized = [...new Set((focus ?? []).map(String))]
    .filter((value) => supported.has(value))
    .sort() as OperatingCycleManifest['focus'];
  return normalized.length > 0 ? normalized : ['all'];
}

function loadJson<T>(target: string): Promise<T> {
  return readFile(target, 'utf8').then((raw) => JSON.parse(raw) as T);
}

async function snapshotWorkspace(
  projectRoot: string,
  localRoot?: string,
): Promise<OperatingWorkspaceManifest> {
  return refreshOperatingWorkspaceManifest(projectRoot, { localRoot });
}

async function readPreferences(
  projectRoot: string,
  localRoot?: string,
): Promise<OperatingLocalPreferences> {
  const paths = resolveOperatingPaths(projectRoot, { localRoot });
  return loadJson<OperatingLocalPreferences>(path.join(paths.localRoot, 'preferences.json')).catch(
    () => ({
      runtime: 'auto',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      sensitivityCeiling: 'internal',
      evidenceTtlMs: 7 * 24 * 60 * 60 * 1_000,
      enabledSources: [],
    }),
  );
}

function activeCycle(
  state: OperatingState,
): (OperatingState['cycles'][number] & Record<string, unknown>) | null {
  return (
    state.cycles.find((cycle) => !['closed', 'cancelled', 'failed'].includes(cycle.state)) ?? null
  );
}

function maximumOrdinal(records: Array<Record<string, unknown>>, prefix: string): number {
  return records.reduce((maximum, record) => {
    const match = String(record.id ?? '').match(new RegExp(`^${prefix}-(\\d+)$`));
    return Math.max(maximum, match ? Number(match[1]) : 0);
  }, 0);
}

async function remapReadinessGaps(
  readiness: OperatingEvidenceReadiness,
  state: OperatingState,
): Promise<OperatingEvidenceReadiness> {
  let ordinal = maximumOrdinal(state.dataGaps, 'GAP');
  const remapped: OperatingEvidenceReadiness = {
    ...readiness,
    roles: readiness.roles.map((role) => ({
      ...role,
      gapId: role.gapId
        ? (state.dataGaps.find(
            (gap) =>
              gap.cycleId === readiness.cycleId &&
              !['closed', 'superseded'].includes(String(gap.status)) &&
              Array.isArray(gap.affectedRoles) &&
              gap.affectedRoles.includes(role.roleId),
          )?.id ?? `GAP-${String(++ordinal).padStart(3, '0')}`)
        : null,
    })),
  };
  return assertOperatingArtifact('operating-evidence-readiness', remapped);
}

function readinessGaps(
  readiness: OperatingEvidenceReadiness,
  decisionOwner: string,
  now: string,
): OperatingDataGap[] {
  return readiness.roles
    .filter((role) => role.gapId)
    .map((role) => ({
      kind: 'operating-data-gap' as const,
      schemaVersion: OPERATE_SCHEMA_VERSION,
      protocolVersion: OPERATE_PROTOCOL_VERSION,
      id: role.gapId as string,
      cycleId: readiness.cycleId,
      question: `What evidence is required for ${role.roleId}?`,
      reason: role.missingEvidence.join('; ') || 'Minimum evidence was not available.',
      unblocks: [],
      affectedRoles: [role.roleId],
      status: 'open' as const,
      owner: decisionOwner,
      evidenceRefs: [...role.evidenceRefs],
      createdAt: now,
      updatedAt: now,
    }));
}

// Retained callerless: this fed the collector's `requiredEvidenceRefs` input,
// which the pinned-revision seed no longer takes. The collector and its dedicated
// feeders are retired wholesale in T-009; nothing is deleted here.
// biome-ignore lint/correctness/noUnusedVariables: retained pending collector retirement (T-009)
function requiredOpenEvidenceRefs(state: OperatingState): string[] {
  const records = [
    ...state.findings.filter(
      (finding) => !['done', 'rejected', 'superseded'].includes(String(finding.status)),
    ),
    ...state.decisions.filter(
      (decision) => !['closed', 'superseded'].includes(String(decision.status)),
    ),
    ...state.outcomes.filter((outcome) =>
      ['pending', 'observing', 'inconclusive'].includes(String(outcome.status)),
    ),
  ];
  return [
    ...new Set(
      records.flatMap((record) =>
        Array.isArray(record.evidenceRefs)
          ? record.evidenceRefs.filter(
              (reference): reference is string => typeof reference === 'string',
            )
          : [],
      ),
    ),
  ].sort();
}

export function buildChairEvidence(
  evidence: OperatingEvidence,
  results: OperatingRoleResult[],
  now: string,
): OperatingEvidence {
  const evidenceById = new Map(evidence.items.map((item) => [item.id, item]));
  const synthetic = results.flatMap((result) => {
    const evidenceRefs = [
      ...new Set(result.proposals.flatMap((proposal) => proposal.evidenceRefs)),
    ].sort();
    const missingRefs = evidenceRefs.filter((reference) => !evidenceById.has(reference));
    if (missingRefs.length > 0) {
      throw new OperateError(
        'E_OPERATE_EVIDENCE_REJECTED',
        `${result.roleId} advisor result cites unavailable evidence: ${missingRefs.join(', ')}.`,
      );
    }
    const sensitivity = maximumSensitivity([
      'internal',
      ...evidenceRefs.map((reference) => evidenceById.get(reference)?.sensitivity ?? 'public'),
    ]);
    const bodies = [
      {
        id: `EVD-advisor-results-${result.roleId}-context`,
        location: `${result.roleId}/context`,
        body: {
          roleId: result.roleId,
          outcome: result.outcome,
          gaps: [...new Set(result.gaps)].sort(),
          conflicts: [...new Set(result.conflicts)].sort(),
        },
      },
      ...result.proposals.map((proposal) => ({
        id: `EVD-advisor-results-${result.roleId}-${proposal.proposalKey}`,
        location: `${result.roleId}/proposals/${proposal.proposalKey}`,
        body: {
          roleId: result.roleId,
          proposal: structuredClone(proposal),
        },
      })),
    ];
    return bodies.map(({ id, location, body }) => ({
      id,
      source: 'advisor-results',
      location,
      digest: canonicalDigest(body),
      collectedAt: now,
      observedFrom: now,
      observedTo: now,
      freshness: 'fresh' as const,
      sensitivity,
      claimTypes: ['verified-advisor-result'],
      summary: canonicalize(body),
    }));
  });
  return {
    ...evidence,
    items: [...evidence.items, ...synthetic],
    fingerprint: canonicalDigest({
      source: evidence.fingerprint,
      advisors: synthetic
        .map(({ id, digest, sensitivity }) => ({ id, digest, sensitivity }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    }),
  };
}

/**
 * FR1/FR2 (isolation rebind): the cycle's pinned-revision evidence seed. Evidence
 * is an OUTPUT now, so a fresh cycle no longer collects a body-bearing snapshot
 * before anyone has investigated; it seeds an empty evidence-of-record whose
 * fingerprint binds the cycle to its control-repository pinned revision. This
 * seed is what the adapter isolation binds to (`persistedAdapterEvidence`'s
 * fingerprint === the prepared session's `evidenceDigest`), so a tampered or
 * revision-mismatched session still fails closed with `E_OPERATE_ADVISOR_ISOLATION`
 * — the guarantee is preserved, only its input is the pinned revision rather than
 * a collected-evidence digest. Nothing is guessed, budgeted, or packed.
 */
async function buildPinnedRevisionEvidenceSeed(input: {
  cycleId: string;
  pinnedRevision: string;
  collectedAt: string;
}): Promise<OperatingEvidence> {
  return assertOperatingArtifact('operating-evidence', {
    kind: 'operating-evidence',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    cycleId: input.cycleId,
    fingerprint: canonicalDigest({
      cycleId: input.cycleId,
      pinnedRevision: input.pinnedRevision,
    }),
    collectedAt: input.collectedAt,
    truncated: false,
    items: [],
    sources: [],
    warnings: [],
  } satisfies OperatingEvidence);
}

/**
 * FR2: dispatch is no longer pre-gated on collected evidence — every enabled role
 * is dispatched with a mandate and post-gated on what its response actually cites.
 * This builds the "all roles runnable" readiness the dispatch consumes, replacing
 * the collector-era evidence-readiness evaluation.
 */
async function buildDispatchReadiness(input: {
  cycleId: string;
  roles: OperatingRoleId[];
  pinnedRevision: string;
  sensitivityCeiling: OperatingSensitivity;
  now: Date;
}): Promise<OperatingEvidenceReadiness> {
  const hasPinnedRevision = !/^0+$/.test(input.pinnedRevision);
  return assertOperatingArtifact('operating-evidence-readiness', {
    kind: 'operating-evidence-readiness',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    cycleId: input.cycleId,
    inputDigest: canonicalDigest({ cycleId: input.cycleId, roles: [...input.roles].sort() }),
    evaluatedAt: input.now.toISOString(),
    roles: input.roles.map((roleId, index) => ({
      roleId,
      readiness: 'ready' as const,
      requirements: [
        {
          source: 'mandate',
          claimTypes: ['resolvable-citation-required'],
          minimumItems: 1,
          observedItems: hasPinnedRevision ? 1 : 0,
          maxAgeHours: 8760,
          oldestAgeHours: hasPinnedRevision ? 0 : null,
          observationWindow: 'current-cycle' as const,
          sensitivityCeiling: input.sensitivityCeiling,
          satisfied: hasPinnedRevision,
        },
      ],
      missingEvidence: hasPinnedRevision
        ? []
        : ['mandate:resolvable-citation-required (0/1; no pinned revision)'],
      evidenceRefs: [],
      modelCallAllowed: hasPinnedRevision,
      gapId: hasPinnedRevision ? null : `GAP-${String(index + 1).padStart(3, '0')}`,
    })),
  });
}

/**
 * FR2 (evidence-as-output): assemble the cycle's evidence-of-record for
 * consolidation from the resolved-citation snapshots the universal gate minted.
 * Every evidenceRef a gated proposal carries was snapshotted to machine-local
 * evidence (`putCitationSnapshot`); this reads each back (`getCitationSnapshot`)
 * so downstream confidence/sensitivity/freshness scoring resolves against what
 * was actually cited and verified rather than a pre-collected guess. A ref whose
 * snapshot is unreadable still materializes a minimal item so consolidation never
 * rejects a legitimately-minted reference.
 */
async function assembleCitationEvidence(input: {
  cycleId: string;
  roleResults: OperatingRoleResult[];
  cache: OperatingEvidenceCache;
  baseFingerprint: `sha256:${string}`;
  now: string;
}): Promise<OperatingEvidence> {
  const refs = [
    ...new Set(
      input.roleResults.flatMap((result) =>
        result.proposals.flatMap((proposal) => proposal.evidenceRefs),
      ),
    ),
  ].sort();
  const items: OperatingEvidenceItem[] = [];
  for (const ref of refs) {
    const snapshot = await input.cache.getCitationSnapshot(ref);
    items.push({
      id: ref,
      source: 'citation',
      location: snapshot?.sourceLocation ?? ref,
      digest: canonicalDigest(snapshot?.content ?? ref),
      collectedAt: input.now,
      observedFrom: null,
      observedTo: null,
      freshness: 'fresh',
      sensitivity: snapshot?.sensitivity ?? 'internal',
      claimTypes: ['verified-citation'],
      ...(snapshot ? { summary: snapshot.content.slice(0, 512) } : {}),
    });
  }
  return assertOperatingArtifact('operating-evidence', {
    kind: 'operating-evidence',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    cycleId: input.cycleId,
    fingerprint: canonicalDigest({
      source: input.baseFingerprint,
      citations: items.map((item) => ({ id: item.id, digest: item.digest })),
    }),
    collectedAt: input.now,
    truncated: false,
    items,
    sources: [],
    warnings: [],
  } satisfies OperatingEvidence);
}

const SENSITIVE_ROUTE_LANGUAGE =
  /\b(?:payment|billing|security|privacy|legal|tenant|isolation|destructive|delete|purge|credential|secret)\b/i;

function containsSensitiveRouteProposal(results: OperatingRoleResult[]): boolean {
  return results.some((result) =>
    result.proposals.some((proposal) =>
      SENSITIVE_ROUTE_LANGUAGE.test(
        `${proposal.type} ${proposal.title} ${proposal.problem} ${proposal.proposal}`,
      ),
    ),
  );
}

async function createCycleManifest(input: {
  id: string;
  state: OperatingCycleManifest['state'];
  depth: OperatingCycleManifest['depth'];
  focus: OperatingCycleManifest['focus'];
  inputDigest: `sha256:${string}`;
  enabledRoles: string[];
  enabledProviders: string[];
  runtime: string;
  now: string;
}): Promise<OperatingCycleManifest> {
  return assertOperatingArtifact('operating-cycle-manifest', {
    kind: 'operating-cycle-manifest',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    id: input.id,
    state: input.state,
    depth: input.depth,
    focus: input.focus,
    inputDigest: input.inputDigest,
    enabledRoles: [...input.enabledRoles],
    enabledProviders: [...input.enabledProviders],
    createdAt: input.now,
    updatedAt: input.now,
    producer: {
      product: 'openplanr',
      version: OPENPLANR_VERSION,
      runtime: input.runtime,
    },
  } satisfies OperatingCycleManifest);
}

async function appendLocked(
  store: OperatingEventStore,
  lock: OperatingLock,
  head: { sequence: number; hash: `sha256:${string}` | null },
  input: AppendOperatingEventInput,
): Promise<{ event: OperatingEvent; head: { sequence: number; hash: `sha256:${string}` } }> {
  const event = await store.append({ ...input, expectedHead: head.hash });
  const next = { sequence: event.sequence, hash: event.eventHash };
  await lock.advanceEventHead(head, next);
  return { event, head: next };
}

function remapConsolidation(
  state: OperatingState,
  findings: OperatingFinding[],
  parked: OperatingFinding[],
  decisions: OperatingDecision[],
  gaps: OperatingDataGap[],
): {
  findings: OperatingFinding[];
  parked: OperatingFinding[];
  decisions: OperatingDecision[];
  gaps: OperatingDataGap[];
} {
  let findingOrdinal = maximumOrdinal(state.findings, 'FND');
  let decisionOrdinal = maximumOrdinal(state.decisions, 'DEC');
  let gapOrdinal = maximumOrdinal(state.dataGaps, 'GAP');
  const findingIds = new Map<string, string>();
  for (const finding of [...findings, ...parked]) {
    findingIds.set(finding.id, `FND-${String(++findingOrdinal).padStart(3, '0')}`);
  }
  const remapFinding = (finding: OperatingFinding): OperatingFinding => ({
    ...finding,
    id: findingIds.get(finding.id) as string,
    dependsOn: finding.dependsOn.map((dependency) => findingIds.get(dependency) ?? dependency),
  });
  return {
    findings: findings.map(remapFinding),
    parked: parked.map(remapFinding),
    decisions: decisions.map((decision) => ({
      ...decision,
      id: `DEC-${String(++decisionOrdinal).padStart(3, '0')}`,
    })),
    gaps: gaps.map((gap) => ({
      ...gap,
      id: `GAP-${String(++gapOrdinal).padStart(3, '0')}`,
    })),
  };
}

function findingIdentity(value: unknown): `sha256:${string}` {
  const finding = value as Record<string, unknown>;
  if (
    typeof finding.fingerprint === 'string' &&
    /^sha256:[a-f0-9]{64}$/.test(finding.fingerprint)
  ) {
    return finding.fingerprint as `sha256:${string}`;
  }
  return canonicalDigest({
    title: String(finding.title ?? '')
      .trim()
      .toLowerCase(),
    lane: String(finding.lane ?? ''),
    owner: String(finding.owner ?? ''),
  });
}

function suppressRepeatedFindings(
  state: OperatingState,
  findings: OperatingFinding[],
  cycleId: string,
): { findings: OperatingFinding[]; suppressed: number } {
  const priorByIdentity = new Map(
    state.findings
      .filter((finding) => finding.cycleId !== cycleId)
      .map((finding) => [findingIdentity(finding), finding]),
  );
  let suppressed = 0;
  const retained: OperatingFinding[] = [];
  for (const finding of findings) {
    const prior = priorByIdentity.get(findingIdentity(finding));
    if (!prior) {
      retained.push(finding);
      continue;
    }
    const priorEvidence = Array.isArray(prior.evidenceRefs)
      ? [...(prior.evidenceRefs as string[])].sort()
      : [];
    const currentEvidence = [...finding.evidenceRefs].sort();
    if (canonicalDigest(priorEvidence) === canonicalDigest(currentEvidence)) {
      suppressed += 1;
      continue;
    }
    retained.push({
      ...finding,
      dependsOn: [...new Set([...finding.dependsOn, String(prior.id)])].sort(),
    });
  }
  return { findings: retained, suppressed };
}

function committedCycleFindings(events: OperatingEvent[], cycleId: string): OperatingFinding[] {
  return events
    .filter(
      (event) =>
        event.type === 'finding.proposed' &&
        event.cycleId === cycleId &&
        event.payload.record &&
        typeof event.payload.record === 'object',
    )
    .map((event) => structuredClone(event.payload.record) as OperatingFinding);
}

function reconcileCycleFindings(
  events: OperatingEvent[],
  cycleId: string,
  findings: OperatingFinding[],
): OperatingFinding[] {
  const existing = committedCycleFindings(events, cycleId);
  const existingByIdentity = new Map(
    existing.map((finding) => [findingIdentity(finding), finding]),
  );
  return findings.map((finding) => {
    const prior = existingByIdentity.get(findingIdentity(finding));
    if (!prior) return finding;
    return canonicalDigest([...prior.evidenceRefs].sort()) ===
      canonicalDigest([...finding.evidenceRefs].sort())
      ? prior
      : finding;
  });
}

function recordContent(value: object): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>;
}

async function persistedCycleEvidence(
  store: OperatingEventStore,
  events: OperatingEvent[],
  cycleId: string,
): Promise<OperatingEvidence | null> {
  const event = [...events]
    .reverse()
    .find(
      (candidate) =>
        candidate.cycleId === cycleId &&
        candidate.type === 'evidence.collected' &&
        typeof candidate.payload.recordDigest === 'string',
    );
  if (!event) return null;
  const record = await store.readRecord(event.payload.recordDigest as `sha256:${string}`);
  if (record.recordType !== 'evidence-metadata') {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      `Cycle ${cycleId} evidence event references a ${record.recordType} record.`,
    );
  }
  return assertOperatingArtifact<OperatingEvidence>(
    'operating-evidence',
    record.content as unknown as OperatingEvidence,
  );
}

async function persistedCycleRoleResults(
  store: OperatingEventStore,
  events: OperatingEvent[],
  cycleId: string,
): Promise<OperatingRoleResult[]> {
  const byRole = new Map<string, OperatingRoleResult>();
  for (const event of events) {
    if (
      event.cycleId !== cycleId ||
      event.type !== 'advisory.recorded' ||
      typeof event.payload.recordDigest !== 'string'
    ) {
      continue;
    }
    const record = await store.readRecord(event.payload.recordDigest as `sha256:${string}`);
    if (record.recordType !== 'advisor-result') {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        `Cycle ${cycleId} advisory event references a ${record.recordType} record.`,
      );
    }
    const result = await assertOperatingArtifact<OperatingRoleResult>(
      'operating-role-result',
      record.content as unknown as OperatingRoleResult,
    );
    (await loadOperatingProtocol()).validateOperatingRoleResultDigest(result);
    if (result.cycleId !== cycleId) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        `Advisor result ${result.roleId} belongs to another cycle.`,
      );
    }
    byRole.set(result.roleId, result);
  }
  return [...byRole.values()].sort((left, right) => left.roleId.localeCompare(right.roleId));
}

/**
 * Full evidence → advisors → deterministic consolidation lifecycle. All
 * mutations are serialized under the process-identity lease; preview and
 * dry-run never enter the mutating branch.
 */
/**
 * The single governed gap opened for a role whose citation-bearing response
 * grounded zero evidence (FR2). It names the role and its empty grounding so the
 * integrity surface can render the role `not_evaluated` with a real reason rather
 * than a silent absence or a "quiet" that pretends the lens evaluated.
 */
function roleEmptyGroundingGap(
  roleId: string,
  context: CitationResolutionContext,
  now: Date,
): OperatingDataGap {
  const createdAt = now.toISOString();
  return {
    kind: 'operating-data-gap',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_MISSION_PROTOCOL_VERSION,
    id: `GAP-${canonicalDigest({
      roleId,
      cycleId: context.cycleId,
      reason: 'empty-grounding',
    }).slice('sha256:'.length)}`,
    cycleId: context.cycleId,
    category: 'missing-evidence',
    question: `What evidence can ${roleId} cite? Its response resolved zero citations to evidence.`,
    reason:
      `Every citation ${roleId} returned failed to resolve at the pinned revision, so the role ` +
      'grounded no evidence and is recorded not_evaluated instead of dispatching a proposal on an ' +
      'empty base.',
    unblocks: [],
    affectedRoles: [roleId],
    status: 'open',
    owner: context.owner && context.owner.length > 0 ? context.owner : 'chair',
    evidenceRefs: [],
    createdAt,
    updatedAt: createdAt,
  } as unknown as OperatingDataGap;
}

/**
 * FR2 universal citation gate — the PRIMARY, unconditional mechanism, run on
 * every dispatch path and every evidence source (no `bearing.length === 0`
 * bypass remains, so it is entered even for a citation-free result).
 *
 * Every recorded proposal that carries citations is resolved against the cycle's
 * pinned revision through `enforceRecordedProposalCitations`. A proposal with ANY
 * unresolvable citation is DROPPED — it never reaches `consolidateOperatingResults`
 * — and exactly one `unresolvable-citation` gap is opened in its place. A proposal
 * whose citations all resolve keeps its minted evidence IDs.
 *
 * On top of that per-proposal gate, the FR2 role-level rule: a role result whose
 * proposals carried citations but whose accepted citations resolve to ZERO
 * evidence IDs is `not_evaluated` — every one of its proposals is dropped, its id
 * is returned in `notEvaluatedRoleIds`, and one governed `missing-evidence` gap
 * naming the role and its empty grounding is opened. This replaces SPEC-003's
 * mission-only, repository-only starvation gate with one rule that holds whatever
 * the dispatch path or evidence source. A v1.2 pack result (evidenceRefs, no
 * citations) carries no citation-bearing proposal, so it is never demoted — the
 * pack path stays functional until T-003 removes it.
 */
export async function gateRecordedProposalCitations(input: {
  roleResults: OperatingRoleResult[];
  context: CitationResolutionContext;
}): Promise<{
  roleResults: OperatingRoleResult[];
  gaps: OperatingDataGap[];
  notEvaluatedRoleIds: string[];
}> {
  const bearing: CitationBearingProposal[] = [];
  const citationBearingProposalKeys = new Set<string>();
  for (const result of input.roleResults) {
    for (const proposal of result.proposals) {
      const citations = (proposal as { citations?: OperatingCitation[] }).citations;
      if (Array.isArray(citations) && citations.length > 0) {
        bearing.push({ proposalKey: proposal.proposalKey, citations });
        citationBearingProposalKeys.add(proposal.proposalKey);
      }
    }
  }

  const enforcement = await enforceRecordedProposalCitations(bearing, input.context);
  const rejectedKeys = new Set(enforcement.rejected.map((entry) => entry.proposalKey));
  const evidenceByKey = new Map(
    enforcement.accepted.map((entry) => [entry.proposal.proposalKey, entry.evidenceRefs]),
  );
  const gaps: OperatingDataGap[] = [...(enforcement.gaps as unknown as OperatingDataGap[])];
  const notEvaluatedRoleIds: string[] = [];
  const now = input.context.now ?? new Date();
  const roleResults = await Promise.all(
    input.roleResults.map(async (result) => {
      const gated = {
        ...result,
        proposals: result.proposals
          .filter((proposal) => !rejectedKeys.has(proposal.proposalKey))
          .map((proposal) => {
            const minted = evidenceByKey.get(proposal.proposalKey);
            return minted && minted.length > 0
              ? {
                  ...proposal,
                  evidenceRefs: [...new Set([...proposal.evidenceRefs, ...minted])].sort(),
                }
              : proposal;
          }),
      };
      // FR2 role-level rule: a role whose proposals were citation-bearing but
      // grounded ZERO evidence after resolution is not_evaluated. Drop its
      // surviving (evidence-free) proposals and open one governed gap.
      const wasCitationBearing = result.proposals.some((proposal) =>
        citationBearingProposalKeys.has(proposal.proposalKey),
      );
      const mintedAny = gated.proposals.some((proposal) => proposal.evidenceRefs.length > 0);
      if (wasCitationBearing && !mintedAny) {
        notEvaluatedRoleIds.push(result.roleId);
        gaps.push(
          await assertOperatingArtifact(
            'operating-data-gap',
            roleEmptyGroundingGap(result.roleId, input.context, now),
          ),
        );
        return { ...gated, proposals: [] };
      }
      return gated;
    }),
  );
  return { roleResults, gaps, notEvaluatedRoleIds };
}

export async function runOperatingCycle(
  input: RunOperatingCycleInput,
): Promise<RunOperatingCycleResult> {
  const projectRoot = await assertOperatingProject(input.projectRoot);
  const config = await validateOperatingConfiguration(projectRoot);
  const paths = resolveOperatingPaths(projectRoot, { localRoot: input.localRoot });
  const initializedWorkspace = await loadJson<OperatingWorkspaceManifest>(paths.workspace);
  await assertOperatingArtifact('operating-workspace-manifest', initializedWorkspace);
  const preferences = await readPreferences(projectRoot, input.localRoot);
  const store = new OperatingEventStore(projectRoot, { localRoot: input.localRoot });
  const now = input.now ?? new Date();
  const deadlineReconciliation =
    !input.preview && !input.dryRun
      ? await reconcileOperatingDecisionDeadlines({
          projectRoot,
          localRoot: input.localRoot,
          now,
        })
      : { transitioned: 0 };
  const initial = await store.replay();
  const initialState = await store.state();
  const current = activeCycle(initialState);
  const timestamp = now.toISOString();
  if (input.cycleId && current?.id !== input.cycleId) {
    throw new OperateError(
      'E_OPERATE_CYCLE_INPUT_CONFLICT',
      current
        ? `Operating continuation is bound to ${input.cycleId}, but ${current.id} is active.`
        : `Operating continuation is bound to ${input.cycleId}, but no resumable cycle is active.`,
      {
        expectedCycleId: input.cycleId,
        activeCycleId: current?.id ?? null,
      },
    );
  }
  if (input.reviewOnly) {
    const persisted = initialState.cycles.at(-1);
    if (!persisted) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        'Review-only mode requires at least one committed operating cycle.',
      );
    }
    const persistedCycle = await assertOperatingArtifact<OperatingCycleManifest>(
      'operating-cycle-manifest',
      persisted as unknown as OperatingCycleManifest,
    );
    const reconciled = input.dryRun
      ? { reconciled: 0, shipObserved: 0, state: initialState }
      : await reconcileOperatingOutcomeFiles({
          projectRoot,
          localRoot: input.localRoot,
        });
    return {
      preview: false,
      dryRun: Boolean(input.dryRun),
      cycle: persistedCycle,
      provider: null,
      state: reconciled.state,
      modelCalls: 0,
      warnings: [
        `Review-only mode reconciled ${reconciled.reconciled} outcome observation(s) without evidence or model calls.`,
        ...(deadlineReconciliation.transitioned > 0
          ? [
              `Marked ${deadlineReconciliation.transitioned} elapsed decision deadline(s) default-due without executing an action.`,
            ]
          : []),
      ],
    };
  }
  const resumableStates = new Set([
    'preparing',
    'collecting',
    'advising',
    'consolidating',
    'blocked',
  ]);
  if (current && !resumableStates.has(current.state)) {
    throw new OperateError(
      'E_OPERATE_CYCLE_ACTIVE',
      `Operating cycle ${current.id} is already ${current.state}; close or cancel it before starting another.`,
    );
  }
  const depth =
    input.depth ?? (current?.depth as OperatingCycleManifest['depth'] | undefined) ?? 'standard';
  const focus = normalizeFocus(
    input.focus ?? (current?.focus as OperatingCycleManifest['focus'] | undefined),
  );
  const currentProducer = current ? (current as unknown as OperatingCycleManifest).producer : null;
  const requestedRuntime =
    input.runtime && input.runtime !== 'auto' ? input.runtime : preferences.runtime;
  if (current && requestedRuntime !== 'auto' && requestedRuntime !== currentProducer?.runtime) {
    throw new OperateError(
      'E_OPERATE_CYCLE_INPUT_CONFLICT',
      `Operating cycle ${current.id} is bound to runtime ${currentProducer?.runtime}, not ${requestedRuntime}.`,
    );
  }
  const resolvedRuntime = currentProducer?.runtime ?? requestedRuntime;
  const cycleStart = current
    ? initial.events.find(
        (event) =>
          event.type === 'cycle.preparing' &&
          event.cycleId === current.id &&
          event.entityId === current.id,
      )
    : null;
  if (current && !cycleStart) {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      `Operating cycle ${current.id} has no canonical preparing event.`,
    );
  }
  const inputHead = cycleStart
    ? {
        sequence: cycleStart.sequence - 1,
        hash: cycleStart.previousEventHash,
      }
    : initial.eventHead;
  // Preview is intentionally machine-state-free: it does not require local
  // component-root mappings and binds only a prospective digest. A committed
  // cycle always snapshots the live roots at its actual start.
  const workspace = input.preview
    ? initializedWorkspace
    : await snapshotWorkspace(projectRoot, input.localRoot);
  const inputDigest = canonicalDigest({
    workspaceDigest: workspace.workspaceDigest,
    config: canonicalDigest(config),
    eventHead: inputHead,
    depth,
    focus,
    runtime: resolvedRuntime,
  });
  if (current && current.inputDigest !== inputDigest) {
    throw new OperateError(
      'E_OPERATE_CYCLE_INPUT_CONFLICT',
      `Operating cycle ${current.id} can resume only with its original workspace, configuration, depth, and focus.`,
      {
        cycleId: current.id,
        expectedInputDigest: current.inputDigest,
        actualInputDigest: inputDigest,
      },
    );
  }
  const cycle = current
    ? await assertOperatingArtifact<OperatingCycleManifest>(
        'operating-cycle-manifest',
        current as unknown as OperatingCycleManifest,
      )
    : await createCycleManifest({
        id: nextCycleId(initialState),
        state: 'preparing',
        depth,
        focus,
        inputDigest,
        enabledRoles: config.enabledRoles,
        enabledProviders: config.enabledProviders,
        runtime: resolvedRuntime,
        now: timestamp,
      });
  if (input.preview) {
    return {
      preview: true,
      dryRun: false,
      cycle,
      provider: null,
      modelCalls: 0,
      warnings: [],
    };
  }
  const assertCycleWorkspace = async (): Promise<void> => {
    const observed = await snapshotWorkspace(projectRoot, input.localRoot);
    if (observed.workspaceDigest !== workspace.workspaceDigest) {
      throw new OperateError(
        'E_OPERATE_HEAD_DIVERGED',
        'Workspace revisions, branches, remotes, or material dirty fingerprints changed during the operating cycle.',
        {
          expectedWorkspaceDigest: workspace.workspaceDigest,
          actualWorkspaceDigest: observed.workspaceDigest,
        },
      );
    }
  };
  const existingEvidence =
    current && current.state !== 'blocked'
      ? await persistedCycleEvidence(store, initial.events, cycle.id)
      : null;
  const existingRoleResults = current
    ? await persistedCycleRoleResults(store, initial.events, cycle.id)
    : [];
  const advisorContext = await buildAdvisorOperatingContext({
    charterPath: paths.charter,
    state: initialState,
    cycleId: cycle.id,
  });

  const citationCache = new OperatingEvidenceCache(
    resolveOperatingPaths(projectRoot, { localRoot: input.localRoot }).evidence,
    preferences.sensitivityCeiling,
  );
  // FR2 universal gate, bound to the cycle's pinned revision. Injected into
  // dispatch so advisors.ts never imports engine.ts, and reused by the
  // consolidation-time gate below so both paths resolve citations identically.
  const resolveCitations = (
    roleResults: OperatingRoleResult[],
  ): ReturnType<typeof gateRecordedProposalCitations> =>
    gateRecordedProposalCitations({
      roleResults,
      context: {
        projectRoot,
        cycleId: cycle.id,
        descriptor: workspace.controlRepository,
        cache: citationCache,
        owner: config.decisionOwner,
        now,
      },
    });
  const evaluate = async (persist: boolean): Promise<Omit<RunOperatingCycleResult, 'state'>> => {
    await assertCycleWorkspace();
    const evidence =
      existingEvidence ??
      (await buildPinnedRevisionEvidenceSeed({
        cycleId: cycle.id,
        pinnedRevision: workspace.controlRepository.pinnedRevision,
        collectedAt: timestamp,
      }));
    const evidenceGaps: OperatingDataGap[] = [];
    const nonChair = config.enabledRoles.filter((role) => role !== 'chair');
    let readiness = await buildDispatchReadiness({
      cycleId: cycle.id,
      roles: nonChair,
      pinnedRevision: workspace.controlRepository.pinnedRevision,
      sensitivityCeiling: preferences.sensitivityCeiling,
      now,
    });
    readiness = await remapReadinessGaps(readiness, initialState);
    let adapter = input.adapter ?? null;
    let provider: OperatingProviderManifest | null = null;
    const resolveAdapter = async (): Promise<AdvisorAdapter> => {
      if (adapter) return adapter;
      if (input.offline) {
        adapter = createOfflineAdvisorAdapter();
        return adapter;
      }
      adapter = await createConfiguredStructuredAdapter(projectRoot, {
        quiet: input.quiet,
      });
      const openPlanrConfig = await loadConfig(projectRoot);
      const consent = await ensureOperatingProviderConsent({
        projectRoot,
        provider: configuredAdvisorProviderPolicy({
          config: openPlanrConfig,
          adapterId: adapter.id,
          runtime: resolvedRuntime,
        }),
        confirmed: Boolean(input.confirmed),
        persist,
        now: timestamp,
      });
      provider = consent.manifest;
      return adapter;
    };
    const existingByRole = new Map(existingRoleResults.map((result) => [result.roleId, result]));
    const missingNonChair = readiness.roles.filter(
      (role) => role.roleId !== 'chair' && !existingByRole.has(role.roleId),
    );
    const runnableMissingNonChair = missingNonChair.filter((role) => role.modelCallAllowed);
    const skippedMissingNonChair = missingNonChair
      .filter((role) => !role.modelCallAllowed || role.readiness === 'not_evaluated')
      .map((role) => ({
        roleId: role.roleId,
        gapId: role.gapId as string,
        reason: role.missingEvidence.join('; '),
      }));
    if (input.deferAdvisors && runnableMissingNonChair.length > 0) {
      return {
        preview: false,
        dryRun: false,
        cycle,
        evidence,
        readiness,
        roleResults: existingRoleResults.filter((result) => result.roleId !== 'chair'),
        findings: [],
        decisions: [],
        gaps: readinessGaps(readiness, config.decisionOwner, timestamp),
        routes: [],
        provider: null,
        modelCalls: 0,
        warnings: ['Native advisor execution is required before consolidation.'],
        nativeHandoff: {
          phase: 'advisors',
          cycleId: cycle.id,
          evidenceDigest: evidence.fingerprint,
          roles: runnableMissingNonChair.map((role) => role.roleId).sort(),
        },
      };
    }
    await assertCycleWorkspace();
    const first =
      runnableMissingNonChair.length > 0
        ? await dispatchOperatingAdvisors({
            cycleId: cycle.id,
            projectRoot,
            pinnedRevision: workspace.controlRepository.pinnedRevision,
            readiness: { ...readiness, roles: missingNonChair },
            context: advisorContext,
            adapter: await resolveAdapter(),
            depth,
            runtime: resolvedRuntime,
            resolveCitations,
          })
        : {
            results: [],
            provenance: [],
            modelCalls: 0,
            blocked: false,
            skipped: skippedMissingNonChair,
            failed: [],
            gaps: [],
          };
    let roleResults = [
      ...existingRoleResults.filter((result) => result.roleId !== 'chair'),
      ...first.results,
    ];
    let modelCalls = first.modelCalls;
    let blocked = first.blocked;
    const dispatchProvenance: AdvisorDispatchResult['provenance'] = [...first.provenance];
    const skipped = [...first.skipped];
    const failed = [...first.failed];
    // FR2: the governed gaps opened while resolving each dispatched role's
    // citations (unresolvable-citation, empty-grounding) are recorded alongside
    // the cycle's other gaps.
    const dispatchGaps: OperatingDataGap[] = [...first.gaps];
    if (config.enabledRoles.includes('chair')) {
      // FR1: the Chair dispatches its own mandate and investigates independently —
      // it no longer receives a synthesized advisor-results evidence body. Its
      // proposals cite resolvable content the same way every other lens does.
      let chairReadiness = await buildDispatchReadiness({
        cycleId: cycle.id,
        roles: ['chair'],
        pinnedRevision: workspace.controlRepository.pinnedRevision,
        sensitivityCeiling: preferences.sensitivityCeiling,
        now,
      });
      chairReadiness = await remapReadinessGaps(chairReadiness, {
        ...initialState,
        dataGaps: [
          ...initialState.dataGaps,
          ...readiness.roles
            .filter((role) => role.gapId)
            .map((role) => ({ id: role.gapId as string, status: 'open' as const })),
        ],
      });
      readiness = {
        ...readiness,
        roles: [...readiness.roles, ...chairReadiness.roles],
      };
      await assertOperatingArtifact('operating-evidence-readiness', readiness);
      await assertCycleWorkspace();
      const persistedChair = existingByRole.get('chair');
      const runnableChair = chairReadiness.roles.filter(
        (role) => role.modelCallAllowed && !persistedChair,
      );
      if (input.deferAdvisors && runnableChair.length > 0) {
        return {
          preview: false,
          dryRun: false,
          cycle,
          evidence,
          readiness,
          roleResults,
          findings: [],
          decisions: [],
          gaps: readinessGaps(readiness, config.decisionOwner, timestamp),
          routes: [],
          provider: null,
          modelCalls,
          warnings: ['Native Chair execution is required before consolidation.'],
          nativeHandoff: {
            phase: 'chair',
            cycleId: cycle.id,
            evidenceDigest: evidence.fingerprint,
            roles: ['chair'],
          },
        };
      }
      const chair = persistedChair
        ? {
            results: [persistedChair],
            provenance: [],
            modelCalls: 0,
            blocked: false,
            skipped: [],
            failed: [],
            gaps: [],
          }
        : await dispatchOperatingAdvisors({
            cycleId: cycle.id,
            projectRoot,
            pinnedRevision: workspace.controlRepository.pinnedRevision,
            readiness: chairReadiness,
            context: advisorContext,
            adapter: await resolveAdapter(),
            depth,
            runtime: resolvedRuntime,
            resolveCitations,
          });
      roleResults = [...roleResults, ...chair.results];
      modelCalls += chair.modelCalls;
      dispatchProvenance.push(...chair.provenance);
      skipped.push(...chair.skipped);
      failed.push(...chair.failed);
      dispatchGaps.push(...chair.gaps);
      blocked ||= chair.blocked || chairReadiness.roles.some((role) => !role.modelCallAllowed);
    }
    const technologyRiskReady = readiness.roles.some(
      (role) => role.roleId === 'technology-risk' && role.modelCallAllowed,
    );
    const technologyRiskFailed = failed.some((entry) => entry.roleId === 'technology-risk');
    const sensitiveRouteBlocked =
      containsSensitiveRouteProposal(roleResults) && (!technologyRiskReady || technologyRiskFailed);
    blocked ||= sensitiveRouteBlocked;
    // FR2/FR3 / E-003: the universal citation gate. Every dispatched role already
    // resolved its citations at dispatch time (the committed result is v1.2-valid
    // with minted evidenceRefs, no raw citations), so re-running the gate over the
    // full role set — including any natively-committed existing results — is a
    // no-op that provides defence in depth and a single point where consolidation
    // input is proven citation-clean.
    const citationGate = await resolveCitations(roleResults);
    // FR2 (evidence-as-output): the cycle's evidence-of-record is assembled from
    // the resolved-citation snapshots, so confidence/sensitivity/freshness scoring
    // resolves against what was actually cited and verified — never a pre-collected
    // guess. This replaces the retired collected-evidence consolidation input.
    const consolidationEvidence = await assembleCitationEvidence({
      cycleId: cycle.id,
      roleResults: citationGate.roleResults,
      cache: citationCache,
      baseFingerprint: evidence.fingerprint,
      now: timestamp,
    });
    // Only the gated proposals feed consolidation, so a proposal with an
    // unresolvable citation can never become a finding/route. The rejection is
    // recorded as the opened unresolvable-citation gap threaded into `gaps` below.
    const consolidated = await consolidateOperatingResults({
      cycleId: cycle.id,
      results: citationGate.roleResults,
      evidence: consolidationEvidence,
      config,
      now: timestamp,
      existingGapCount: initialState.dataGaps.length,
    });
    const failureGaps = await advisorFailureGaps({
      cycleId: cycle.id,
      failed,
      readiness,
      owner: config.decisionOwner,
      now: timestamp,
    });
    const surfacedDedup = suppressRepeatedFindings(initialState, consolidated.findings, cycle.id);
    const overflowDedup = suppressRepeatedFindings(
      initialState,
      consolidated.criticalOverflow,
      cycle.id,
    );
    const parkedDedup = suppressRepeatedFindings(initialState, consolidated.parked, cycle.id);
    const suppressedFindings =
      surfacedDedup.suppressed + overflowDedup.suppressed + parkedDedup.suppressed;
    const criticalOverflowCount = overflowDedup.findings.length;
    blocked ||= criticalOverflowCount > 0;
    const remapped = remapConsolidation(
      {
        ...initialState,
        dataGaps: [
          ...initialState.dataGaps,
          ...readiness.roles
            .filter((role) => role.gapId)
            .map((role) => ({ id: role.gapId as string, status: 'open' as const })),
        ],
      },
      [...surfacedDedup.findings, ...overflowDedup.findings],
      parkedDedup.findings,
      consolidated.decisions,
      [...evidenceGaps, ...consolidated.gaps, ...failureGaps],
    );
    const warnings = [
      ...evidence.warnings,
      ...(evidenceGaps.length > 0
        ? [
            `${evidenceGaps.length} numeric commercial evidence item(s) require query and observation-window identity.`,
          ]
        : []),
      ...skipped.map((entry) => `${entry.roleId} not evaluated: ${entry.reason}`),
      ...failed.map((entry) => `${entry.roleId} failed: ${entry.message}`),
      ...(sensitiveRouteBlocked
        ? [
            'Sensitive payment/security/privacy/legal/tenant/destructive routing is blocked until technology-risk completes.',
          ]
        : []),
      ...(criticalOverflowCount > 0
        ? [
            `${criticalOverflowCount} verified critical finding(s) exceeded a configured cap; the cycle is blocked instead of parking them.`,
          ]
        : []),
      ...(suppressedFindings > 0
        ? [
            `${suppressedFindings} unchanged cross-cycle finding(s) were suppressed instead of duplicated.`,
          ]
        : []),
    ];
    if (blocked) warnings.push('The cycle is blocked by required advisor evidence or failure.');
    const reconciledFindings = reconcileCycleFindings(initial.events, cycle.id, remapped.findings);
    const reconciledParked = reconcileCycleFindings(initial.events, cycle.id, remapped.parked);
    return {
      preview: false,
      dryRun: !persist,
      cycle,
      evidence,
      readiness,
      roleResults,
      findings: [...reconciledFindings, ...reconciledParked],
      decisions: remapped.decisions,
      // Citation gaps bypass remapConsolidation (their IDs are digest-derived and
      // already canonical) and are persisted alongside the cycle's other gaps.
      // `dispatchGaps` are the unresolvable-citation/empty-grounding gaps opened
      // while resolving each role's citations at dispatch time; `citationGate.gaps`
      // covers the no-op consolidation-time re-gate (empty in practice).
      gaps: [
        ...readinessGaps(readiness, config.decisionOwner, timestamp),
        ...remapped.gaps,
        ...dispatchGaps,
        ...citationGate.gaps,
      ],
      routes: [],
      provider,
      modelCalls,
      warnings,
      dispatchProvenance,
    };
  };

  if (input.dryRun) return evaluate(false);

  const cycleResult = await withOperatingLock(
    projectRoot,
    {
      projectKey: operatingProjectKey(projectRoot),
      expectedEventHead: initial.eventHead,
      currentEventHead: initial.eventHead,
      localRoot: input.localRoot,
    },
    async (lock) => {
      const latest = await store.replay();
      if (
        latest.eventHead.sequence !== initial.eventHead.sequence ||
        latest.eventHead.hash !== initial.eventHead.hash
      ) {
        throw new OperateError(
          'E_OPERATE_HEAD_DIVERGED',
          'Operating state changed while preparing the cycle.',
        );
      }
      let head = initial.eventHead;
      let started = Boolean(current);
      let phase = current?.state ?? null;
      const correlationId = randomUUID();
      try {
        await assertCycleWorkspace();
        if (!current) {
          const prepared = await appendLocked(store, lock, head, {
            type: 'cycle.preparing',
            cycleId: cycle.id,
            entityId: cycle.id,
            correlationId,
            payload: { record: cycle },
          });
          started = true;
          head = prepared.head;
          phase = 'preparing';
        }
        if (phase === 'preparing' || phase === 'blocked') {
          const collecting = await appendLocked(store, lock, head, {
            type: 'cycle.collecting',
            cycleId: cycle.id,
            entityId: cycle.id,
            correlationId,
            payload: {},
          });
          head = collecting.head;
          phase = 'collecting';
        }
        const evaluated = await evaluate(true);
        await assertCycleWorkspace();
        const evidence = evaluated.evidence as OperatingEvidence;
        if (phase === 'collecting') {
          if (!existingEvidence) {
            const evidenceRecord = await store.putRecord(
              'evidence-metadata',
              recordContent(evidence),
              { correlationId, createdAt: timestamp },
            );
            const cache = new OperatingEvidenceCache(
              resolveOperatingPaths(projectRoot, { localRoot: input.localRoot }).evidence,
              preferences.sensitivityCeiling,
            );
            await cache.put(
              evidence.fingerprint.slice('sha256:'.length),
              evidence,
              preferences.evidenceTtlMs,
              now,
            );
            const evidenceEvent = await appendLocked(store, lock, head, {
              type: 'evidence.collected',
              cycleId: cycle.id,
              entityId: cycle.id,
              correlationId,
              evidenceRefs: evidence.items.map((item) => item.id),
              payload: {
                recordDigest: evidenceRecord.digest,
                sources: evidenceProjectionSources(evidence),
              },
            });
            head = evidenceEvent.head;
          }
          const advising = await appendLocked(store, lock, head, {
            type: 'cycle.advising',
            cycleId: cycle.id,
            entityId: cycle.id,
            correlationId,
            payload: {},
          });
          head = advising.head;
          phase = 'advising';
        }

        if (phase === 'advising' && evaluated.nativeHandoff) {
          const state = await store.state();
          await store.writeCheckpoint(state);
          await persistOperatingProjections({
            projectRoot,
            localRoot: input.localRoot,
            state,
            revalidateEventHead: async () => (await store.replay()).eventHead,
          });
          return { ...evaluated, state };
        }

        if (phase === 'advising') {
          const recordedRoles = new Set(existingRoleResults.map((result) => result.roleId));
          for (const result of evaluated.roleResults ?? []) {
            if (recordedRoles.has(result.roleId)) continue;
            const record = await store.putRecord('advisor-result', recordContent(result), {
              correlationId,
              createdAt: timestamp,
            });
            const appended = await appendLocked(store, lock, head, {
              type: 'advisory.recorded',
              cycleId: cycle.id,
              entityId: `${cycle.id}-${result.roleId}`,
              correlationId,
              evidenceRefs: result.proposals.flatMap((proposal) => proposal.evidenceRefs),
              payload: { recordDigest: record.digest },
            });
            head = appended.head;
          }
          const existingGapIds = new Set(
            initialState.dataGaps.filter((gap) => gap.cycleId === cycle.id).map((gap) => gap.id),
          );
          for (const gap of evaluated.gaps ?? []) {
            if (existingGapIds.has(gap.id)) continue;
            await assertOperatingArtifact('operating-data-gap', gap);
            await store.putRecord('data-gap', recordContent(gap), {
              correlationId,
              createdAt: timestamp,
            });
            const appended = await appendLocked(store, lock, head, {
              type: 'gap.open',
              cycleId: cycle.id,
              entityId: gap.id,
              correlationId,
              evidenceRefs: gap.evidenceRefs,
              payload: { record: gap },
            });
            head = appended.head;
          }
        }
        if (
          phase === 'advising' &&
          evaluated.warnings.some((warning) => warning.includes('cycle is blocked'))
        ) {
          const blocked = await appendLocked(store, lock, head, {
            type: 'cycle.blocked',
            cycleId: cycle.id,
            entityId: cycle.id,
            correlationId,
            payload: { patch: { health: 'blocked' }, warnings: evaluated.warnings },
          });
          head = blocked.head;
          const state = await store.state();
          await store.writeCheckpoint(state);
          await persistOperatingProjections({
            projectRoot,
            localRoot: input.localRoot,
            state,
            revalidateEventHead: async () => (await store.replay()).eventHead,
          });
          return { ...evaluated, state };
        }
        if (phase === 'advising') {
          const consolidating = await appendLocked(store, lock, head, {
            type: 'cycle.consolidating',
            cycleId: cycle.id,
            entityId: cycle.id,
            correlationId,
            payload: {},
          });
          head = consolidating.head;
          phase = 'consolidating';
        }
        const existingFindingIds = new Set(
          initialState.findings
            .filter((finding) => finding.cycleId === cycle.id)
            .map((finding) => finding.id),
        );
        for (const finding of evaluated.findings ?? []) {
          if (existingFindingIds.has(finding.id)) continue;
          await store.putRecord('finding', recordContent(finding), {
            correlationId,
            createdAt: timestamp,
          });
          const appended = await appendLocked(store, lock, head, {
            type: 'finding.proposed',
            cycleId: cycle.id,
            entityId: finding.id,
            correlationId,
            evidenceRefs: finding.evidenceRefs,
            payload: { record: finding },
          });
          head = appended.head;
        }
        const existingDecisionQuestions = new Set(
          initialState.decisions
            .filter((decision) => decision.cycleId === cycle.id)
            .map((decision) => String(decision.question ?? '')),
        );
        for (const decision of evaluated.decisions ?? []) {
          if (existingDecisionQuestions.has(decision.question)) continue;
          await store.putRecord('decision', recordContent(decision), {
            correlationId,
            createdAt: timestamp,
          });
          const appended = await appendLocked(store, lock, head, {
            type: 'decision.open',
            cycleId: cycle.id,
            entityId: decision.id,
            correlationId,
            evidenceRefs: decision.evidenceRefs,
            payload: { record: decision },
          });
          head = appended.head;
        }

        const routeBase = await store.state();
        const providerDigest =
          evaluated.provider?.policyDigest ?? canonicalDigest({ provider: 'offline' });
        const routes: OperatingRoutePlan[] = [];
        let routeOrdinal = maximumOrdinal(routeBase.routes, 'ACT');
        let specOrdinal = await nextOperatingSpecOrdinal(projectRoot);
        const existingRoutedFindingIds = new Set(
          initial.events
            .filter(
              (event) =>
                event.type === 'route.proposed' &&
                event.payload.record &&
                typeof event.payload.record === 'object',
            )
            .flatMap((event) => {
              const record = event.payload.record as { actions?: Array<{ findingId?: string }> };
              return (record.actions ?? [])
                .map((action) => action.findingId)
                .filter((findingId): findingId is string => Boolean(findingId));
            }),
        );
        for (const finding of (evaluated.findings ?? []).filter(
          (candidate) => !candidate.parked && !existingRoutedFindingIds.has(candidate.id),
        )) {
          const isDev = finding.lane === 'DEV';
          routes.push(
            await createOperatingRoutePlan({
              projectRoot,
              cycleId: cycle.id,
              finding,
              config,
              workspace,
              eventHead: head,
              evidenceDigest: evidence.fingerprint,
              providerDigest,
              sequence: ++routeOrdinal,
              localRoot: input.localRoot,
              ...(isDev ? { specId: `SPEC-${String(specOrdinal++).padStart(3, '0')}` } : {}),
              now: timestamp,
            }),
          );
        }
        if (routes.length > 0) {
          await assertCycleWorkspace();
          for (const route of routes) {
            const relativePath = `.planr/operate/routes/${route.id}.json`;
            const content = `${canonicalize(route)}\n`;
            const transactionId = `TXN-${cycle.id}-${route.id}-proposal`;
            const transactionRoot = path.join(
              resolveOperatingPaths(projectRoot, { localRoot: input.localRoot }).transactions,
              transactionId,
            );
            const manifestPath = path.join(transactionRoot, 'journal.json');
            const existingBytes = await readFile(
              path.join(projectRoot, relativePath),
              'utf8',
            ).catch((error) => {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
              throw error;
            });
            const journal =
              existingBytes === null
                ? await prepareJournalTransaction(projectRoot, {
                    writes: [
                      {
                        relativePath,
                        operation: 'create' as const,
                        content,
                      },
                    ],
                    eventHead: head,
                    previewDigest: route.previewDigest,
                    transactionId,
                    localRoot: input.localRoot,
                  })
                : {
                    root: transactionRoot,
                    manifestPath,
                    record: await readJournal(manifestPath),
                  };
            if (existingBytes !== null) {
              if (
                existingBytes !== content ||
                journal.record.state !== 'committed' ||
                journal.record.previewDigest !== route.previewDigest
              ) {
                throw new OperateError(
                  'E_OPERATE_TRANSACTION_INVALID',
                  `Orphaned route proposal ${route.id} does not match its committed journal.`,
                );
              }
            } else {
              await applyJournalTransaction(projectRoot, journal, {
                currentEventHead: head,
                revalidateEventHead: async () => (await store.replay()).eventHead,
              });
            }
            try {
              await store.putRecord('route', recordContent(route), {
                correlationId,
                createdAt: timestamp,
              });
              const appended = await appendLocked(store, lock, head, {
                type: 'route.proposed',
                cycleId: cycle.id,
                entityId: route.id,
                correlationId,
                evidenceRefs: route.actions.flatMap((action) => action.evidenceRefs),
                payload: { record: route },
                // A v1.3 (create-quick-task) route plan embedded in the event
                // payload stamps the event v1.3, whose schema accepts either
                // route-plan version; every v1.2 route keeps the frozen v1.2 event.
                ...(route.protocolVersion === OPERATE_MISSION_PROTOCOL_VERSION
                  ? { protocolVersion: OPERATE_MISSION_PROTOCOL_VERSION }
                  : {}),
              });
              head = appended.head;
            } catch (error) {
              await rollbackJournalTransaction(projectRoot, journal).catch(() => undefined);
              throw error;
            }
          }
        }
        const quiet =
          (evaluated.findings?.length ?? 0) === 0 &&
          (evaluated.decisions?.length ?? 0) === 0 &&
          (evaluated.gaps?.length ?? 0) === 0;
        const health = quiet ? 'quiet' : evaluated.warnings.length > 0 ? 'partial' : 'normal';
        const reviewable = await appendLocked(store, lock, head, {
          type: 'cycle.reviewable',
          cycleId: cycle.id,
          entityId: cycle.id,
          correlationId,
          payload: {
            patch: {
              health,
            },
            warnings: evaluated.warnings,
          },
        });
        head = reviewable.head;
        if (quiet) {
          const closed = await appendLocked(store, lock, head, {
            type: 'cycle.closed',
            cycleId: cycle.id,
            entityId: cycle.id,
            correlationId,
            payload: {
              patch: {
                health,
                completedAt: timestamp,
              },
            },
          });
          head = closed.head;
        }
        const state = await store.state();
        await store.writeCheckpoint(state);
        await persistOperatingProjections({
          projectRoot,
          localRoot: input.localRoot,
          state,
          revalidateEventHead: async () => (await store.replay()).eventHead,
        });
        await mkdir(resolveOperatingPaths(projectRoot).cycles, {
          recursive: true,
          mode: 0o700,
        });
        return { ...evaluated, routes, state };
      } catch (error) {
        if (started) {
          const currentHead = await store.replay();
          try {
            const blockedByCriticalCap =
              error instanceof OperateError && error.code === 'E_OPERATE_CRITICAL_CAP';
            const failed = await appendLocked(store, lock, currentHead.eventHead, {
              type: blockedByCriticalCap ? 'cycle.blocked' : 'cycle.failed',
              cycleId: cycle.id,
              entityId: cycle.id,
              correlationId,
              payload: {
                patch: { health: 'blocked' },
                errorCode: error instanceof OperateError ? error.code : 'E_OPERATE_STATE_INVALID',
                ...(blockedByCriticalCap ? { details: error.details } : {}),
              },
            });
            head = failed.head;
            const failedState = await store.state();
            await store.writeCheckpoint(failedState);
            await persistOperatingProjections({
              projectRoot,
              localRoot: input.localRoot,
              state: failedState,
              revalidateEventHead: async () => (await store.replay()).eventHead,
            });
          } catch {
            // Preserve the original failure; integrity diagnostics will expose
            // any inability to append the terminal audit event.
          }
        }
        throw error;
      }
    },
  );

  // FR8 / E-008: persist the cadence `lastRunAt` marker once a committed cycle
  // reaches a terminal reviewable/blocked/closed state, so a later `operate
  // status` surfaces the pipeline's `nextDueAt` without re-running a cycle. Uses
  // the injected clock (`timestamp`), never a wall-clock read. Preview, dry-run,
  // and native-handoff returns have not completed a cycle and record nothing.
  if (!cycleResult.preview && !cycleResult.dryRun && !cycleResult.nativeHandoff) {
    const finalCycleState = cycleResult.state?.cycles.find(
      (candidate) => candidate.id === cycle.id,
    )?.state;
    if (finalCycleState && ['reviewable', 'blocked', 'closed'].includes(finalCycleState)) {
      await recordOperatingCadenceRun({
        projectRoot,
        localRoot: input.localRoot,
        runAt: timestamp,
      });
    }
  }
  return cycleResult;
}
