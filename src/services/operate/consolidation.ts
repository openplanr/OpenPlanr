import { canonicalDigest } from './canonical.js';
import { assertOperatingArtifact } from './protocol.js';
import { maximumSensitivity } from './redaction.js';
import {
  OPERATE_PROTOCOL_VERSION,
  OPERATE_SCHEMA_VERSION,
  OperateError,
  type OperatingConfig,
  type OperatingDataGap,
  type OperatingDecision,
  type OperatingEvidence,
  type OperatingFinding,
  type OperatingRoleId,
  type OperatingRoleResult,
} from './types.js';

export interface ConsolidationResult {
  findings: OperatingFinding[];
  decisions: OperatingDecision[];
  gaps: OperatingDataGap[];
  parked: OperatingFinding[];
  criticalOverflow: OperatingFinding[];
}

type Proposal = OperatingRoleResult['proposals'][number];

interface AggregatedProposal {
  stableKey: `sha256:${string}`;
  roleIds: OperatingRoleId[];
  proposalKeys: string[];
  proposal: Proposal;
}

const VERIFIED_CRITICAL_CLAIMS = new Set([
  'verified-risk:security',
  'verified-risk:privacy',
  'verified-risk:payment-integrity',
  'verified-risk:legal',
  'verified-risk:tenant-isolation',
  'verified-risk:destructive-data',
]);

const SEVERITY_RANK: Record<Proposal['severity'], number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const TYPE_RANK: Record<Proposal['type'], number> = {
  finding: 1,
  decision: 2,
  'data-gap': 3,
  merge: 4,
  sequence: 5,
};

const FRESHNESS_RANK: Record<OperatingEvidence['items'][number]['freshness'], number> = {
  stale: 1,
  unknown: 2,
  fresh: 3,
};

function normalized(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizedDisplay(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

const SEMANTIC_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'problem',
  'resolve',
  'that',
  'the',
  'this',
  'to',
  'with',
]);

const SEMANTIC_ALIASES: Record<string, string> = {
  enhance: 'improve',
  optimize: 'improve',
  repair: 'fix',
  resolve: 'fix',
  registration: 'signup',
  'sign-up': 'signup',
  users: 'user',
  customers: 'customer',
  failures: 'fail',
  failure: 'fail',
  failed: 'fail',
  failing: 'fail',
};

function semanticStem(token: string): string {
  const alias = SEMANTIC_ALIASES[token] ?? token;
  if (alias.length > 5 && alias.endsWith('ing')) return alias.slice(0, -3);
  if (alias.length > 4 && alias.endsWith('ed')) return alias.slice(0, -2);
  if (alias.length > 4 && alias.endsWith('es')) return alias.slice(0, -2);
  if (alias.length > 3 && alias.endsWith('s')) return alias.slice(0, -1);
  return alias;
}

function semanticTokens(...values: string[]): string[] {
  return [
    ...new Set(
      values
        .join(' ')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/sign[\s-]?up/g, 'signup')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .filter((token) => !SEMANTIC_STOP_WORDS.has(token))
        .map(semanticStem)
        .filter((token) => token.length > 1),
    ),
  ].sort();
}

function semanticOverlap(
  left: string[],
  right: string[],
): {
  intersection: number;
  jaccard: number;
  overlap: number;
} {
  const rightSet = new Set(right);
  const intersection = left.filter((token) => rightSet.has(token)).length;
  return {
    intersection,
    jaccard: intersection / Math.max(1, new Set([...left, ...right]).size),
    overlap: intersection / Math.max(1, Math.min(left.length, right.length)),
  };
}

function semanticallyEquivalentProposals(left: Proposal, right: Proposal): boolean {
  if (left.type !== right.type) return false;
  if (exactDuplicateKey(left) === exactDuplicateKey(right)) return true;
  if (['merge', 'sequence'].includes(left.type)) return false;
  const leftTokens = semanticTokens(left.title, left.problem, left.proposal);
  const rightTokens = semanticTokens(right.title, right.problem, right.proposal);
  const similarity = semanticOverlap(leftTokens, rightTokens);
  return similarity.intersection >= 3 && similarity.jaccard >= 0.5 && similarity.overlap >= 0.7;
}

function confidenceCeiling(evidenceRefs: string[], evidence: OperatingEvidence): number {
  const items = evidence.items.filter((item) => evidenceRefs.includes(item.id));
  if (items.length === 0) return 1;
  let ceiling = items.some((item) => item.freshness === 'stale') ? 2 : 3;
  if (new Set(items.map((item) => item.source)).size >= 2) ceiling += 1;
  if (
    items.some(
      (item) =>
        item.metric?.observedFrom &&
        item.metric.observedTo &&
        Date.parse(item.metric.observedTo) >= Date.parse(item.metric.observedFrom),
    )
  ) {
    ceiling += 1;
  }
  return Math.min(5, ceiling);
}

function hasVerifiedCriticalEvidence(evidenceRefs: string[], evidence: OperatingEvidence): boolean {
  return evidence.items
    .filter((item) => evidenceRefs.includes(item.id))
    .some((item) => item.claimTypes.some((claim) => VERIFIED_CRITICAL_CLAIMS.has(claim)));
}

function criticalOverride(
  evidenceRefs: string[],
  roleIds: OperatingRoleId[],
  evidence: OperatingEvidence,
): boolean {
  return roleIds.includes('technology-risk') && hasVerifiedCriticalEvidence(evidenceRefs, evidence);
}

function derivedSeverity(impact: number, critical: boolean): Proposal['severity'] {
  if (critical) return 'critical';
  if (impact >= 4) return 'high';
  if (impact >= 2) return 'medium';
  return 'low';
}

function evidenceFreshness(evidenceRefs: string[], evidence: OperatingEvidence): number {
  const ranks = evidence.items
    .filter((item) => evidenceRefs.includes(item.id))
    .map((item) => FRESHNESS_RANK[item.freshness]);
  return ranks.length > 0 ? Math.min(...ranks) : 0;
}

function evidenceSensitivity(
  evidenceRefs: string[],
  evidence: OperatingEvidence,
): OperatingFinding['sensitivity'] {
  const byId = new Map(evidence.items.map((item) => [item.id, item]));
  const missingRefs = [...new Set(evidenceRefs)].filter((reference) => !byId.has(reference)).sort();
  if (missingRefs.length > 0) {
    throw new OperateError(
      'E_OPERATE_EVIDENCE_REJECTED',
      `Finding proposal cites unavailable evidence: ${missingRefs.join(', ')}.`,
    );
  }
  return maximumSensitivity(
    [...new Set(evidenceRefs)].map((reference) => byId.get(reference)?.sensitivity ?? 'public'),
  );
}

function exactDuplicateKey(proposal: Proposal): `sha256:${string}` {
  return canonicalDigest({
    category: proposal.type,
    problem: normalized(proposal.problem),
    proposal: normalized(proposal.proposal),
  });
}

function findingFingerprint(
  proposal: Proposal,
  sensitivity: OperatingFinding['sensitivity'],
): `sha256:${string}` {
  return canonicalDigest({
    category: proposal.type,
    semanticTokens: semanticTokens(proposal.title, proposal.problem, proposal.proposal),
    sensitivity,
  });
}

export function semanticallyEquivalentFindings(
  left: Pick<OperatingFinding, 'category' | 'title' | 'problem' | 'proposal' | 'sensitivity'>,
  right: Pick<OperatingFinding, 'category' | 'title' | 'problem' | 'proposal' | 'sensitivity'>,
): boolean {
  if (left.category !== right.category || left.sensitivity !== right.sensitivity) return false;
  const leftTokens = semanticTokens(left.title, left.problem, left.proposal);
  const rightTokens = semanticTokens(right.title, right.problem, right.proposal);
  const similarity = semanticOverlap(leftTokens, rightTokens);
  return similarity.intersection >= 3 && similarity.jaccard >= 0.5 && similarity.overlap >= 0.7;
}

function laneFor(type: Proposal['type']): OperatingFinding['lane'] {
  if (type === 'decision') return 'OWNER';
  if (type === 'merge' || type === 'sequence') return 'AGENT';
  return 'DEV';
}

function preferredText(left: string, right: string): string {
  return [normalizedDisplay(left), normalizedDisplay(right)].sort(
    (a, b) => normalized(a).localeCompare(normalized(b)) || a.localeCompare(b),
  )[0];
}

function preferredType(left: Proposal['type'], right: Proposal['type']): Proposal['type'] {
  return TYPE_RANK[left] >= TYPE_RANK[right] ? left : right;
}

function preferredSeverity(
  left: Proposal['severity'],
  right: Proposal['severity'],
): Proposal['severity'] {
  return SEVERITY_RANK[left] >= SEVERITY_RANK[right] ? left : right;
}

function normalizeProposal(proposal: Proposal): Proposal {
  return {
    ...structuredClone(proposal),
    evidenceRefs: [...new Set(proposal.evidenceRefs)].sort(),
    ...(proposal.dependsOnProposalKeys
      ? { dependsOnProposalKeys: [...new Set(proposal.dependsOnProposalKeys)].sort() }
      : {}),
    ...(proposal.conflictsWithProposalKeys
      ? { conflictsWithProposalKeys: [...new Set(proposal.conflictsWithProposalKeys)].sort() }
      : {}),
    ...(proposal.sequenceProposalKeys
      ? {
          sequenceProposalKeys: proposal.sequenceProposalKeys.filter(
            (key, index, values) => values.indexOf(key) === index,
          ),
        }
      : {}),
  };
}

function mergeProposalReferences(
  left: Proposal,
  right: Proposal,
): Pick<Proposal, 'dependsOnProposalKeys' | 'conflictsWithProposalKeys' | 'sequenceProposalKeys'> {
  const dependsOnProposalKeys = [
    ...new Set([...(left.dependsOnProposalKeys ?? []), ...(right.dependsOnProposalKeys ?? [])]),
  ].sort();
  const conflictsWithProposalKeys = [
    ...new Set([
      ...(left.conflictsWithProposalKeys ?? []),
      ...(right.conflictsWithProposalKeys ?? []),
    ]),
  ].sort();
  const sequences = [left.sequenceProposalKeys, right.sequenceProposalKeys].filter(
    (value): value is string[] => Array.isArray(value),
  );
  const sequenceProposalKeys = sequences
    .map((value) => [...value])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    .at(0);
  return {
    ...(dependsOnProposalKeys.length > 0 ? { dependsOnProposalKeys } : {}),
    ...(conflictsWithProposalKeys.length > 0 ? { conflictsWithProposalKeys } : {}),
    ...(sequenceProposalKeys ? { sequenceProposalKeys } : {}),
  };
}

function aggregateProposals(results: OperatingRoleResult[]): AggregatedProposal[] {
  const candidates = results
    .flatMap((result) =>
      result.proposals.map((proposal) => ({
        roleId: result.roleId,
        proposal: structuredClone(proposal),
      })),
    )
    .sort((left, right) => {
      const keyDelta = exactDuplicateKey(left.proposal).localeCompare(
        exactDuplicateKey(right.proposal),
      );
      return (
        keyDelta ||
        left.roleId.localeCompare(right.roleId) ||
        left.proposal.proposalKey.localeCompare(right.proposal.proposalKey)
      );
    });
  const parent = candidates.map((_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    const [keep, merge] = [leftRoot, rightRoot].sort((a, b) => a - b);
    parent[merge] = keep;
  };
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      if (semanticallyEquivalentProposals(candidates[left].proposal, candidates[right].proposal)) {
        union(left, right);
      }
    }
  }
  const clusters = new Map<number, typeof candidates>();
  candidates.forEach((candidate, index) => {
    const root = find(index);
    clusters.set(root, [...(clusters.get(root) ?? []), candidate]);
  });
  return [...clusters.values()]
    .map((cluster) => {
      const ordered = [...cluster].sort(
        (left, right) =>
          left.roleId.localeCompare(right.roleId) ||
          left.proposal.proposalKey.localeCompare(right.proposal.proposalKey),
      );
      const proposal = ordered.slice(1).reduce<Proposal>(
        (current, candidate) => ({
          proposalKey: [current.proposalKey, candidate.proposal.proposalKey].sort()[0],
          type: preferredType(current.type, candidate.proposal.type),
          title: preferredText(current.title, candidate.proposal.title),
          problem: preferredText(current.problem, candidate.proposal.problem),
          proposal: preferredText(current.proposal, candidate.proposal.proposal),
          impact: Math.max(current.impact, candidate.proposal.impact),
          confidence: Math.max(current.confidence, candidate.proposal.confidence),
          ease: Math.max(current.ease, candidate.proposal.ease),
          severity: preferredSeverity(current.severity, candidate.proposal.severity),
          evidenceRefs: [
            ...new Set([...current.evidenceRefs, ...candidate.proposal.evidenceRefs]),
          ].sort(),
          ...mergeProposalReferences(current, candidate.proposal),
        }),
        normalizeProposal(ordered[0].proposal),
      );
      const exactKeys = ordered.map((candidate) => exactDuplicateKey(candidate.proposal)).sort();
      return {
        stableKey: canonicalDigest({ exactKeys }),
        roleIds: [
          ...new Set(ordered.map((candidate) => candidate.roleId)),
        ].sort() as OperatingRoleId[],
        proposalKeys: [
          ...new Set(ordered.map((candidate) => candidate.proposal.proposalKey)),
        ].sort(),
        proposal,
      };
    })
    .sort((left, right) => left.stableKey.localeCompare(right.stableKey));
}

function candidateOrder(
  left: {
    finding: OperatingFinding;
    freshness: number;
    stableKey: string;
  },
  right: {
    finding: OperatingFinding;
    freshness: number;
    stableKey: string;
  },
): number {
  return (
    Number(right.finding.criticalOverride) - Number(left.finding.criticalOverride) ||
    SEVERITY_RANK[right.finding.severity] - SEVERITY_RANK[left.finding.severity] ||
    right.finding.score - left.finding.score ||
    right.freshness - left.freshness ||
    left.stableKey.localeCompare(right.stableKey)
  );
}

export async function consolidateOperatingResults(input: {
  cycleId: string;
  results: OperatingRoleResult[];
  evidence: OperatingEvidence;
  config: OperatingConfig;
  now?: string;
  existingGapCount?: number;
}): Promise<ConsolidationResult> {
  const now = input.now ?? new Date().toISOString();
  const proposals = aggregateProposals(input.results);
  const evaluatedCandidates = proposals
    .filter(({ proposal }) => proposal.type !== 'data-gap')
    .map(({ roleIds, proposal, stableKey }) => {
      const ceiling = confidenceCeiling(proposal.evidenceRefs, input.evidence);
      const confidence = Math.min(proposal.confidence, ceiling);
      const critical = criticalOverride(proposal.evidenceRefs, roleIds, input.evidence);
      const missingTechnologyRiskCoverage =
        hasVerifiedCriticalEvidence(proposal.evidenceRefs, input.evidence) &&
        !roleIds.includes('technology-risk');
      const severity = derivedSeverity(proposal.impact, critical);
      const lane = laneFor(proposal.type);
      const sensitivity = evidenceSensitivity(proposal.evidenceRefs, input.evidence);
      const finding: OperatingFinding = {
        kind: 'operating-finding',
        schemaVersion: OPERATE_SCHEMA_VERSION,
        protocolVersion: OPERATE_PROTOCOL_VERSION,
        id: 'FND-PENDING',
        cycleId: input.cycleId,
        title: proposal.title,
        category: proposal.type,
        problem: proposal.problem,
        cost: 'Not independently quantified; validate through the linked outcome contract.',
        proposal: proposal.proposal,
        fingerprint: findingFingerprint(proposal, sensitivity),
        impact: proposal.impact,
        confidence,
        confidenceCeiling: ceiling,
        ease: proposal.ease,
        score: proposal.impact * confidence * proposal.ease,
        severity,
        sensitivity,
        criticalOverride: critical,
        lane,
        owner:
          lane === 'OWNER'
            ? input.config.decisionOwner
            : critical
              ? 'technology-risk'
              : (roleIds[0] ?? input.config.decisionOwner),
        evidenceRefs: [...proposal.evidenceRefs].sort(),
        status: 'proposed',
        dependsOn: [],
        createdAt: now,
        updatedAt: now,
      };
      return {
        stableKey,
        finding,
        freshness: evidenceFreshness(proposal.evidenceRefs, input.evidence),
        convertedToGap:
          missingTechnologyRiskCoverage || (proposal.impact >= 4 && confidence <= 2 && !critical),
        missingTechnologyRiskCoverage,
      };
    });

  const rankedCandidates = evaluatedCandidates
    .filter((candidate) => !candidate.convertedToGap)
    .sort(candidateOrder)
    .map((candidate, index) => ({
      ...candidate,
      finding: {
        ...candidate.finding,
        id: `FND-${String(index + 1).padStart(3, '0')}`,
      },
    }));

  const criticalCandidates = rankedCandidates.filter(
    (candidate) => candidate.finding.criticalOverride,
  );
  if (criticalCandidates.length > input.config.caps.surfacedFindings) {
    throw new OperateError(
      'E_OPERATE_CRITICAL_CAP',
      `${criticalCandidates.length} verified critical findings exceed the surfaced-finding cap of ${input.config.caps.surfacedFindings}.`,
      {
        criticalFindingIds: criticalCandidates.map((candidate) => candidate.finding.id),
        configuredCap: input.config.caps.surfacedFindings,
        recoveryChoices: [
          'Resolve or supersede verified critical evidence before rerunning the cycle.',
          'Explicitly raise the schema-bounded surfaced-finding cap and rerun.',
          'Narrow the cycle focus without suppressing required technology-risk coverage.',
        ],
        routeApplicationAllowed: false,
      },
    );
  }

  const findingCandidates = rankedCandidates.map(({ finding }, index) => ({
    ...finding,
    dependsOn:
      finding.lane === 'AGENT'
        ? rankedCandidates
            .slice(0, index)
            .map((candidate) => candidate.finding)
            .filter(
              (candidate) =>
                candidate.lane !== 'AGENT' &&
                candidate.evidenceRefs.some((reference) =>
                  finding.evidenceRefs.includes(reference),
                ),
            )
            .map((candidate) => candidate.id)
            .sort()
        : [],
  }));

  const laneCaps: Record<OperatingFinding['lane'], number> = {
    DEV: input.config.caps.newSpecs,
    OWNER: input.config.caps.openDecisions,
    AGENT: input.config.caps.agentArtifacts,
  };
  const laneCounts: Record<OperatingFinding['lane'], number> = {
    DEV: 0,
    OWNER: 0,
    AGENT: 0,
  };
  const findings: OperatingFinding[] = [];
  const parked: OperatingFinding[] = [];
  const criticalOverflow: OperatingFinding[] = [];
  for (const finding of findingCandidates) {
    if (
      findings.length < input.config.caps.surfacedFindings &&
      laneCounts[finding.lane] < laneCaps[finding.lane]
    ) {
      findings.push(finding);
      laneCounts[finding.lane] += 1;
    } else if (finding.criticalOverride) {
      criticalOverflow.push(finding);
    } else {
      parked.push({ ...finding, parked: true });
    }
  }

  const decisions: OperatingDecision[] = proposals
    .filter(({ proposal }) => proposal.type === 'decision')
    .sort((left, right) => left.stableKey.localeCompare(right.stableKey))
    .slice(0, input.config.caps.openDecisions)
    .map(({ proposal }, index) => ({
      kind: 'operating-decision',
      schemaVersion: OPERATE_SCHEMA_VERSION,
      protocolVersion: OPERATE_PROTOCOL_VERSION,
      id: `DEC-${String(index + 1).padStart(3, '0')}`,
      cycleId: input.cycleId,
      question: proposal.problem,
      options: [
        { id: 'accept', label: proposal.proposal },
        { id: 'defer', label: 'Defer until the next operating cycle.' },
      ],
      recommendation: 'accept',
      consequences: proposal.title,
      reversibility: 'reversible',
      deadline: new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1_000).toISOString(),
      proposedDefault: 'defer',
      unblocks: [],
      status: 'open',
      owner: input.config.decisionOwner,
      evidenceRefs: [...proposal.evidenceRefs].sort(),
      createdAt: now,
      updatedAt: now,
    }));

  const explicitGapProposals = proposals
    .filter(({ proposal }) => proposal.type === 'data-gap')
    .map(({ proposal, stableKey }) => ({
      stableKey,
      question: proposal.problem,
      reason: proposal.proposal,
      evidenceRefs: [...proposal.evidenceRefs].sort(),
      affectedRoles: undefined as string[] | undefined,
    }));
  const confidenceGaps = evaluatedCandidates
    .filter((candidate) => candidate.convertedToGap)
    .map(({ finding, stableKey, missingTechnologyRiskCoverage }) => ({
      stableKey,
      question: missingTechnologyRiskCoverage
        ? `What technology-risk review validates: ${finding.title}?`
        : `What evidence would raise confidence in: ${finding.title}?`,
      reason: missingTechnologyRiskCoverage
        ? 'Verified critical-risk evidence requires explicit technology-risk advisor coverage before the finding can be ranked or routed.'
        : `Impact ${finding.impact}/5 is high but evidence-bounded confidence is ${finding.confidence}/5; the proposal is withheld from ranking.`,
      evidenceRefs: [...finding.evidenceRefs],
      affectedRoles: missingTechnologyRiskCoverage ? ['technology-risk'] : undefined,
    }));
  const chairConflictGaps = input.results
    .filter((result) => result.roleId === 'chair')
    .flatMap((result) =>
      result.conflicts.map((conflict) => ({
        stableKey: canonicalDigest({
          conflict: normalized(conflict),
          evidenceRefs: result.proposals.flatMap((proposal) => proposal.evidenceRefs).sort(),
        }),
        question: `Resolve advisor conflict: ${conflict}`,
        reason: 'Chair consolidation found incompatible evidence-backed recommendations.',
        evidenceRefs: [
          ...new Set(result.proposals.flatMap((proposal) => proposal.evidenceRefs)),
        ].sort(),
        affectedRoles: ['chair'],
      })),
    )
    .filter((gap) => gap.evidenceRefs.length > 0);
  const uniqueGaps = new Map<
    string,
    {
      stableKey: string;
      question: string;
      reason: string;
      evidenceRefs: string[];
      affectedRoles?: string[];
    }
  >();
  for (const gap of [...explicitGapProposals, ...confidenceGaps, ...chairConflictGaps].sort(
    (left, right) => left.stableKey.localeCompare(right.stableKey),
  )) {
    const key = canonicalDigest({
      question: normalized(gap.question),
      reason: normalized(gap.reason),
      evidenceRefs: gap.evidenceRefs,
    });
    if (!uniqueGaps.has(key)) uniqueGaps.set(key, gap);
  }
  const gaps: OperatingDataGap[] = [...uniqueGaps.values()].map((proposal, index) => ({
    kind: 'operating-data-gap',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    id: `GAP-${String((input.existingGapCount ?? 0) + index + 1).padStart(3, '0')}`,
    cycleId: input.cycleId,
    question: proposal.question,
    reason: proposal.reason,
    unblocks: [],
    ...(proposal.affectedRoles ? { affectedRoles: proposal.affectedRoles } : {}),
    status: 'open',
    owner: input.config.decisionOwner,
    evidenceRefs: proposal.evidenceRefs,
    createdAt: now,
    updatedAt: now,
  }));

  await Promise.all([
    ...findings.map((record) => assertOperatingArtifact('operating-finding', record)),
    ...parked.map((record) => assertOperatingArtifact('operating-finding', record)),
    ...criticalOverflow.map((record) => assertOperatingArtifact('operating-finding', record)),
    ...decisions.map((record) => assertOperatingArtifact('operating-decision', record)),
    ...gaps.map((record) => assertOperatingArtifact('operating-data-gap', record)),
  ]);
  return { findings, parked, criticalOverflow, decisions, gaps };
}
