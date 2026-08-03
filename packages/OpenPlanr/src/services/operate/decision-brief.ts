import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OperatingArtifactGenerationPlan } from './artifact-route-generation.js';
import type { OperatingIntegritySummary } from './integrity.js';
import { resolveOperatingPipelineRoot } from './protocol.js';
import { compareSensitivity, sanitizeGeneratedPlainText } from './redaction.js';
import {
  OperateError,
  type OperatingRoleId,
  type OperatingRoleResult,
  type OperatingSensitivity,
} from './types.js';
import { resolveContainedPath, resolveOperatingPaths } from './workspace.js';

/**
 * FR7 / E-007 — render `operate brief` and `operate decisions show` into a
 * single, self-contained, OFFLINE artifact a non-technical decision owner can
 * open without a terminal. Rendering is delegated to the pipeline builder
 * (`createOperatingDecisionBriefArtifact`), which fails closed on any
 * `http(s)://` reference (`E_OPERATE_DECISION_BRIEF_NOT_OFFLINE`). This module
 * never reimplements that renderer: it assembles the ceiling-filtered brief and
 * decision inputs, invokes the builder through the existing opaque-origin
 * sandbox surface, and writes the resulting HTML locally.
 *
 * Nothing here publishes or shares: a brief is written only when the operator
 * asks for it (the `--render` flag), to a project-contained path. Sensitivity
 * ceilings that gate collection (T-002) and dispatch (T-003) also gate rendered
 * content here — evidence above the configured ceiling is dropped before the
 * builder ever sees it, and free-text fields pass through the redaction path.
 */

/**
 * The opaque-origin sandbox contract reused from `artifact-route-generation.ts`
 * (`network: 'none', filesystem: 'none', tools: []`), the same posture proven
 * out for generated route artifacts. A decision brief is a fully-offline
 * reading document, so it additionally allows NO external URL scheme — the
 * pipeline builder rejects any `http(s)://` reference outright. The shape is
 * kept structurally compatible with the route sandbox so no new sandbox model
 * is invented (DoD point 5).
 */
export const OPAQUE_ORIGIN_DECISION_BRIEF_SANDBOX: {
  readonly network: OperatingArtifactGenerationPlan['sandbox']['network'];
  readonly filesystem: OperatingArtifactGenerationPlan['sandbox']['filesystem'];
  readonly tools: readonly [];
  readonly allowedUrlSchemes: readonly [];
} = Object.freeze({
  network: 'none',
  filesystem: 'none',
  tools: Object.freeze([]) as readonly [],
  allowedUrlSchemes: Object.freeze([]) as readonly [],
});

export interface DecisionBriefEvidence {
  ref: string;
  sensitivity: OperatingSensitivity;
}

export interface DecisionBriefOption {
  label: string;
  detail?: string;
}

export interface DecisionBriefDecisionFacts {
  status?: string;
  owner?: string;
  selectedOption?: string;
  recommendation?: string;
  reversibility?: string;
  deadline?: string;
  note?: string;
}

/**
 * Structured, render-ready brief/decision data assembled by `reports.ts`. It
 * carries evidence as `{ ref, sensitivity }` (never resolved content) so the
 * ceiling filter can drop above-ceiling citations without any sensitive text
 * ever reaching the renderer.
 */
export interface DecisionBriefSource {
  kind: 'brief' | 'decision';
  id: string;
  cycleId: string;
  title: string;
  summary?: string;
  question?: string;
  evidence: DecisionBriefEvidence[];
  options?: DecisionBriefOption[];
  blocks?: string;
  decision?: DecisionBriefDecisionFacts | null;
}

interface OperatingDecisionBriefArtifactEnvelope {
  schemaVersion: string;
  artifacts: Array<{
    id: string;
    kind: string;
    title: string;
    sha256: `sha256:${string}`;
    html: string;
    viewport: { width: number; height: number };
    colorScheme: string;
  }>;
  viewer: Record<string, unknown>;
}

type OperatingDecisionBriefBuilder = (
  brief: Record<string, unknown>,
  decision?: Record<string, unknown> | null,
) => OperatingDecisionBriefArtifactEnvelope;

export interface RenderedOperatingDecisionBrief {
  envelope: OperatingDecisionBriefArtifactEnvelope;
  html: string;
  sha256: `sha256:${string}`;
  sandbox: typeof OPAQUE_ORIGIN_DECISION_BRIEF_SANDBOX;
  redactedEvidenceRefs: string[];
  offline: true;
}

export interface WrittenOperatingDecisionBrief extends RenderedOperatingDecisionBrief {
  path: string;
  sensitivityCeiling: OperatingSensitivity;
}

/**
 * Load the pipeline's decision-brief builder from the installed pipeline root.
 * The absolute-file import mirrors `pipeline-handoff.ts` (the package `exports`
 * map does not expose the raw subpath). Fails closed when the pipeline is not
 * installed so a brief can never silently degrade to an in-repo reimplementation.
 */
async function loadOperatingDecisionBriefBuilder(): Promise<OperatingDecisionBriefBuilder> {
  const root = resolveOperatingPipelineRoot();
  if (!root) {
    throw new OperateError(
      'E_PIPELINE_NOT_INSTALLED',
      'Rendering a self-contained operating decision brief requires the full planr-pipeline package.',
      {
        recovery:
          'Run `npm install -g openplanr@latest` (without `--omit=optional`), then `planr setup --scope user`.',
      },
    );
  }
  const module = (await import(
    pathToFileURL(path.join(root, 'lib', 'pipeline', 'index.mjs')).href
  )) as { createOperatingDecisionBriefArtifact?: OperatingDecisionBriefBuilder };
  if (typeof module.createOperatingDecisionBriefArtifact !== 'function') {
    throw new OperateError(
      'E_PIPELINE_NOT_INSTALLED',
      'The installed pipeline does not expose the self-contained decision-brief renderer.',
    );
  }
  return module.createOperatingDecisionBriefArtifact;
}

/**
 * Drop every evidence citation whose sensitivity exceeds the configured
 * ceiling. Pure and deterministic: the kept citations preserve input order and
 * the redacted refs are returned de-duplicated and sorted for a stable record.
 */
export function filterEvidenceByCeiling(
  evidence: readonly DecisionBriefEvidence[],
  ceiling: OperatingSensitivity,
): { kept: DecisionBriefEvidence[]; redactedRefs: string[] } {
  const kept: DecisionBriefEvidence[] = [];
  const redactedRefs: string[] = [];
  for (const item of evidence) {
    if (compareSensitivity(item.sensitivity, ceiling) > 0) redactedRefs.push(item.ref);
    else kept.push(item);
  }
  return { kept, redactedRefs: [...new Set(redactedRefs)].sort() };
}

function redactedText(value: string | undefined): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const sanitized = sanitizeGeneratedPlainText(value).trim();
  return sanitized === '' ? undefined : sanitized;
}

function redactedFacts(
  decision: DecisionBriefDecisionFacts | null | undefined,
): Record<string, string> | null {
  if (!decision) return null;
  const facts: Record<string, string> = {};
  for (const key of [
    'status',
    'owner',
    'selectedOption',
    'recommendation',
    'reversibility',
    'deadline',
    'note',
  ] as const) {
    const value = redactedText(decision[key]);
    if (value !== undefined) facts[key] = value;
  }
  return Object.keys(facts).length > 0 ? facts : null;
}

/**
 * Assemble the ceiling-filtered, redacted brief/decision inputs for the
 * pipeline builder. Evidence above the ceiling is removed here — before the
 * renderer runs — and every free-text field passes through the redaction path,
 * so above-ceiling and secret-like content can never reach rendered output.
 */
export function buildDecisionBriefInput(
  source: DecisionBriefSource,
  ceiling: OperatingSensitivity,
): {
  brief: Record<string, unknown>;
  decision: Record<string, string> | null;
  redactedEvidenceRefs: string[];
} {
  const { kept, redactedRefs } = filterEvidenceByCeiling(source.evidence, ceiling);
  const evidence = kept.map((item) => item.ref);
  const options = (source.options ?? [])
    .map((option) => {
      const label = redactedText(option.label);
      if (label === undefined) return null;
      const detail = redactedText(option.detail);
      return detail === undefined ? { label } : { label, detail };
    })
    .filter((option): option is DecisionBriefOption => option !== null);

  const brief: Record<string, unknown> = {
    id: source.id,
    title: source.title.trim(),
  };
  const summary = redactedText(source.summary);
  if (summary !== undefined) brief.summary = summary;
  const question = redactedText(source.question);
  if (question !== undefined) brief.question = question;
  if (evidence.length > 0) brief.evidence = evidence;
  if (options.length > 0) brief.options = options;
  const blocks = redactedText(source.blocks);
  if (blocks !== undefined) brief.blocks = blocks;

  return {
    brief,
    decision: redactedFacts(source.decision),
    redactedEvidenceRefs: redactedRefs,
  };
}

/**
 * FR13 — the six mutually-exclusive states a role's contribution to the Chair can
 * be in. They are semantically different inputs for the Chair's synthesis and must
 * never collapse into one "missing" bucket:
 *
 *  - `recorded-evaluated` — the role returned and grounded at least one proposal;
 *  - `recorded-quiet` — the role returned cleanly with nothing to propose;
 *  - `not-evaluated` — a governed `missing-evidence` gap records that the role
 *    grounded zero evidence, carrying its real reason (never inferred);
 *  - `failed` — the role's dispatch or result errored, with the real error;
 *  - `still-running` — the role was expected but has recorded nothing yet and no
 *    terminal governed signal exists for it;
 *  - `citation-rejected` — every proposal the role returned was excluded because a
 *    cited location could not be resolved to evidence.
 *
 * This is the single classifier both the Chair's grounded evidence (engine's
 * `buildChairEvidence`) and any Chair-adjacent rendering here consume, so the
 * decision brief and Chair's own input can never disagree on a role's outcome.
 */
export type ChairRoleOutcome =
  | 'recorded-evaluated'
  | 'recorded-quiet'
  | 'not-evaluated'
  | 'failed'
  | 'still-running'
  | 'citation-rejected';

export interface ChairRoleContribution {
  roleId: OperatingRoleId;
  outcome: ChairRoleOutcome;
  /**
   * The real, committed reason a role is not-evaluated/failed/citation-rejected/
   * still-running — sourced from the governed gap, the failure, or the recorded
   * result, and NEVER a fabricated conclusion. `null` only for a role that
   * recorded a genuine analysis (`recorded-evaluated`/`recorded-quiet`).
   */
  reason: string | null;
  /** The governed gap id that recorded this outcome, when one exists. */
  gapId: string | null;
  /**
   * Proposal keys whose citations were rejected: excluded from the Chair's
   * grounded input and named in the gap list so nothing is silently dropped.
   */
  excludedProposalKeys: string[];
  /** Proposal keys that grounded valid evidence and feed the Chair's grounded input. */
  groundedProposalKeys: string[];
}

export interface ChairBoardContext {
  /**
   * Roles the cycle expected to hear from (typically `enabledRoles` minus
   * `chair`). Defaults to the roles that appear in `results` plus every role
   * named by a governed gap, failure, or rejection — so an expected role that
   * recorded nothing is still classified rather than silently omitted.
   */
  expectedRoles?: readonly OperatingRoleId[];
  /**
   * The committed integrity summary (from `buildOperatingIntegritySummary`): the
   * governed `missing-evidence` gaps that make a role `not-evaluated` and the
   * `unresolvable-citation`/boundary-refusal gaps behind `citation-rejected`.
   */
  integrity?: OperatingIntegritySummary;
  /** Dispatch-failed roles that committed no result: roleId → the real error reason. */
  failedReasons?: Readonly<Record<string, string>>;
  /**
   * Proposal keys the citation gate rejected, keyed by role: excluded from the
   * grounded input and named as gaps rather than silently dropped.
   */
  rejectedProposalKeys?: Readonly<Record<string, readonly string[]>>;
}

const CHAIR_OUTCOME_GAP_LABEL: Record<
  Exclude<ChairRoleOutcome, 'recorded-evaluated' | 'recorded-quiet'>,
  string
> = {
  'not-evaluated': 'did not evaluate this cycle',
  failed: 'failed before recording an analysis',
  'still-running': 'is still running and has recorded nothing yet',
  'citation-rejected': 'had every proposal rejected for an unresolvable citation',
};

/**
 * Classify each expected role's contribution to the Chair into one of the six
 * FR13 outcomes, sourced only from committed state — recorded results, governed
 * gaps, recorded failures, and the citation gate's rejections. Nothing is
 * inferred: a role is `not-evaluated` only when a governed gap says so, and no
 * conclusion is ever manufactured for an absent, failed, still-running, or
 * citation-rejected role.
 */
export function classifyChairRoleContributions(
  results: readonly OperatingRoleResult[],
  context: ChairBoardContext = {},
): ChairRoleContribution[] {
  const byRole = new Map(results.map((result) => [result.roleId, result]));

  const notEvaluatedByRole = new Map<
    string,
    OperatingIntegritySummary['notEvaluatedRoles'][number]
  >();
  for (const role of context.integrity?.notEvaluatedRoles ?? []) {
    if (!notEvaluatedByRole.has(role.roleId)) notEvaluatedByRole.set(role.roleId, role);
  }

  const citationByRole = new Map<string, OperatingIntegritySummary['citationRejections'][number]>();
  for (const entry of [
    ...(context.integrity?.citationRejections ?? []),
    ...(context.integrity?.boundaryRefusals ?? []),
  ]) {
    for (const roleId of entry.affectedRoles) {
      if (!citationByRole.has(roleId)) citationByRole.set(roleId, entry);
    }
  }

  const rejectedByRole = new Map<string, Set<string>>();
  for (const [roleId, keys] of Object.entries(context.rejectedProposalKeys ?? {})) {
    rejectedByRole.set(roleId, new Set(keys));
  }

  const expected = new Set<OperatingRoleId>();
  for (const roleId of context.expectedRoles ?? []) expected.add(roleId);
  for (const result of results) expected.add(result.roleId);
  for (const roleId of notEvaluatedByRole.keys()) expected.add(roleId as OperatingRoleId);
  for (const roleId of citationByRole.keys()) expected.add(roleId as OperatingRoleId);
  for (const roleId of Object.keys(context.failedReasons ?? {})) {
    expected.add(roleId as OperatingRoleId);
  }
  for (const roleId of rejectedByRole.keys()) expected.add(roleId as OperatingRoleId);

  const contributions = [...expected].map((roleId) => {
    const result = byRole.get(roleId);
    const rejectedKeys = rejectedByRole.get(roleId) ?? new Set<string>();
    const notEvaluated = notEvaluatedByRole.get(roleId);
    const citation = citationByRole.get(roleId);
    const failedReason = context.failedReasons?.[roleId];

    const proposalKeys = (result?.proposals ?? []).map((proposal) => proposal.proposalKey);
    const excludedProposalKeys = proposalKeys.filter((key) => rejectedKeys.has(key)).sort();
    const groundedProposalKeys = proposalKeys.filter((key) => !rejectedKeys.has(key));

    // FR13 — `citation-rejected` and `not-evaluated` are DISTINCT outcomes that
    // must never collapse: `citation-rejected` means the lens produced findings
    // that failed citation verification; `not-evaluated` means it produced nothing
    // groundable. The engine's empty-grounding gate opens BOTH a `missing-evidence`
    // gap (→ `notEvaluated`) AND a co-occurring `unresolvable-citation` gap (→
    // `citation`) for a role whose every proposal was rejected, so such a role is
    // `citation-rejected` — the more specific, honest cause — and it wins the
    // collision. A role with a `missing-evidence` gap and NO co-occurring citation
    // rejection (a genuine stall, sourced from the driver's governed gaps) stays
    // `not-evaluated`. The signal is the co-occurring rejection, never the gap's
    // prose, so a not-evaluated reason that merely mentions a citation is unaffected.
    const citationRejected =
      result !== undefined &&
      groundedProposalKeys.length === 0 &&
      (rejectedKeys.size > 0 || citation !== undefined);

    // Priority order matters. A governed not-evaluated gap is the honesty-bar
    // terminal (FR5: a role is never rendered not_evaluated without a governed
    // event and reason) and wins over a schema-legal `quiet` result the same role
    // may have committed — unless the role is citation-rejected, above. A recorded
    // failure or an explicit failure reason is next. Only then does a role with no
    // result read as still-running — never not-evaluated, which would claim a
    // governed outcome that was never recorded.
    let outcome: ChairRoleOutcome;
    let reason: string | null = null;
    let gapId: string | null = null;
    if (notEvaluated && !citationRejected) {
      outcome = 'not-evaluated';
      reason = notEvaluated.reason;
      gapId = notEvaluated.gapId;
    } else if (result?.outcome === 'failed' || failedReason) {
      outcome = 'failed';
      reason =
        failedReason ??
        (result && result.gaps.length > 0
          ? result.gaps.join('; ')
          : 'The advisor dispatch failed before an analysis was recorded.');
    } else if (!result) {
      outcome = 'still-running';
      reason = 'The advisor was dispatched but has not recorded a result yet.';
    } else if (citationRejected) {
      outcome = 'citation-rejected';
      reason = citation
        ? `${citation.reason}: ${citation.detail}`
        : 'Every proposal this role returned was rejected for an unresolvable citation.';
      gapId = citation?.gapId ?? null;
    } else if (groundedProposalKeys.length === 0) {
      outcome = 'recorded-quiet';
    } else {
      outcome = 'recorded-evaluated';
    }

    return {
      roleId,
      outcome,
      reason,
      gapId,
      excludedProposalKeys,
      groundedProposalKeys,
    } satisfies ChairRoleContribution;
  });

  return contributions.sort((left, right) => left.roleId.localeCompare(right.roleId));
}

/**
 * The named-gap lines the Chair's mandate consumes: one line per absent, failed,
 * still-running, or citation-rejected perspective stating its real reason, plus a
 * line for any recorded role that had individual proposals excluded for
 * unresolvable citations (so nothing is silently dropped). Every line explicitly
 * tells the Chair the perspective is absent and its conclusions must not be
 * synthesized — the structural guarantee behind FR13's "never invents a missing
 * role's conclusions", independent of any advisory prose.
 */
export function chairBoardGapLines(contributions: readonly ChairRoleContribution[]): string[] {
  const lines: string[] = [];
  for (const contribution of contributions) {
    if (
      contribution.outcome === 'recorded-evaluated' ||
      contribution.outcome === 'recorded-quiet'
    ) {
      if (contribution.excludedProposalKeys.length > 0) {
        lines.push(
          `${contribution.roleId}: ${contribution.excludedProposalKeys.length} proposal(s) ` +
            `excluded for unresolvable citations (${contribution.excludedProposalKeys.join(', ')})` +
            `${contribution.reason ? ` — ${contribution.reason}` : ''}. The role's remaining ` +
            'analysis is included.',
        );
      }
      continue;
    }
    const label = CHAIR_OUTCOME_GAP_LABEL[contribution.outcome];
    lines.push(
      `${contribution.roleId} ${label}${
        contribution.reason ? ` — ${contribution.reason}` : ''
      }. This perspective is absent from the board; surface it as a gap and do not ` +
        'synthesize its conclusions.',
    );
  }
  return lines;
}

/**
 * A compact, deterministic per-role Chair-board summary for Chair-adjacent
 * rendering (the decision-owner brief and the Chair's own input read from one
 * assembly, so they never disagree). Recorded roles show their real outcome;
 * absent perspectives are named as gaps, never papered over.
 */
export function renderChairBoardSummary(contributions: readonly ChairRoleContribution[]): string {
  if (contributions.length === 0) return '- No advisory lenses were expected this cycle.';
  return contributions
    .map((contribution) => {
      const detail =
        contribution.outcome === 'recorded-evaluated'
          ? `${contribution.groundedProposalKeys.length} grounded proposal(s)`
          : contribution.outcome === 'recorded-quiet'
            ? 'recorded, nothing to propose'
            : (contribution.reason ?? 'no reason recorded');
      const excluded =
        contribution.excludedProposalKeys.length > 0
          ? ` (excluded for unresolvable citations: ${contribution.excludedProposalKeys.join(', ')})`
          : '';
      return `- **${contribution.roleId}** — ${contribution.outcome}: ${detail}${excluded}`;
    })
    .join('\n');
}

/**
 * Render a ceiling-filtered brief/decision into a validated, self-contained
 * offline artifact envelope. The pipeline builder is authoritative for the
 * offline posture: any `http(s)://` reference in the rendered HTML fails closed
 * with `E_OPERATE_DECISION_BRIEF_NOT_OFFLINE`, which is allowed to propagate
 * unchanged (DoD: an external reference "fails closed via the pipeline error").
 */
export async function renderOperatingDecisionBriefArtifact(
  source: DecisionBriefSource,
  ceiling: OperatingSensitivity,
): Promise<RenderedOperatingDecisionBrief> {
  const build = await loadOperatingDecisionBriefBuilder();
  const { brief, decision, redactedEvidenceRefs } = buildDecisionBriefInput(source, ceiling);
  const envelope = build(brief, decision);
  const artifact = envelope.artifacts[0];
  if (artifact?.kind !== 'html' || typeof artifact.html !== 'string') {
    throw new OperateError(
      'E_OPERATE_ARTIFACT_REJECTED',
      'The decision-brief renderer did not return a single HTML artifact.',
    );
  }
  return {
    envelope,
    html: artifact.html,
    sha256: artifact.sha256,
    sandbox: OPAQUE_ORIGIN_DECISION_BRIEF_SANDBOX,
    redactedEvidenceRefs,
    offline: true,
  };
}

/**
 * Read the machine-local sensitivity ceiling. Mirrors the collection/dispatch
 * paths: the ceiling defaults to `internal` when preferences are absent so a
 * brief is never rendered with a more permissive posture than collection used.
 */
export async function readOperatingSensitivityCeiling(
  projectRoot: string,
  options: { localRoot?: string } = {},
): Promise<OperatingSensitivity> {
  const paths = resolveOperatingPaths(projectRoot, { localRoot: options.localRoot });
  const preferences = await readFile(path.join(paths.localRoot, 'preferences.json'), 'utf8')
    .then((raw) => JSON.parse(raw) as { sensitivityCeiling?: OperatingSensitivity })
    .catch(() => ({ sensitivityCeiling: 'internal' as const }));
  return preferences.sensitivityCeiling ?? 'internal';
}

/**
 * Render a brief/decision and write its self-contained HTML to a
 * project-contained destination. This is the share-on-request boundary:
 * nothing is written unless the operator supplied `--render <path>`, and the
 * file is written with restrictive permissions to the local project only. When
 * `ceiling` is omitted it is resolved from the machine-local preferences.
 */
export async function writeOperatingDecisionBriefArtifact(input: {
  projectRoot: string;
  destination: string;
  source: DecisionBriefSource;
  ceiling?: OperatingSensitivity;
  localRoot?: string;
}): Promise<WrittenOperatingDecisionBrief> {
  const ceiling =
    input.ceiling ??
    (await readOperatingSensitivityCeiling(input.projectRoot, { localRoot: input.localRoot }));
  const target = await resolveContainedPath(input.projectRoot, input.destination);
  const rendered = await renderOperatingDecisionBriefArtifact(input.source, ceiling);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, rendered.html, { mode: 0o600 });
  await rename(temporary, target);
  return { ...rendered, path: target, sensitivityCeiling: ceiling };
}
