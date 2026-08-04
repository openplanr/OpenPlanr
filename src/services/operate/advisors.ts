import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { AIError } from '../../ai/errors.js';
import type { AIProvider } from '../../ai/types.js';
import { DEFAULT_MODELS } from '../../ai/types.js';
import type { OpenPlanrConfig } from '../../models/types.js';
import { OPENPLANR_VERSION } from '../../utils/package-version.js';
import { getAIProvider, isAIConfigured } from '../ai-service.js';
import { loadConfig } from '../config-service.js';
import { isPlanrArtifactId } from './artifacts.js';
import { canonicalDigest, canonicalize } from './canonical.js';
import { buildOperatingBootstrapMap, type OperatingBootstrapMap } from './context-research.js';
import {
  createMissionToolset,
  MISSION_READ_ONLY_TOOLS,
  narrowMissionRootsToCeiling,
  type OperatingDispatchIsolation,
  operatingRuntimeEnforcesBoundedReadOnly,
  resolveOperatingDispatchIsolation,
  runMissionDispatchFanOut,
} from './mission-dispatch.js';
import {
  assertOperatingArtifact,
  loadOperatingProtocol,
  resolveOperatingPipelineRoot,
} from './protocol.js';
import { sanitizeGeneratedPlainText } from './redaction.js';
import {
  OPERATE_PROTOCOL_VERSION,
  OPERATE_SCHEMA_VERSION,
  OperateError,
  type OperatingAdvisorBrief,
  type OperatingCharter,
  type OperatingDataGap,
  type OperatingEvidenceReadiness,
  type OperatingProviderManifest,
  type OperatingRoleId,
  type OperatingRoleResult,
  type OperatingSensitivity,
  type OperatingState,
} from './types.js';

const proposalSchema = z
  .object({
    proposalKey: z.string().regex(/^[A-Za-z0-9._-]+$/),
    type: z.enum(['finding', 'decision', 'data-gap', 'merge', 'sequence']),
    title: z.string().min(1),
    problem: z.string().min(1),
    proposal: z.string().min(1),
    impact: z.number().int().min(1).max(5),
    confidence: z.number().int().min(1).max(5),
    ease: z.number().int().min(1).max(5),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    evidenceRefs: z.array(z.string().regex(/^EVD-[A-Za-z0-9._-]+$/)).min(1),
    dependsOnProposalKeys: z.array(z.string().regex(/^[A-Za-z0-9._-]+$/)).optional(),
    conflictsWithProposalKeys: z.array(z.string().regex(/^[A-Za-z0-9._-]+$/)).optional(),
    sequenceProposalKeys: z
      .array(z.string().regex(/^[A-Za-z0-9._-]+$/))
      .min(2)
      .optional(),
  })
  .strict();
const advisorOutputSchema = z
  .object({
    outcome: z.enum(['proposals', 'quiet']),
    proposals: z.array(proposalSchema).max(20),
    gaps: z.array(z.string()),
    conflicts: z.array(z.string()),
  })
  .strict();
export type OperatingAdvisorResponse = z.infer<typeof advisorOutputSchema>;

// The mission proposal's citation shape, kept in lockstep with the anchor the
// record-time resolver validates (`operating-citation@1.4.0`): a repository path
// (relative, dot-prefixed roots allowed, no `..` traversal) / git revision /
// planr artifact (any real artifact class), optionally scoped to a workspace
// `componentId`, and bound to the cycle's frozen `pinnedRevision`. Each proposal
// carries `citations` INSTEAD of the v1.2 `evidenceRefs`; the resolver snapshots
// each citation after the lens returns and OpenPlanr never widens the set.
const missionCitationSchema = z
  .object({
    citationKey: z
      .string()
      .regex(/^[A-Za-z0-9._-]+$/)
      .max(128)
      .optional(),
    componentId: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,63}$/)
      .optional(),
    repositoryPath: z
      .string()
      .min(1)
      .max(1024)
      .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/)
      .optional(),
    lineRange: z
      .object({ start: z.number().int().min(1), end: z.number().int().min(1) })
      .strict()
      .optional(),
    gitRevision: z
      .string()
      .regex(/^[A-Fa-f0-9]{7,64}$/)
      .optional(),
    planrArtifactId: z
      .string()
      .refine(isPlanrArtifactId, 'must name a known planr artifact class')
      .optional(),
    pinnedRevision: z.string().regex(/^[A-Fa-f0-9]{7,64}$/),
  })
  .strict();
const missionProposalSchema = z
  .object({
    proposalKey: z.string().regex(/^[A-Za-z0-9._-]+$/),
    type: z.enum(['finding', 'decision', 'data-gap', 'merge', 'sequence']),
    title: z.string().min(1),
    problem: z.string().min(1),
    proposal: z.string().min(1),
    impact: z.number().int().min(1).max(5),
    confidence: z.number().int().min(1).max(5),
    ease: z.number().int().min(1).max(5),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    citations: z.array(missionCitationSchema).min(1).max(50),
    dependsOnProposalKeys: z.array(z.string().regex(/^[A-Za-z0-9._-]+$/)).optional(),
    conflictsWithProposalKeys: z.array(z.string().regex(/^[A-Za-z0-9._-]+$/)).optional(),
    sequenceProposalKeys: z
      .array(z.string().regex(/^[A-Za-z0-9._-]+$/))
      .min(2)
      .optional(),
  })
  .strict();
const missionAdvisorOutputSchema = z
  .object({
    outcome: z.enum(['proposals', 'quiet']),
    proposals: z.array(missionProposalSchema).max(20),
    gaps: z.array(z.string()),
    conflicts: z.array(z.string()),
  })
  .strict();
export type MissionAdvisorOutput = z.infer<typeof missionAdvisorOutputSchema>;

export interface AgentNativeAdvisorResponse {
  outcome: 'actions' | 'quiet' | 'partial';
  analysisMarkdown: string;
  claims: Array<{
    id: string;
    statement: string;
    epistemicStatus: 'observed' | 'inferred' | 'hypothesis' | 'owner-confirmed' | 'unknown';
    confidence: number;
    citations: Array<Record<string, unknown>>;
  }>;
  actions: Array<{
    actionKey: string;
    title: string;
    summary: string;
    lane: 'DEV' | 'OWNER' | 'AGENT';
    routeKind:
      | 'quick-task'
      | 'spec'
      | 'epic'
      | 'decision'
      | 'agent-artifact'
      | 'experiment'
      | 'metric';
    horizon: 'immediate' | 'next' | 'later';
    confidence: number;
    impact?: number;
    ease?: number;
    critical?: boolean;
    citations: Array<Record<string, unknown>>;
  }>;
  gaps: Array<{
    id: string;
    question: string;
    impact: string;
    ownerRequired?: boolean;
  }>;
  conflicts: Array<{
    id: string;
    summary: string;
    actionKeys: string[];
    /**
     * Present when the conflict is action-versus-commitment rather than
     * action-versus-action (operating-advisor-response v1.4, additive): the
     * published commitment the action collides with. Threaded into the rendered
     * conflict line — a commitment conflict that records but renders without its
     * commitment is recorded-but-not-surfaced, the failure class this batch removes.
     */
    commitmentRef?: { path: string; statement: string };
  }>;
}

function v14CitationToMission(
  value: Record<string, unknown>,
  pinnedRevision: string,
): z.infer<typeof missionCitationSchema> | null {
  // A `componentId` scopes a repository/git locator to a sibling workspace
  // component so it is resolved against that component's checkout, not the
  // control repository. Preserve it through the conversion.
  const componentId =
    typeof value.componentId === 'string' ? { componentId: value.componentId } : {};
  if (value.kind === 'repository') {
    return {
      ...componentId,
      repositoryPath: String(value.path),
      lineRange: { start: Number(value.startLine), end: Number(value.endLine) },
      pinnedRevision: String(value.revision),
    };
  }
  if (value.kind === 'git') {
    return {
      ...componentId,
      gitRevision: String(value.revision),
      pinnedRevision: String(value.revision),
    };
  }
  if (value.kind === 'planr') {
    return {
      planrArtifactId: String(value.artifactId),
      pinnedRevision,
    };
  }
  // External citations require a consented connected-research snapshot. They
  // cannot be silently converted into a local repository citation.
  return null;
}

/**
 * SINGLE source of truth for the action `routeKind` → committed proposal `type`
 * mapping. A Protocol v1.4 native ACTION carries a `routeKind`; the committed
 * proposal it becomes carries a `type` from the frozen proposal-type vocabulary.
 * Only a `decision` routeKind becomes a `decision` proposal; every other route
 * kind (`quick-task`, `spec`, `epic`, `agent-artifact`, `experiment`, `metric`)
 * becomes a `finding`. The registry-derived brief bounds
 * (`deriveRegistryProposalImage`), the native-response normalizer, and the
 * raw-response type projection all route through here so the three can never
 * disagree on what an action becomes — the exact divergence that let the Chair's
 * brief exclude `finding`/`decision` while every one of its actions mapped to
 * them, so the Chair could record ZERO actions and failed on any action at all.
 */
export function routeKindToProposalType(routeKind: string): 'finding' | 'decision' {
  return routeKind === 'decision' ? 'decision' : 'finding';
}

/** The two registry facets that drive a role's proposal bounds. */
const registryProposalBoundsSchema = z
  .object({
    allowedRouteKinds: z.array(z.string().min(1)).min(1),
    budgets: z.object({ maxActions: z.number().int().positive() }),
  })
  .passthrough();

interface AdvisorBriefRegistrySource {
  createOperatingAdvisorBrief(roleId: string): OperatingAdvisorBrief;
  listOperatingRoles(): Array<Record<string, unknown> & { id: string }>;
}

/**
 * The IMAGE of a role's registry `allowedRouteKinds` under `routeKindToProposalType`
 * — exactly the proposal types an action of one of those route kinds becomes, i.e.
 * the set an advisor's actions can ACTUALLY produce — plus the registry's action
 * cap (`budgets.maxActions`). `merge`/`sequence`/`data-gap` have no routeKind
 * pre-image and are intentionally absent here (no action can reach them; making
 * them action-expressible is a protocol question, not this derivation's job).
 */
function deriveRegistryProposalImage(role: Record<string, unknown> & { id: string }): {
  allowedProposalTypes: Array<'finding' | 'decision'>;
  maximumProposals: number;
} {
  const parsed = registryProposalBoundsSchema.safeParse(role);
  if (!parsed.success) {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      `Operating role registry entry ${role.id} is missing the allowedRouteKinds / budgets.maxActions needed to derive its proposal bounds.`,
    );
  }
  return {
    allowedProposalTypes: [
      ...new Set(parsed.data.allowedRouteKinds.map(routeKindToProposalType)),
    ].sort(),
    maximumProposals: parsed.data.budgets.maxActions,
  };
}

/**
 * Build a role's advisor brief with its proposal BOUNDS reconciled against the
 * live role registry — the single source of truth — so the registry and the
 * enforced runtime contract can never disagree again. The pipeline's pack-style
 * brief is a frozen Protocol v1.2 compatibility projection whose
 * `output.allowedProposalTypes` predate the v1.4 action model: for the Chair it is
 * `['merge','sequence']`, DISJOINT from the set every one of the Chair's actions
 * maps to (`finding`/`decision`). So the Chair could commit a quiet result but was
 * rejected the instant it proposed a single bounded route — the exact defect this
 * closes.
 *
 * Reconciliation:
 *  - `maximumProposals` is taken from the registry's `budgets.maxActions` (today
 *    already identical to the pipeline value for every role, but now set
 *    explicitly so a future registry cap edit cannot silently disagree with the
 *    runtime).
 *  - `allowedProposalTypes` is the UNION of the registry image and the frozen
 *    brief's existing types. The union ADDS the registry-reachable action types
 *    (`finding`/`decision`) — which is what unblocks the Chair — while LEAVING the
 *    frozen structural consolidation vocabulary (`merge`/`sequence` for the Chair;
 *    `data-gap` for the lenses) untouched: those have no action pre-image, so they
 *    are neither invented as action-reachable nor removed as capabilities. For
 *    every non-Chair role the image is already a subset of the frozen set, so the
 *    reconciliation is a byte-identical no-op there.
 *
 * The brief digest is recomputed over the reconciled content so the artifact stays
 * internally consistent; `canonicalize` here is the same RFC 8785 JCS the pipeline
 * signs briefs with, so a no-op reconciliation reproduces the pipeline digest
 * exactly.
 */
export function createRegistryReconciledAdvisorBrief(
  protocol: AdvisorBriefRegistrySource,
  roleId: string,
): OperatingAdvisorBrief {
  const brief = protocol.createOperatingAdvisorBrief(roleId);
  const role = protocol.listOperatingRoles().find((entry) => entry.id === roleId);
  if (!role) {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      `Operating role ${roleId} is absent from the registry; its proposal bounds cannot be reconciled.`,
    );
  }
  const image = deriveRegistryProposalImage(role);
  const allowedProposalTypes = [
    ...new Set<OperatingAdvisorBrief['output']['allowedProposalTypes'][number]>([
      ...brief.output.allowedProposalTypes,
      ...image.allowedProposalTypes,
    ]),
  ].sort();
  const { briefDigest: _priorDigest, ...unsigned } = {
    ...brief,
    output: {
      ...brief.output,
      allowedProposalTypes,
      maximumProposals: image.maximumProposals,
    },
  };
  return { ...unsigned, briefDigest: canonicalDigest(unsigned) };
}

export function normalizeAgentNativeResponse(
  response: AgentNativeAdvisorResponse,
  pinnedRevision: string,
): MissionAdvisorOutput {
  return {
    outcome: response.actions.length > 0 ? 'proposals' : 'quiet',
    proposals: response.actions.map((action) => ({
      proposalKey: action.actionKey,
      type: routeKindToProposalType(action.routeKind),
      title: action.title,
      problem: action.summary,
      proposal: action.summary,
      impact: action.impact ?? 3,
      confidence: action.confidence,
      ease: action.ease ?? 3,
      severity: action.critical
        ? 'critical'
        : (action.impact ?? 3) >= 4
          ? 'high'
          : (action.impact ?? 3) >= 3
            ? 'medium'
            : 'low',
      citations: action.citations
        .map((citation) => v14CitationToMission(citation, pinnedRevision))
        .filter((citation): citation is z.infer<typeof missionCitationSchema> => citation !== null),
    })),
    gaps: response.gaps.map((gap) => `${gap.question} Impact: ${gap.impact}`),
    conflicts: response.conflicts.map((conflict) =>
      conflict.commitmentRef
        ? `${conflict.summary} — conflicts with the published commitment "${conflict.commitmentRef.statement}" (${conflict.commitmentRef.path})`
        : conflict.summary,
    ),
  };
}

export function advisorResponseContractDetails(brief: OperatingAdvisorBrief): {
  expectedSchema: 'operating-advisor-response@1.2.0';
  example: unknown;
} {
  const examples = (brief.output.jsonSchema as { examples?: unknown } | undefined)?.examples;
  return {
    expectedSchema: 'operating-advisor-response@1.2.0',
    example: Array.isArray(examples)
      ? examples
      : [{ outcome: 'quiet', proposals: [], gaps: [], conflicts: [] }],
  };
}

/**
 * One advisor-response contract violation, in the canonical `{path, rule, detail}`
 * shape shared across every validation category so a runtime receives a single
 * uniform list to act on.
 */
export interface AdvisorContractIssue {
  path: string;
  rule: string;
  detail: string;
}

/**
 * SINGLE source of truth for the per-role proposal bounds — the proposal cap and
 * the allowed proposal types — over an already-projected `{type}` list. Both the
 * committed-output guard (`collectBriefContractViolations`) and the raw-response
 * batch validator (`collectAdvisorResponseContractIssues`) route through here so
 * the record path and the `harness validate` dry-run can never disagree on them.
 */
function collectProposalBoundViolations(
  brief: OperatingAdvisorBrief,
  proposals: ReadonlyArray<{ type?: string }>,
): AdvisorContractIssue[] {
  const issues: AdvisorContractIssue[] = [];
  if (proposals.length > brief.output.maximumProposals) {
    issues.push({
      path: 'proposals',
      rule: 'maximumProposals',
      detail: `Advisor ${brief.role.id} returned ${proposals.length} proposals; its canonical limit is ${brief.output.maximumProposals}.`,
    });
  }
  const allowed = new Set<string>(brief.output.allowedProposalTypes);
  const disallowed = [
    ...new Set(
      proposals
        .map((proposal) => proposal.type)
        .filter((type): type is string => typeof type === 'string' && !allowed.has(type)),
    ),
  ].sort();
  if (disallowed.length > 0) {
    issues.push({
      path: 'proposals',
      rule: 'allowedProposalTypes',
      detail: `Advisor ${
        brief.role.id
      } returned proposal types outside its canonical brief: ${disallowed.join(', ')}.`,
    });
  }
  return issues;
}

/**
 * Collect EVERY brief-level violation of a NORMALIZED advisor output — the
 * proposal cap, disallowed proposal types, outcome/proposal consistency, and the
 * output-byte ceiling — as `{path, rule, detail}` issues instead of throwing on
 * the first. `assertAdvisorOutputMatchesBrief` wraps this to keep its throwing
 * contract at the committed-output guards.
 */
export function collectBriefContractViolations(
  brief: OperatingAdvisorBrief,
  output: Pick<OperatingRoleResult, 'outcome' | 'proposals'>,
): AdvisorContractIssue[] {
  const issues = collectProposalBoundViolations(brief, output.proposals);
  if (output.outcome === 'quiet' && output.proposals.length > 0) {
    issues.push({
      path: 'outcome',
      rule: 'outcome-consistency',
      detail: `Advisor ${brief.role.id} declared a quiet result with proposals.`,
    });
  }
  if (output.outcome === 'proposals' && output.proposals.length === 0) {
    issues.push({
      path: 'outcome',
      rule: 'outcome-consistency',
      detail: `Advisor ${brief.role.id} declared proposals without a proposal.`,
    });
  }
  const outputBytes = Buffer.byteLength(canonicalize(output), 'utf8');
  if (outputBytes > brief.output.maximumOutputBytes) {
    issues.push({
      path: 'output',
      rule: 'maximumOutputBytes',
      detail: `Advisor ${brief.role.id} exceeded its canonical output budget.`,
    });
  }
  return issues;
}

export function assertAdvisorOutputMatchesBrief(
  brief: OperatingAdvisorBrief,
  output: Pick<OperatingRoleResult, 'outcome' | 'proposals'>,
): void {
  const violations = collectBriefContractViolations(brief, output);
  if (violations.length > 0) {
    throw new OperateError(
      'E_OPERATE_ADVISOR_FAILED',
      violations.length === 1
        ? violations[0].detail
        : `Advisor ${brief.role.id} output violates its canonical brief in ${violations.length} ways: ${violations
            .map((violation) => violation.detail)
            .join(' ')}`,
      { issues: violations },
    );
  }
}

/**
 * Project the proposal `{type}` list from a RAW submitted advisor response so the
 * per-role cap and allowed-type checks can run even on a schema-invalid payload —
 * a schema failure must never short-circuit the cap/type categories. v1.4 native
 * responses carry `actions` whose `routeKind` maps to a proposal type exactly as
 * `normalizeAgentNativeResponse` does (only `decision` is a decision proposal);
 * v1.3 responses carry `proposals` with an explicit `type`.
 */
function projectSubmittedProposalTypes(
  response: unknown,
  responseProtocol: '1.3.0' | '1.4.0',
): Array<{ type?: string }> {
  const record =
    response && typeof response === 'object' && !Array.isArray(response)
      ? (response as Record<string, unknown>)
      : {};
  if (responseProtocol === '1.4.0') {
    const actions = Array.isArray(record.actions) ? record.actions : [];
    return actions.map((action) => {
      const routeKind =
        action && typeof action === 'object' && !Array.isArray(action)
          ? (action as Record<string, unknown>).routeKind
          : undefined;
      return { type: routeKindToProposalType(typeof routeKind === 'string' ? routeKind : '') };
    });
  }
  const proposals = Array.isArray(record.proposals) ? record.proposals : [];
  return proposals.map((proposal) => {
    const type =
      proposal && typeof proposal === 'object' && !Array.isArray(proposal)
        ? (proposal as Record<string, unknown>).type
        : undefined;
    return { type: typeof type === 'string' ? type : undefined };
  });
}

/**
 * US-T1 batch validation: collect ALL advisor-response contract violations in one
 * pass — the response-schema issues (a bad enum, a wrong-typed `gaps[].impact`, a
 * malformed citation shape, …), the per-role proposal cap, and disallowed proposal
 * types — as a single `{path, rule, detail}` list. Shared verbatim by the `record`
 * path and the `harness validate` dry-run so the two can never diverge; the caller
 * decides whether a non-empty list is a rejection (record) or a dry-run report
 * (validate). Reads the RAW submitted response so a schema-invalid payload still
 * discloses its cap/type violations in the same response instead of forcing a
 * category-at-a-time resubmission cycle.
 */
export async function collectAdvisorResponseContractIssues(input: {
  brief: OperatingAdvisorBrief;
  response: unknown;
  protocolVersion: '1.3.0' | '1.4.0';
}): Promise<AdvisorContractIssue[]> {
  const protocol = await loadOperatingProtocol();
  const responseProtocol = input.protocolVersion === '1.4.0' ? '1.4.0' : '1.3.0';
  const issues: AdvisorContractIssue[] = [];
  // Category 1 — response schema (bad enum, wrong-typed gap impact, malformed
  // citation shape, missing required fields). The protocol validator already
  // returns EVERY schema issue at once; we only stop it from being the sole
  // category by continuing to the brief-level bounds below.
  for (const issue of protocol.validateProtocolArtifact(
    'operating-advisor-response',
    input.response,
    { protocolVersion: responseProtocol },
  )) {
    // Preserve the pipeline's specific failing rule (`enum`, `oneOf`, `type`, …)
    // rather than flattening every schema failure to one label, so a runtime sees
    // exactly which constraint each path violated.
    issues.push({ path: issue.path, rule: issue.rule, detail: issue.detail });
  }
  // Categories 2 & 3 — per-role proposal cap + disallowed proposal types, read
  // from the raw response so they surface alongside any schema issues.
  issues.push(
    ...collectProposalBoundViolations(
      input.brief,
      projectSubmittedProposalTypes(input.response, responseProtocol),
    ),
  );
  return issues;
}

export interface OperatingProviderManifestInput {
  id: string;
  providerId: string;
  providerVersion: string;
  mode: 'structured' | 'native-isolated';
  toolIsolation: 'enforced' | 'not-applicable';
  endpoint: OperatingProviderManifest['endpoint'];
  permittedDataClasses: OperatingProviderManifest['permittedDataClasses'];
  retention: OperatingProviderManifest['retention'];
  incremental: boolean;
  deep: boolean;
  limits: OperatingProviderManifest['limits'];
  consentPolicyVersion: string;
  renewalTriggers: OperatingProviderManifest['consent']['renewalTriggers'];
  configurationDigest: `sha256:${string}`;
}

interface AdvisorOpenItem {
  id: string;
  status: string;
  summary: string;
  owner: string | null;
  evidenceRefs: string[];
  affectedRoles?: string[];
}

export interface AdvisorOperatingContext {
  snapshotDigest: `sha256:${string}`;
  charter: OperatingCharter;
  priorCycle: {
    id: string;
    state: string;
    health: string | null;
    findings: number;
    decisions: number;
    gaps: number;
    pendingOutcomes: number;
  } | null;
  openDecisions: AdvisorOpenItem[];
  openGaps: AdvisorOpenItem[];
  pendingOutcomes: AdvisorOpenItem[];
}

export interface AdvisorRoleContext {
  snapshotDigest: `sha256:${string}`;
  charter: Partial<OperatingCharter>;
  priorCycle: AdvisorOperatingContext['priorCycle'];
  openDecisions: AdvisorOpenItem[];
  openGaps: AdvisorOpenItem[];
  pendingOutcomes: AdvisorOpenItem[];
}

const CHARTER_FIELDS_BY_ROLE: Record<OperatingRoleId, Array<keyof OperatingCharter>> = {
  'strategy-finance': [
    'purpose',
    'stage',
    'businessModel',
    'goals',
    'constraints',
    'successMetrics',
  ],
  'technology-risk': ['purpose', 'stage', 'goals', 'constraints', 'guardrails', 'knownUnknowns'],
  'product-activation': [
    'purpose',
    'stage',
    'idealCustomer',
    'goals',
    'successMetrics',
    'knownUnknowns',
  ],
  'growth-market': [
    'purpose',
    'stage',
    'businessModel',
    'idealCustomer',
    'goals',
    'successMetrics',
  ],
  'operations-customer': [
    'purpose',
    'stage',
    'idealCustomer',
    'goals',
    'constraints',
    'guardrails',
    'knownUnknowns',
  ],
  chair: [
    'purpose',
    'stage',
    'businessModel',
    'idealCustomer',
    'goals',
    'constraints',
    'successMetrics',
    'guardrails',
    'knownUnknowns',
  ],
};

function boundedContextText(value: unknown, maximum = 1_024): string {
  const text = typeof value === 'string' ? value : '';
  return sanitizeGeneratedPlainText(text).replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function charterSection(markdown: string, heading: string): string[] {
  const normalized = markdown.replace(/\r\n?/g, '\n');
  const marker = `## ${heading}`;
  const start = normalized.indexOf(marker);
  if (start < 0) return [];
  const body = normalized.slice(start + marker.length);
  const end = body.search(/\n##\s+/);
  return (end >= 0 ? body.slice(0, end) : body)
    .split('\n')
    .map((line) => line.match(/^\s*-\s+(.+?)\s*$/)?.[1] ?? '')
    .map((line) => boundedContextText(line))
    .filter((line) => line && !line.startsWith('[unknown') && !line.startsWith('[none recorded'));
}

function parseOperatingCharter(markdown: string): OperatingCharter {
  const product = charterSection(markdown, 'Product context');
  const productValues = new Map(
    product.flatMap((line) => {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      return match ? [[match[1].trim().toLowerCase(), match[2].trim()] as const] : [];
    }),
  );
  return {
    purpose: productValues.get('purpose') ?? '',
    stage: productValues.get('stage') ?? '',
    businessModel: productValues.get('business model') ?? '',
    idealCustomer: productValues.get('ideal customer') ?? '',
    goals: charterSection(markdown, 'Current goals').sort(),
    constraints: charterSection(markdown, 'Constraints').sort(),
    successMetrics: charterSection(markdown, 'Success metrics').sort(),
    guardrails: charterSection(markdown, 'Guardrails').sort(),
    knownUnknowns: charterSection(markdown, 'Known unknowns').sort(),
  };
}

function recordEvidenceRefs(record: Record<string, unknown>): string[] {
  return Array.isArray(record.evidenceRefs)
    ? [
        ...new Set(
          record.evidenceRefs.filter(
            (reference): reference is string => typeof reference === 'string',
          ),
        ),
      ].sort()
    : [];
}

function openItem(
  record: Record<string, unknown> & { id: string; status: string },
  summaryKeys: string[],
): AdvisorOpenItem {
  const summary =
    summaryKeys.map((key) => boundedContextText(record[key])).find(Boolean) ?? 'Review required.';
  return {
    id: record.id,
    status: record.status,
    summary,
    owner: boundedContextText(record.owner) || null,
    evidenceRefs: recordEvidenceRefs(record),
    ...(Array.isArray(record.affectedRoles)
      ? {
          affectedRoles: [
            ...new Set(
              record.affectedRoles.filter((role): role is string => typeof role === 'string'),
            ),
          ].sort(),
        }
      : {}),
  };
}

/** Build the immutable non-advisor context shared by all independent lenses. */
export async function buildAdvisorOperatingContext(input: {
  charterPath: string;
  state: OperatingState;
  cycleId: string;
}): Promise<AdvisorOperatingContext> {
  const charter = parseOperatingCharter(await readFile(input.charterPath, 'utf8'));
  const prior = [...input.state.cycles]
    .filter((cycle) => cycle.id !== input.cycleId)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .at(-1);
  const priorCycle = prior
    ? {
        id: prior.id,
        state: prior.state,
        health: typeof prior.health === 'string' ? prior.health : null,
        findings: input.state.findings.filter((finding) => finding.cycleId === prior.id).length,
        decisions: input.state.decisions.filter((decision) => decision.cycleId === prior.id).length,
        gaps: input.state.dataGaps.filter((gap) => gap.cycleId === prior.id).length,
        pendingOutcomes: input.state.outcomes.filter(
          (outcome) => outcome.sourceCycle === prior.id && outcome.status === 'pending',
        ).length,
      }
    : null;
  const openDecisions = input.state.decisions
    .filter((decision) => ['open', 'default-due'].includes(decision.status))
    .map((decision) => openItem(decision, ['question', 'recommendation']))
    .sort((left, right) => left.id.localeCompare(right.id));
  const openGaps = input.state.dataGaps
    .filter((gap) => ['open', 'answered'].includes(gap.status))
    .map((gap) => openItem(gap, ['question', 'reason']))
    .sort((left, right) => left.id.localeCompare(right.id));
  const pendingOutcomes = input.state.outcomes
    .filter((outcome) => ['pending', 'observing', 'inconclusive'].includes(outcome.status))
    .map((outcome) => openItem(outcome, ['metric', 'queryIdentity']))
    .sort((left, right) => left.id.localeCompare(right.id));
  const unsigned = {
    charter,
    priorCycle,
    openDecisions,
    openGaps,
    pendingOutcomes,
  };
  return { ...unsigned, snapshotDigest: canonicalDigest(unsigned) };
}

function roleContext(
  context: AdvisorOperatingContext,
  roleId: OperatingRoleId,
  permittedEvidenceRefs: ReadonlySet<string>,
): AdvisorRoleContext {
  const charter = Object.fromEntries(
    CHARTER_FIELDS_BY_ROLE[roleId].map((field) => [field, structuredClone(context.charter[field])]),
  ) as Partial<OperatingCharter>;
  const visible = (item: AdvisorOpenItem): boolean => {
    if (roleId === 'chair') return true;
    if (item.affectedRoles && item.affectedRoles.length > 0) {
      return item.affectedRoles.includes(roleId);
    }
    return (
      item.evidenceRefs.length === 0 ||
      item.evidenceRefs.some((reference) => permittedEvidenceRefs.has(reference))
    );
  };
  const filtered = {
    charter,
    priorCycle: context.priorCycle,
    openDecisions: context.openDecisions.filter(visible),
    openGaps: context.openGaps.filter(visible),
    pendingOutcomes: context.pendingOutcomes.filter(visible),
  };
  return { ...filtered, snapshotDigest: canonicalDigest(filtered) };
}

// Operating mandate (FR1/FR5) — the unit of dispatch that replaces mission
// packets. It carries the lens question, investigation mandate, declared read
// boundaries, response schema, and citation requirement — and, by construction,
// NO evidence body and NO evidence index. Built directly from the pipeline's
// published `lib/operate/mandate.mjs`; the registry is the source of truth.
// ---------------------------------------------------------------------------

export interface OperatingMandate {
  kind: 'operating-mandate';
  schemaVersion: '1.0.0';
  protocolVersion: '1.3.0' | '1.4.0';
  roleId: OperatingRoleId;
  phase?: 'bootstrap' | 'advisor' | 'chair';
  lensQuestion: string;
  mandate: string;
  investigationMandate: { examine: string[]; sufficientGrounding: string };
  boundaries: {
    roots: string[];
    sensitivityCeiling: OperatingSensitivity;
    forbiddenPaths: string[];
  };
  runtimeBinding?: {
    runtime: string;
    runtimeBinding: 'required';
    crossRuntimeFallback: false;
    executionMode: 'native-agent' | 'sequential-native';
    assurance: 'runtime-governed';
    toolIsolation: 'enforced' | 'advisory' | 'none' | 'enforced-read-only';
  };
  procedure?: string;
  responseSchema: 'operating-advisor-response@1.3.0' | 'operating-advisor-response@1.4.0';
  /**
   * US-T1: the DISCLOSED response contract the runtime must satisfy — the same
   * bounds `record` enforces, shipped so an advisor can dereference them instead
   * of only a `responseSchema` name it cannot resolve. Serialized verbatim from
   * the role's brief output facet (`attachMandateResponseContract`); it introduces
   * no new computation. Layered on by OpenPlanr AFTER the pipeline signs
   * `mandateDigest` — exactly like `researchGuidance` — so it never alters the
   * signed digest or the immutable mandate the digest pins. Absent only on the
   * compatibility/pre-disclosure path.
   */
  output?: {
    schema: OperatingAdvisorBrief['output']['schema'];
    jsonSchema: Record<string, unknown>;
    allowedProposalTypes: OperatingAdvisorBrief['output']['allowedProposalTypes'];
    maximumProposals: number;
    maximumOutputBytes: number;
    requiredBehavior: string[];
  };
  citationRequirement:
    | {
        everyClaimCited: true;
        citationShape: 'operating-citation@1.3.0';
        description: string;
      }
    | {
        materialClaimsCited: true;
        materialActionsCited: true;
        citationShape: 'operating-citation@1.4.0';
      };
  permissionPolicy?: {
    authority: 'runtime-session';
    planrGrantsPermissions: false;
    forbiddenEffects: string[];
  };
  mandateDigest: `sha256:${string}`;
  /**
   * FR12 research targeting. Attached by OpenPlanr AFTER the pipeline signs the
   * mandate digest, so it never alters `mandateDigest` or the pinned mandate
   * artifact — it is pure guidance layered over the immutable mandate. Present
   * only when the dispatcher threads a shared bootstrap map or a per-role budget;
   * the compatibility/harness path leaves it undefined and the mandate unchanged.
   */
  researchGuidance?: OperatingMandateResearchGuidance;
}

/**
 * Per-role research targeting (FR12): the one shared bootstrap map, role-specific
 * focus areas, search/read deduplication hints, a graceful per-role time budget,
 * and explicit stop-researching-and-synthesize criteria. This REPLACES the retired
 * evidence-pack input: it points a lens at the project's own indexes to reduce
 * duplicated discovery, and never caps what the lens may examine or truncates what
 * it returns — each role stays free to investigate further.
 */
export interface OperatingMandateResearchGuidance {
  /** The one shared bootstrap map, built once per cycle and referenced by every role. */
  bootstrapMap: OperatingBootstrapMap | null;
  bootstrapMapDigest: `sha256:${string}` | null;
  /** Role-specific focus areas (what this lens examines first). */
  focusAreas: string[];
  /** Search/read deduplication hints so lenses stop rediscovering the same files. */
  deduplicationHints: string[];
  /** Per-role research time budget (ms). Graceful: reaching it means synthesize, never cut off. */
  perRoleResearchBudgetMs: number | null;
  /** Explicit stop-researching-and-synthesize criteria in mandate prose. */
  stopResearchingAndSynthesize: string[];
}

/**
 * Bounded fan-out concurrency for advisor dispatch (FR12): a fixed pool caps how
 * many lenses research at once without limiting any single lens's depth.
 */
export const DEFAULT_OPERATING_DISPATCH_CONCURRENCY = 3;

/**
 * Default per-role research time budget (FR12). Generous by design: it is a signal
 * to STOP researching and synthesize, never a cut-off, so a role that reaches it
 * still returns its full analysis. Raising or removing it never truncates output.
 */
export const DEFAULT_OPERATING_ROLE_RESEARCH_BUDGET_MS = 8 * 60_000;

/**
 * Compose a role's FR12 research guidance from the shared bootstrap map and its
 * registry-derived investigation mandate. The stop criteria are explicit prose so
 * the lens knows WHEN to stop reading and synthesize; the budget line always states
 * that reaching the budget means concluding from what was gathered, never dropping
 * or truncating a conclusion to fit it.
 */
function buildMandateResearchGuidance(
  mandate: OperatingMandate,
  bootstrapMap: OperatingBootstrapMap | null,
  researchBudgetMs: number | null,
): OperatingMandateResearchGuidance {
  const budgetMs = researchBudgetMs && researchBudgetMs > 0 ? researchBudgetMs : null;
  const deduplicationHints = [
    'A shared bootstrap map already indexes this project’s planning families and recent git history; use its citations as entry points instead of re-walking the workspace to rediscover them.',
    ...(bootstrapMap?.searchHints ?? []),
  ];
  const stopResearchingAndSynthesize = [
    'Stop once every material claim and action is grounded in a resolvable citation and further reading no longer changes your ranked conclusions.',
    'Stop once you have reconciled the shared bootstrap map’s cited planning and git indexes for your focus areas against a direct reading of the relevant sources.',
    budgetMs
      ? `When your per-role research budget of ~${Math.round(budgetMs / 1000)}s elapses, synthesize from what you have gathered — the budget is a signal to conclude, never a cut-off. Return your full analysis and every citation-qualified action, and never drop or truncate a conclusion to fit it.`
      : 'When you reach your research time budget, synthesize from what you have gathered rather than continuing to read — never drop or truncate a conclusion to fit it.',
  ];
  return {
    bootstrapMap,
    bootstrapMapDigest: bootstrapMap?.mapDigest ?? null,
    focusAreas: [...(mandate.investigationMandate?.examine ?? [])],
    deduplicationHints,
    perRoleResearchBudgetMs: budgetMs,
    stopResearchingAndSynthesize,
  };
}

interface PipelineMandateApi {
  createOperatingMandate: (
    roleId: string,
    options: {
      roots?: string[];
      forbiddenPaths?: string[];
      runtime?: string;
      protocolVersion?: '1.3.0' | '1.4.0';
    },
  ) => OperatingMandate;
}

let cachedMandateApi: Promise<PipelineMandateApi> | null = null;

async function loadOperatingMandateApi(): Promise<PipelineMandateApi> {
  cachedMandateApi ??= (async () => {
    const root = resolveOperatingPipelineRoot({ requireMission: true });
    if (!root) {
      throw new OperateError(
        'E_OPERATE_MISSION_UNAVAILABLE',
        'Mandate dispatch requires the pipeline package with Protocol v1.3 (operating mandate).',
      );
    }
    const loaded = (await import(
      pathToFileURL(path.join(root, 'lib', 'operate', 'mandate.mjs')).href
    )) as Partial<PipelineMandateApi>;
    if (typeof loaded.createOperatingMandate !== 'function') {
      throw new OperateError(
        'E_PIPELINE_VERSION_INCOMPATIBLE',
        'Installed planr-pipeline does not export the Protocol v1.3 operating mandate builder.',
      );
    }
    return loaded as PipelineMandateApi;
  })();
  return cachedMandateApi;
}

/**
 * Build the Protocol v1.3 operating mandate for a role (FR1). The mandate's
 * boundaries are declared directly from the caller's granted workspace roots —
 * never an evidence-index-derived subset — so a gitignored `.planr/` tree is
 * fully readable when the caller declares it. The registry supplies the lens
 * question, investigation mandate, and sensitivity ceiling; this function only
 * threads the declared boundaries through.
 */
export async function buildOperatingMandate(input: {
  roleId: OperatingRoleId;
  roots: readonly string[];
  forbiddenPaths?: readonly string[];
  runtime?: string;
  protocolVersion?: '1.3.0' | '1.4.0';
  /**
   * FR12: the ONE shared bootstrap map built once per cycle, threaded to every
   * role's mandate so the five lenses reference the same targeting summary instead
   * of each re-walking the repository. Not an evidence-pack input — a body-free,
   * citation-bearing pointer set. Omitted on the compatibility/harness path.
   */
  bootstrapMap?: OperatingBootstrapMap;
  /** FR12: the graceful per-role research time budget stated in the mandate prose. */
  researchBudgetMs?: number;
}): Promise<OperatingMandate> {
  const api = await loadOperatingMandateApi();
  const mandate = api.createOperatingMandate(input.roleId, {
    roots: [...input.roots],
    forbiddenPaths: [...(input.forbiddenPaths ?? [])],
    runtime: input.runtime,
    protocolVersion: input.protocolVersion,
  });
  // Leave the harness/compatibility path byte-identical: research guidance is
  // attached only when a bootstrap map or a per-role budget is threaded in.
  if (input.bootstrapMap === undefined && input.researchBudgetMs === undefined) {
    return mandate;
  }
  return {
    ...mandate,
    researchGuidance: buildMandateResearchGuidance(
      mandate,
      input.bootstrapMap ?? null,
      input.researchBudgetMs ?? null,
    ),
  };
}

/**
 * US-T1: ship the disclosed response contract INSIDE the dispatched mandate.
 * Serializes the role brief's ALREADY-COMPUTED output facet (schema pointer, the
 * dereferenceable JSON Schema, allowed proposal types, the per-role proposal cap,
 * the output-byte ceiling, and required behaviors) onto the mandate as its
 * `output` block — no new computation, just disclosure of what `record` already
 * enforces. Layered on AFTER the pipeline signs `mandateDigest` (the returned
 * object keeps the pipeline's signed digest untouched), exactly like
 * `researchGuidance`, so no digest recomputation is required and writer/verifier
 * stay in agreement over the immutable, signed mandate the digest pins.
 */
export function attachMandateResponseContract(
  mandate: OperatingMandate,
  brief: OperatingAdvisorBrief,
): OperatingMandate {
  return {
    ...mandate,
    output: {
      schema: brief.output.schema,
      jsonSchema: brief.output.jsonSchema,
      allowedProposalTypes: [...brief.output.allowedProposalTypes],
      maximumProposals: brief.output.maximumProposals,
      maximumOutputBytes: brief.output.maximumOutputBytes,
      requiredBehavior: [...brief.output.requiredBehavior],
    },
  };
}

// A mandate's `boundaries.roots` items must satisfy this pattern (leading dot
// permitted, no `..` traversal), so `.planr` is a valid declared root.
const INLINE_MANDATE_ROOT_PATTERN = /^(?!.*\.\.)[A-Za-z0-9._][A-Za-z0-9._/-]*$/;

/**
 * FR1/FR2: derive a mandate's declared read roots directly from the project
 * working tree — every top-level directory the agent may traverse — for the
 * inline dispatch path. `.planr/` is ALWAYS declared, whether or not it exists
 * yet and REGARDLESS of git tracking, because the mission tool surface walks the
 * filesystem directly rather than a tracked-file inventory, so a gitignored `.planr/` tree
 * is fully readable (finding 2's tracked-file gap cannot reproduce here).
 * `.git`/`node_modules` are never declared, and every root is filtered to the
 * mandate's schema pattern. Mirrors the native adapter path's derivation so both
 * dispatch paths declare identical boundaries.
 */
export async function deriveOperatingMandateRoots(projectRoot: string): Promise<string[]> {
  const entries = await readdir(projectRoot, { withFileTypes: true }).catch(() => []);
  const roots = new Set<string>(['.planr']);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    if (INLINE_MANDATE_ROOT_PATTERN.test(entry.name)) roots.add(entry.name);
  }
  return [...roots].sort();
}

export interface AdvisorAdapter {
  id: string;
  mode: 'structured' | 'native-isolated';
  toolIsolation: 'enforced' | 'advisory' | 'none' | 'not-applicable';
  capability: 'analysis-standard' | 'analysis-high';
  /**
   * Native adapters may explicitly opt into parallel role dispatch. Structured
   * provider adapters stay sequential so their rate/cost envelope remains
   * deterministic. Results are restored to registry order before reduction.
   */
  parallelDispatch?: boolean;
  /**
   * FR1/FR2: a lens is dispatched with a body-free operating MANDATE (the lens
   * question, declared read boundaries, and the citation requirement) and the
   * cycle's pinned revision — never a curated evidence body. It investigates with
   * the host's own read tools and returns the mandate-versioned citation-bearing response; the
   * CLI resolves and snapshots every citation fail-closed after it returns.
   */
  invoke(input: {
    roleId: OperatingRoleId;
    roleBrief: OperatingAdvisorBrief;
    mandate: OperatingMandate;
    pinnedRevision: string;
    context: AdvisorRoleContext;
    inputDigest: `sha256:${string}`;
  }): Promise<unknown>;
}

export interface AdvisorDispatchResult {
  results: OperatingRoleResult[];
  provenance: Array<{
    roleId: OperatingRoleId;
    runtime: string;
    adapterId: string;
    capability: 'analysis-standard' | 'analysis-high';
    dispatch: 'parallel' | 'sequential';
    /** Effective isolation classification (FR10): enforced-read-only-bounded or unsupported. */
    isolation: OperatingDispatchIsolation;
    /** Audit note explaining the classification (e.g. why a runtime is unsupported for operate). */
    reconciliation: string;
  }>;
  skipped: Array<{ roleId: OperatingRoleId; gapId: string; reason: string }>;
  failed: Array<{ roleId: OperatingRoleId; message: string }>;
  /**
   * Governed gaps opened while resolving the dispatched roles' citations
   * (unresolvable-citation and empty-grounding gaps). The engine records them
   * alongside the cycle's other gaps; empty on a fully-resolved dispatch.
   */
  gaps: OperatingDataGap[];
  blocked: boolean;
  modelCalls: number;
}

/**
 * What a single role's dispatch actually resolved to, captured at dispatch time
 * so provenance reflects the executed path rather than a value re-derived after
 * the fact. `isolation` reads `enforced-read-only-bounded` only when the bounded
 * read-only grant was genuinely enforced for that role.
 */
interface RoleDispatchProvenance {
  isolation: OperatingDispatchIsolation;
  reconciliation: string;
}

/**
 * Convert a compact native-harness response into the canonical, digest-bound
 * Protocol result. Runtime adapters should not manufacture protocol metadata,
 * producer fields, or JCS digests themselves.
 */
function sanitizeMissionOutput(output: MissionAdvisorOutput): MissionAdvisorOutput {
  return {
    outcome: output.outcome,
    proposals: output.proposals
      .map((proposal) => ({
        ...proposal,
        title: sanitizeGeneratedPlainText(proposal.title).replace(/\s+/g, ' ').trim(),
        problem: sanitizeGeneratedPlainText(proposal.problem).replace(/\s+/g, ' ').trim(),
        proposal: sanitizeGeneratedPlainText(proposal.proposal).replace(/\s+/g, ' ').trim(),
        citations: [...proposal.citations],
        ...(proposal.dependsOnProposalKeys
          ? {
              dependsOnProposalKeys: [...new Set(proposal.dependsOnProposalKeys)].sort(),
            }
          : {}),
        ...(proposal.conflictsWithProposalKeys
          ? {
              conflictsWithProposalKeys: [...new Set(proposal.conflictsWithProposalKeys)].sort(),
            }
          : {}),
        ...(proposal.sequenceProposalKeys
          ? { sequenceProposalKeys: [...proposal.sequenceProposalKeys] }
          : {}),
      }))
      .sort(
        (left, right) =>
          left.proposalKey.localeCompare(right.proposalKey) ||
          left.type.localeCompare(right.type) ||
          left.problem.localeCompare(right.problem),
      ),
    gaps: [...new Set(output.gaps.map(sanitizeGeneratedPlainText))].sort(),
    conflicts: [...new Set(output.conflicts.map(sanitizeGeneratedPlainText))].sort(),
  };
}

/**
 * The mandate's response contract is `operating-advisor-response@1.3.0`, whose
 * output facet mirrors the v1.2 brief's contract (allowed proposal types,
 * maxima), so a v1.3 response is validated against exactly the same invariants a
 * pack response is — reusing the pipeline's registry-derived brief as the single
 * source of truth.
 *
 * FR2: when the response's citations resolve to ZERO evidence IDs across every
 * proposal, the role commits `not_evaluated` — a schema-legal `quiet` result
 * (the frozen v1.2 role-result schema admits no `not_evaluated` outcome; the
 * not_evaluated state lives in the governed gap + the integrity surface) — and
 * the governed empty-grounding gap the citation gate opened is returned, with
 * `notEvaluated: true`, rather than a `quiet` that pretends the lens evaluated.
 */
export async function createNativeMissionOperatingRoleResult(input: {
  mandate: OperatingMandate;
  cycleId: string;
  response: unknown;
  runtime: string;
  pinnedRevision?: string;
  /**
   * Injected citation resolver so the mandate response's citations flow into the
   * engine's already-live `gateRecordedProposalCitations` WITHOUT advisors.ts
   * importing engine.ts (which would create an import cycle). Given the
   * intermediate citation-bearing role result, it returns the gated result
   * (minted `evidenceRefs` merged in, unresolvable-citation proposals dropped),
   * the opened gaps, and the ids of roles whose citations resolved to zero
   * evidence (recorded not_evaluated).
   */
  resolveCitations: (roleResults: OperatingRoleResult[]) => Promise<{
    roleResults: OperatingRoleResult[];
    gaps: OperatingDataGap[];
    notEvaluatedRoleIds: string[];
  }>;
}): Promise<{
  result: OperatingRoleResult;
  gaps: OperatingDataGap[];
  notEvaluated: boolean;
}> {
  const protocol = await loadOperatingProtocol();
  const responseProtocol = input.mandate.protocolVersion === '1.4.0' ? '1.4.0' : '1.3.0';
  // Compact responses carry no protocol envelope, so select the schema from the
  // immutable mandate instead of allowing additive resolution to guess.
  const contractIssues = protocol.validateProtocolArtifact(
    'operating-advisor-response',
    input.response,
    { protocolVersion: responseProtocol },
  );
  if (contractIssues.length > 0) {
    throw new OperateError(
      'E_OPERATE_ADVISOR_FAILED',
      `Native ${input.mandate.roleId} response does not match operating-advisor-response@${responseProtocol}.`,
      { issues: contractIssues.slice(0, 8) },
    );
  }
  let output: MissionAdvisorOutput;
  if (responseProtocol === '1.4.0') {
    const response = input.response as AgentNativeAdvisorResponse;
    output = sanitizeMissionOutput(
      normalizeAgentNativeResponse(response, input.pinnedRevision ?? '0000000'),
    );
  } else {
    const parsed = missionAdvisorOutputSchema.safeParse(input.response);
    if (!parsed.success) {
      throw new OperateError(
        'E_OPERATE_INTERNAL',
        'Protocol and OpenPlanr disagree on the v1.3 mission advisor response contract.',
        {
          issues: parsed.error.issues.slice(0, 8).map((issue) => ({
            path: issue.path.join('.'),
            code: issue.code,
          })),
        },
      );
    }
    output = sanitizeMissionOutput(parsed.data);
  }
  const brief = createRegistryReconciledAdvisorBrief(protocol, input.mandate.roleId);
  assertAdvisorOutputMatchesBrief(
    brief,
    output as unknown as Pick<OperatingRoleResult, 'outcome' | 'proposals'>,
  );
  const capability = brief.role.capabilityTier as 'analysis-standard' | 'analysis-high';
  // The intermediate result: proposals carry their v1.3 citations and an empty
  // evidenceRefs set. It is deliberately NOT yet a v1.2-valid committed
  // operating-role-result — the citation gate mints the evidenceRefs that make
  // it one. `inputDigest` is the mandate's digest, so the record path's
  // input-digest binding (prepare stored the same mandate digest) holds.
  const intermediate = {
    kind: 'operating-role-result' as const,
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    cycleId: input.cycleId,
    roleId: input.mandate.roleId,
    inputDigest: input.mandate.mandateDigest,
    resultDigest: input.mandate.mandateDigest,
    outcome: output.outcome,
    proposals: output.proposals.map((proposal) => ({
      proposalKey: proposal.proposalKey,
      type: proposal.type,
      title: proposal.title,
      problem: proposal.problem,
      proposal: proposal.proposal,
      impact: proposal.impact,
      confidence: proposal.confidence,
      ease: proposal.ease,
      severity: proposal.severity,
      evidenceRefs: [] as string[],
      ...(proposal.dependsOnProposalKeys
        ? { dependsOnProposalKeys: proposal.dependsOnProposalKeys }
        : {}),
      ...(proposal.conflictsWithProposalKeys
        ? { conflictsWithProposalKeys: proposal.conflictsWithProposalKeys }
        : {}),
      ...(proposal.sequenceProposalKeys
        ? { sequenceProposalKeys: proposal.sequenceProposalKeys }
        : {}),
      citations: proposal.citations,
    })),
    gaps: output.gaps,
    conflicts: output.conflicts,
    producer: {
      product: 'openplanr',
      version: OPENPLANR_VERSION,
      runtime: input.runtime,
      capability,
    },
  } as unknown as OperatingRoleResult;

  // A quiet response has no proposals/citations, so it never touches the gate; a
  // proposals response threads its citations through the already-live gate.
  const gated =
    output.proposals.length > 0
      ? await input.resolveCitations([intermediate])
      : {
          roleResults: [intermediate],
          gaps: [] as OperatingDataGap[],
          notEvaluatedRoleIds: [] as string[],
        };
  const resolved = gated.roleResults[0] ?? intermediate;
  // FR2: a proposals response whose citations resolved to ZERO evidence is
  // not_evaluated — the gate returned this role in `notEvaluatedRoleIds` and
  // opened the governed empty-grounding gap. The committed artifact is a
  // schema-legal `quiet` result (no proposals); the not_evaluated state is
  // carried by the gap and the returned flag.
  const notEvaluated = gated.notEvaluatedRoleIds.includes(input.mandate.roleId);

  // Finalize into a v1.2-valid committed operating-role-result: strip the
  // now-resolved citations, keep the minted evidenceRefs, and let the surviving
  // proposal count set the honest outcome (a not_evaluated response commits as
  // quiet, its grounding failure preserved only as the opened gaps).
  const survivingProposals = notEvaluated
    ? []
    : resolved.proposals
        .map((proposal) => {
          const { citations: _citations, ...rest } = proposal as typeof proposal & {
            citations?: unknown;
          };
          return rest;
        })
        .filter((proposal) => proposal.evidenceRefs.length > 0);
  const unsigned = {
    kind: 'operating-role-result' as const,
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    cycleId: input.cycleId,
    roleId: input.mandate.roleId,
    inputDigest: input.mandate.mandateDigest,
    outcome: survivingProposals.length > 0 ? ('proposals' as const) : ('quiet' as const),
    proposals: survivingProposals,
    gaps: output.gaps,
    conflicts: output.conflicts,
    producer: {
      product: 'openplanr',
      version: OPENPLANR_VERSION,
      runtime: input.runtime,
      capability,
    },
  };
  const result: OperatingRoleResult = {
    ...unsigned,
    resultDigest: protocol.computeOperatingRoleResultDigest(unsigned as OperatingRoleResult),
  } as OperatingRoleResult;
  await assertOperatingArtifact('operating-role-result', result);
  protocol.validateOperatingRoleResultDigest(result);
  return { result, gaps: gated.gaps, notEvaluated };
}

function safeFailureMessage(error: unknown): string {
  try {
    return sanitizeGeneratedPlainText(error instanceof Error ? error.message : String(error));
  } catch {
    return 'Advisor failed with an unsafe or unredactable diagnostic.';
  }
}

export function assertAdvisorIsolation(adapter: AdvisorAdapter): void {
  if (
    adapter.mode === 'native-isolated' &&
    !['enforced', 'advisory', 'none'].includes(adapter.toolIsolation)
  ) {
    throw new OperateError(
      'E_OPERATE_ADVISOR_ISOLATION',
      'Native runtime advisors must declare their runtime-governed tool isolation.',
    );
  }
  if (adapter.mode === 'structured' && adapter.toolIsolation !== 'not-applicable') {
    throw new OperateError(
      'E_OPERATE_ADVISOR_ISOLATION',
      'Structured provider adapters must declare toolIsolation=not-applicable.',
    );
  }
}

export function createOfflineAdvisorAdapter(
  fixture?: Partial<Record<OperatingRoleId, unknown>>,
): AdvisorAdapter {
  return {
    id: 'offline-fixture',
    mode: 'structured',
    toolIsolation: 'not-applicable',
    capability: 'analysis-standard',
    parallelDispatch: false,
    async invoke(input) {
      if (fixture?.[input.roleId] !== undefined) return fixture[input.roleId];
      return input.mandate.protocolVersion === '1.4.0'
        ? {
            outcome: 'quiet',
            analysisMarkdown: `# ${input.roleBrief.role.displayLabel}\n\nOffline fixture mode produced no recommendations.`,
            claims: [],
            actions: [],
            gaps: [],
            conflicts: [],
          }
        : { outcome: 'quiet', proposals: [], gaps: [], conflicts: [] };
    },
  };
}

class OpenPlanrStructuredAdapter implements AdvisorAdapter {
  readonly id: string;
  readonly mode = 'structured' as const;
  readonly toolIsolation = 'not-applicable' as const;
  readonly capability = 'analysis-high' as const;
  readonly parallelDispatch = false;

  constructor(providerName: string) {
    this.id = `openplanr-${providerName}`;
  }

  async invoke(input: {
    roleId: OperatingRoleId;
    roleBrief: OperatingAdvisorBrief;
    mandate: OperatingMandate;
    pinnedRevision: string;
    context: AdvisorRoleContext;
    inputDigest: `sha256:${string}`;
  }): Promise<unknown> {
    void input;
    throw new OperateError(
      'E_OPERATE_PROVIDER_DEPRECATED',
      'The structured-provider advisor path is deprecated; dispatch now runs through the native Protocol v1.3 mandate harness. See https://openplanr.dev/docs/operate/agent-harness. Scheduled for removal in OpenPlanr 2.0.0.',
    );
  }
}

/** Redacted error class label for diagnostics — no message or stack, ever. */
function redactedProviderErrorClass(error: unknown): string {
  if (error instanceof AIError) return `AIError:${error.code}`;
  if (error instanceof Error && typeof error.name === 'string' && error.name.length > 0) {
    return error.name;
  }
  return 'UnknownError';
}

/**
 * Build the actionable remedy for a failed structured-provider bootstrap,
 * preserving the underlying provider guidance (e.g. the `planr config set-key`
 * block an AIError already carries) and always naming the `--offline` escape.
 */
function structuredProviderBootstrapRemedy(error: unknown, provider?: string): string {
  const detail =
    error instanceof AIError
      ? error.userMessage
      : error instanceof Error
        ? error.message
        : String(error);
  const trimmed = detail.trim();
  const suffixParts: string[] = [];
  if (!/config set-key/.test(trimmed)) {
    suffixParts.push(`Configure a key with \`planr config set-key ${provider ?? '<provider>'}\``);
  }
  if (!/--offline/.test(trimmed)) {
    suffixParts.push('or run the cycle offline with --offline');
  }
  const suffix = suffixParts.length > 0 ? ` ${suffixParts.join(' ')}.` : '';
  return `Structured AI provider bootstrap failed: ${trimmed}${suffix}`;
}

export async function createConfiguredStructuredAdapter(
  projectRoot: string,
  options: { quiet?: boolean } = {},
): Promise<AdvisorAdapter> {
  // `planr operate init` writes .planr/operate/config.json, not the project-wide
  // .planr/config.json that loadConfig requires. A project that ran only the
  // operate initializer therefore reaches this with no OpenPlanr config at all,
  // and loadConfig throws ConfigNotFoundError — an untyped failure that surfaces
  // as "an unexpected internal Operating Board error" on the primary first-run
  // path. Both the missing config and the unconfigured provider mean the same
  // thing to the operator, so both resolve to the same actionable error.
  const config = await loadConfig(projectRoot).catch(() => null);
  if (!config || !isAIConfigured(config)) {
    throw new OperateError(
      'E_OPERATE_ADVISOR_FAILED',
      'No structured AI provider is configured; use --offline or configure OpenPlanr AI.',
    );
  }
  // A named provider whose key cannot be resolved in this (possibly sandboxed)
  // subprocess environment makes getAIProvider throw a raw AIError. Left
  // unguarded it reaches index.ts's failure() as E_OPERATE_INTERNAL — the exact
  // masked crash the audit reproduced. Convert any provider-bootstrap failure
  // into a typed E_OPERATE_ADVISOR_FAILED that preserves the actionable remedy
  // (`planr config set-key …` / `--offline`) and records a redacted error class.
  let provider: AIProvider;
  try {
    provider = await getAIProvider(config, {
      surface: 'operate-structured-provider',
    });
  } catch (error) {
    throw new OperateError(
      'E_OPERATE_ADVISOR_FAILED',
      structuredProviderBootstrapRemedy(error, config.ai?.provider),
      { errorClass: redactedProviderErrorClass(error) },
    );
  }
  void provider;
  void options;
  return new OpenPlanrStructuredAdapter(config.ai?.provider ?? 'ai');
}

export async function dispatchOperatingAdvisors(input: {
  cycleId: string;
  /** Working tree the mandate's declared read boundaries are derived from. */
  projectRoot: string;
  /** The cycle's frozen control-repository revision; passed to each lens so it cites resolvable content. */
  pinnedRevision: string;
  readiness: OperatingEvidenceReadiness;
  context: AdvisorOperatingContext;
  adapter: AdvisorAdapter;
  depth: 'standard' | 'deep' | 'review-only';
  runtime?: string;
  /**
   * Fresh agent-native harnesses request the Protocol v1.4 narrative response.
   * Legacy direct/offline cycles retain v1.3 so already-prepared adapters and
   * resumable cycles remain readable during the compatibility window.
   */
  protocolVersion?: '1.3.0' | '1.4.0';
  /**
   * FR12: the graceful per-role research time budget (ms) stated in each mandate's
   * prose and available to the bounded fan-out. Defaults to
   * `DEFAULT_OPERATING_ROLE_RESEARCH_BUDGET_MS`. A signal to synthesize, never a
   * cut-off — it never truncates a role's output.
   */
  researchBudgetMs?: number;
  /**
   * FR12: bounded fan-out concurrency. Defaults to
   * `DEFAULT_OPERATING_DISPATCH_CONCURRENCY`. Caps how many lenses research at once
   * without limiting any single lens's depth; results stay registry-ordered.
   */
  concurrency?: number;
  /**
   * The engine's fail-closed citation gate, injected so advisors.ts never imports
   * engine.ts (which would create a cycle). Every dispatched role's mandate
   * response flows through it: it resolves each cited locator against the cycle's
   * pinned revision, snapshots the cited bytes, mints the evidenceRefs, drops
   * unresolvable-citation proposals, and records a role that grounds zero evidence
   * as not_evaluated. This is the single, universal FR2 gate on this path.
   */
  resolveCitations: (roleResults: OperatingRoleResult[]) => Promise<{
    roleResults: OperatingRoleResult[];
    gaps: OperatingDataGap[];
    notEvaluatedRoleIds: string[];
  }>;
}): Promise<AdvisorDispatchResult> {
  assertAdvisorIsolation(input.adapter);
  const protocol = await loadOperatingProtocol();
  const roleRegistry = protocol.listOperatingRoles() as Array<{
    id: OperatingRoleId;
  }>;
  // Canonical registry order so results and provenance are byte-identical across
  // parallel/sequential dispatch and across the order roles arrive in (FR4).
  const roleOrder = new Map(roleRegistry.map((role, index) => [role.id, index]));
  // The runtime's isolation level is recorded once per dispatch. Protocol v1.4
  // permits compatible native-agent workflows under runtime-governed session
  // permissions; citation and schema validation still gate persistence.
  const runtimeEnforcesBoundedReadOnly = await operatingRuntimeEnforcesBoundedReadOnly(
    input.runtime,
  );
  // A structured adapter cannot host a native lens. A native-isolated adapter
  // can host either an enforced or runtime-governed native workflow.
  const adapterNativeCapable = input.adapter.mode === 'native-isolated';
  const runtimeWorkflowCapable = adapterNativeCapable;
  const resolveIsolation = (
    roleId: OperatingRoleId,
  ): ReturnType<typeof resolveOperatingDispatchIsolation> =>
    resolveOperatingDispatchIsolation({
      roleId,
      runtimeEnforcesBoundedReadOnly,
      adapterNativeCapable,
      runtimeWorkflowCapable,
    });
  // FR1/FR2: the mandate's declared read roots are the whole granted workspace —
  // including a gitignored `.planr/` — never an evidence-index subset. Derived
  // once and shared by every role's mandate on this path.
  const roots = await deriveOperatingMandateRoots(input.projectRoot);
  const skipped: AdvisorDispatchResult['skipped'] = [];
  const runnable: OperatingEvidenceReadiness['roles'] = [];
  for (const role of input.readiness.roles) {
    if (!role.modelCallAllowed || role.readiness === 'not_evaluated') {
      skipped.push({
        roleId: role.roleId,
        gapId: role.gapId as string,
        reason: role.missingEvidence.join('; '),
      });
      continue;
    }
    runnable.push(role);
  }

  // FR12: build the ONE shared, citation-bearing bootstrap map for this cycle —
  // only when there is work to dispatch — and thread it, with the graceful per-role
  // research budget, into every role's mandate below. Built once here and referenced
  // by all runnable roles, never rebuilt per role, so five lenses stop
  // independently re-walking the same planning and git indexes.
  const researchBudgetMs = input.researchBudgetMs ?? DEFAULT_OPERATING_ROLE_RESEARCH_BUDGET_MS;
  const bootstrapMap =
    runnable.length > 0 ? await buildOperatingBootstrapMap(input.projectRoot) : null;

  type RoleDispatchOutcome =
    | {
        ok: true;
        result: OperatingRoleResult;
        gaps: OperatingDataGap[];
        modelCalls: number;
        dispatch: RoleDispatchProvenance;
      }
    | {
        ok: false;
        roleId: OperatingRoleId;
        message: string;
        modelCalls: number;
        dispatch: RoleDispatchProvenance;
      };

  async function dispatchRole(
    role: OperatingEvidenceReadiness['roles'][number],
  ): Promise<RoleDispatchOutcome> {
    // Resolve THIS role's dispatch mode once and derive provenance from what is
    // actually dispatched below — never re-derived after the fact. A role that
    // resolves to a native bounded lens has its read-only tool grant enforced
    // before the lens runs (below); `isolation` can only read
    // `enforced-read-only-bounded` when the bounded grant was genuinely enforced.
    const resolution = resolveIsolation(role.roleId);
    const dispatch: RoleDispatchProvenance = {
      isolation: resolution.isolation,
      reconciliation: resolution.reconciliation,
    };
    let mandate: OperatingMandate;
    try {
      // FR1: a body-free operating mandate — the lens question, declared read
      // boundaries, and citation requirement — replaces the curated evidence pack.
      // FR12: the shared bootstrap map and graceful per-role research budget are
      // threaded in as targeting guidance layered over the immutable mandate.
      mandate = await buildOperatingMandate({
        roleId: role.roleId,
        roots,
        runtime: input.runtime ?? input.adapter.id,
        protocolVersion: input.protocolVersion ?? '1.3.0',
        ...(bootstrapMap ? { bootstrapMap } : {}),
        researchBudgetMs,
      });
    } catch (error) {
      return {
        ok: false,
        roleId: role.roleId,
        message: safeFailureMessage(error),
        modelCalls: 0,
        dispatch,
      };
    }
    const roleBrief = createRegistryReconciledAdvisorBrief(protocol, role.roleId);
    const context = roleContext(input.context, role.roleId, new Set<string>());
    if (resolution.native) {
      // Confine the native lens to the bounded read-only toolset over the
      // mandate's declared roots. Constructing the toolset is what makes
      // `enforced-read-only-bounded` true; a callable outside the read-only grant
      // simply does not exist on the surface it hands the lens.
      const grantedRoots = narrowMissionRootsToCeiling({
        declaredRoots: mandate.boundaries.roots,
        forbiddenPaths: mandate.boundaries.forbiddenPaths,
      });
      const toolset = createMissionToolset({
        roots: grantedRoots,
        ceiling: mandate.boundaries.sensitivityCeiling,
      });
      const grantedTools = Object.keys(toolset);
      if (grantedTools.some((tool) => !MISSION_READ_ONLY_TOOLS.includes(tool as never))) {
        throw new OperateError(
          'E_OPERATE_PROVIDER_READ_ONLY',
          `Mission dispatch for ${role.roleId} assembled a tool outside the bounded read-only grant.`,
        );
      }
    }
    let built:
      | {
          result: OperatingRoleResult;
          gaps: OperatingDataGap[];
          notEvaluated: boolean;
        }
      | undefined;
    let lastError: unknown;
    let roleModelCalls = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        roleModelCalls += 1;
        const response = await input.adapter.invoke({
          roleId: role.roleId,
          roleBrief,
          mandate,
          pinnedRevision: input.pinnedRevision,
          context,
          inputDigest: mandate.mandateDigest,
        });
        // The mandate response's citations flow into the injected universal gate,
        // which mints the evidenceRefs that make the committed result v1.2-valid;
        // a response that grounds zero evidence commits not_evaluated (quiet) with
        // a governed gap. Identical finalization to the native adapter record path.
        built = await createNativeMissionOperatingRoleResult({
          mandate,
          cycleId: input.cycleId,
          response,
          runtime: input.runtime ?? input.adapter.id,
          pinnedRevision: input.pinnedRevision,
          resolveCitations: input.resolveCitations,
        });
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!built) {
      return {
        ok: false,
        roleId: role.roleId,
        message: safeFailureMessage(lastError),
        modelCalls: roleModelCalls,
        dispatch,
      };
    }
    return {
      ok: true,
      result: built.result,
      gaps: built.gaps,
      modelCalls: roleModelCalls,
      dispatch,
    };
  }

  // Fan the per-role dispatch out in parallel where the adapter reports it,
  // sequentially otherwise. FR12: the parallel path is bounded-concurrency so five
  // lenses do not all research at once, without limiting any single lens's depth.
  // Results are sorted into canonical registry order below so the reduced events
  // are byte-identical across parallel and sequential dispatch and across dispatch
  // order (FR4/E-004).
  const dispatched = await runMissionDispatchFanOut({
    items: runnable,
    parallel: Boolean(input.adapter.parallelDispatch),
    concurrency: input.concurrency ?? DEFAULT_OPERATING_DISPATCH_CONCURRENCY,
    run: (role) => dispatchRole(role),
  });
  const dispatchByRole = new Map<OperatingRoleId, RoleDispatchProvenance>();
  for (const entry of dispatched) {
    dispatchByRole.set(entry.ok ? entry.result.roleId : entry.roleId, entry.dispatch);
  }
  const okEntries = dispatched.filter(
    (entry): entry is Extract<RoleDispatchOutcome, { ok: true }> => entry.ok,
  );
  const results = okEntries
    .map((entry) => entry.result)
    .sort(
      (left, right) =>
        (roleOrder.get(left.roleId) ?? Number.MAX_SAFE_INTEGER) -
        (roleOrder.get(right.roleId) ?? Number.MAX_SAFE_INTEGER),
    );
  // The governed gaps opened while resolving each role's citations (unresolvable
  // citations, empty grounding) are threaded back so the engine records them
  // alongside the cycle's other gaps.
  const gaps = okEntries.flatMap((entry) => entry.gaps);
  const failed = dispatched
    .filter((entry): entry is Extract<RoleDispatchOutcome, { ok: false }> => !entry.ok)
    .map(({ roleId, message }) => ({ roleId, message }));
  const modelCalls = dispatched.reduce((total, entry) => total + entry.modelCalls, 0);
  return {
    results,
    provenance: results.map((result) => {
      const dispatchProvenance = dispatchByRole.get(result.roleId) ?? {
        isolation: resolveIsolation(result.roleId).isolation,
        reconciliation: resolveIsolation(result.roleId).reconciliation,
      };
      return {
        roleId: result.roleId,
        runtime: input.runtime ?? input.adapter.id,
        adapterId: input.adapter.id,
        capability: input.adapter.capability,
        dispatch: input.adapter.parallelDispatch ? ('parallel' as const) : ('sequential' as const),
        isolation: dispatchProvenance.isolation,
        reconciliation: dispatchProvenance.reconciliation,
      };
    }),
    skipped,
    failed,
    gaps,
    blocked:
      failed.some((entry) => entry.roleId === 'chair') ||
      (input.depth === 'deep' && failed.length > 0),
    modelCalls,
  };
}

/**
 * Standard-cycle advisor failures are governed data gaps, not ephemeral
 * warnings. IDs are temporary and are remapped against canonical state by the
 * cycle engine before persistence.
 */
export async function advisorFailureGaps(input: {
  cycleId: string;
  failed: AdvisorDispatchResult['failed'];
  readiness: OperatingEvidenceReadiness;
  owner: string;
  now: string;
}): Promise<OperatingDataGap[]> {
  const readinessByRole = new Map(input.readiness.roles.map((role) => [role.roleId, role]));
  const gaps = [...input.failed]
    .sort((left, right) => left.roleId.localeCompare(right.roleId))
    .map(({ roleId, message }, index) => {
      const role = readinessByRole.get(roleId);
      return {
        kind: 'operating-data-gap' as const,
        schemaVersion: OPERATE_SCHEMA_VERSION,
        protocolVersion: OPERATE_PROTOCOL_VERSION,
        id: `GAP-${String(index + 1).padStart(3, '0')}`,
        cycleId: input.cycleId,
        question: `What recovery or verified evidence is required to evaluate ${roleId}?`,
        reason: `Advisor ${roleId} failed after its bounded retry: ${safeFailureMessage(message)}`,
        unblocks: [],
        affectedRoles: [roleId],
        status: 'open' as const,
        owner: input.owner,
        evidenceRefs: [...new Set(role?.evidenceRefs ?? [])].sort(),
        createdAt: input.now,
        updatedAt: input.now,
      };
    });
  await Promise.all(gaps.map((gap) => assertOperatingArtifact('operating-data-gap', gap)));
  return gaps;
}

export async function readProviderConsent(
  projectRoot: string,
  providerId: string,
): Promise<OperatingProviderManifest | null> {
  return readFile(
    path.join(projectRoot, '.planr', 'operate', 'providers', `${providerId}.json`),
    'utf8',
  )
    .then(async (raw) => {
      const manifest = JSON.parse(raw) as OperatingProviderManifest;
      await assertOperatingArtifact('operating-provider-manifest', manifest);
      (await loadOperatingProtocol()).validateOperatingProviderPolicyDigest(manifest);
      return manifest;
    })
    .catch(() => null);
}

function providerPolicyCandidate(
  input: OperatingProviderManifestInput,
  acceptedAt: string,
  existing: OperatingProviderManifest | null,
): OperatingProviderManifest {
  return {
    kind: 'operating-provider-manifest',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    id: input.id,
    providerId: input.providerId,
    providerVersion: input.providerVersion,
    mode: input.mode,
    readOnly: true,
    endpoint: structuredClone(input.endpoint),
    permittedDataClasses: [...new Set(input.permittedDataClasses)].sort(),
    retention: structuredClone(input.retention),
    capabilities: {
      incremental: input.incremental,
      deep: input.deep,
      toolIsolation: input.toolIsolation,
    },
    limits: structuredClone(input.limits),
    consent: {
      policyVersion: input.consentPolicyVersion,
      status: existing ? 'renewed' : 'first-use',
      acceptedAt: existing?.consent.acceptedAt ?? acceptedAt,
      renewedAt: existing ? acceptedAt : null,
      nextReviewAt: new Date(Date.parse(acceptedAt) + 180 * 24 * 60 * 60 * 1_000).toISOString(),
      renewalTriggers: [...new Set(input.renewalTriggers)].sort(),
    },
    policyDigest: `sha256:${'0'.repeat(64)}`,
    configurationDigest: input.configurationDigest,
    capturedAt: acceptedAt,
  };
}

/**
 * Build and, only after explicit authority, persist the credential-free policy
 * that controls a remote advisor call. Keys and endpoint secrets never enter
 * the manifest.
 */
export async function ensureOperatingProviderConsent(input: {
  projectRoot: string;
  provider: OperatingProviderManifestInput;
  confirmed: boolean;
  persist?: boolean;
  now?: string;
}): Promise<{ manifest: OperatingProviderManifest; changed: boolean }> {
  const existing = await readProviderConsent(input.projectRoot, input.provider.providerId);
  const now = input.now ?? new Date().toISOString();
  const protocol = await loadOperatingProtocol();
  const candidate = providerPolicyCandidate(input.provider, now, existing);
  candidate.policyDigest = protocol.computeOperatingProviderPolicyDigest(candidate);
  await assertOperatingArtifact('operating-provider-manifest', candidate);
  protocol.validateOperatingProviderPolicyDigest(candidate);
  const changed =
    !existing ||
    existing.policyDigest !== candidate.policyDigest ||
    existing.configurationDigest !== candidate.configurationDigest ||
    Date.parse(existing.consent.nextReviewAt ?? '1970-01-01') <= Date.parse(now);
  if (!changed) return { manifest: existing, changed: false };
  if (!input.confirmed) {
    throw new OperateError(
      'E_OPERATE_AUTHORITY_REQUIRED',
      'The disclosed provider policy requires explicit first-use or renewal consent.',
      {
        provider: candidate.providerId,
        endpoint: candidate.endpoint,
        permittedDataClasses: candidate.permittedDataClasses,
        retention: candidate.retention,
        limits: candidate.limits,
        policyDigest: candidate.policyDigest,
      },
    );
  }
  if (input.persist !== false) {
    const directory = path.join(input.projectRoot, '.planr', 'operate', 'providers');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const target = path.join(directory, `${candidate.providerId}.json`);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${canonicalize(candidate)}\n`, { mode: 0o600 });
    await rename(temporary, target);
  }
  return { manifest: candidate, changed: true };
}

function providerEndpoint(config: OpenPlanrConfig): {
  kind: 'local' | 'remote';
  display: string;
  authentication: 'none' | 'machine-local';
  identity: string;
} {
  const provider = config.ai?.provider ?? 'openai';
  const configuredUrl = config.ai?.ollamaBaseUrl?.trim();
  const defaultUrl =
    provider === 'anthropic'
      ? 'https://api.anthropic.com'
      : provider === 'openai'
        ? 'https://api.openai.com'
        : 'http://127.0.0.1:11434';
  const identity = configuredUrl || defaultUrl;
  let display = provider === 'ollama' ? 'local Ollama' : `${provider} API`;
  try {
    const parsed = new URL(identity);
    display = `${provider} @ ${parsed.origin}`;
  } catch {
    display = `${provider} @ configured endpoint`;
  }
  return {
    kind: provider === 'ollama' ? 'local' : 'remote',
    display,
    authentication: provider === 'ollama' ? 'none' : 'machine-local',
    identity,
  };
}

export function configuredAdvisorProviderPolicy(input: {
  config: OpenPlanrConfig;
  adapterId: string;
  runtime: string;
}): OperatingProviderManifestInput {
  const provider = input.config.ai?.provider ?? 'openai';
  const model = input.config.ai?.model ?? DEFAULT_MODELS[provider];
  const endpoint = providerEndpoint(input.config);
  const local = endpoint.kind === 'local';
  const configurationDigest = canonicalDigest({
    provider,
    model,
    endpoint: endpoint.identity,
    runtime: input.runtime,
    adapterId: input.adapterId,
    permittedDataClasses: [
      'source-code',
      'planning-artifacts',
      'git-metadata',
      'issue-metadata',
      'project-metadata',
    ],
    retention: local
      ? { providerStoresRequestContent: false, maxProviderRetentionDays: 0 }
      : { providerStoresRequestContent: true, maxProviderRetentionDays: 30 },
  });
  return {
    id: `PRV-openplanr-${provider}`,
    providerId: `openplanr-${provider}`,
    providerVersion: '1.0.0',
    mode: 'structured',
    toolIsolation: 'not-applicable',
    endpoint: {
      kind: endpoint.kind,
      display: `${endpoint.display} · ${model}`,
      authentication: endpoint.authentication,
      redacted: true,
    },
    permittedDataClasses: [
      'source-code',
      'planning-artifacts',
      'git-metadata',
      'issue-metadata',
      'project-metadata',
    ],
    retention: {
      providerStoresRequestContent: !local,
      maxProviderRetentionDays: local ? 0 : 30,
      localEvidenceRetention: 'cycle',
    },
    incremental: false,
    deep: true,
    limits: {
      maxItems: 2_000,
      maxBytes: 10 * 1024 * 1024,
      maxDurationMs: 60_000,
      maxRequests: 12,
      maxTokens: 49_152,
      maxCostUsd: null,
    },
    consentPolicyVersion: '1.0.0',
    renewalTriggers: ['policy-change', 'scope-expansion', 'credential-renewal', 'scheduled-review'],
    configurationDigest,
  };
}
