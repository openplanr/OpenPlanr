import type {
  DecisionBriefEvidence,
  DecisionBriefOption,
  DecisionBriefSource,
} from './decision-brief.js';
import { OperatingEventStore } from './event-store.js';
import { OperatingEvidenceCache } from './evidence-cache.js';
import { buildOperatingIntegritySummary, renderOperatingIntegritySection } from './integrity.js';
import {
  readPersistedOperatingAdvisorReports,
  readPersistedOperatingRoleResults,
} from './maintenance.js';
import { renderOperatingBrief, selectCycleState } from './projection.js';
import { loadOperatingProtocol } from './protocol.js';
import { maximumSensitivity } from './redaction.js';
import { groupRelatedAcceptedFindings } from './routes.js';
import {
  OperateError,
  type OperatingRoleId,
  type OperatingRoleResult,
  type OperatingSensitivity,
  type OperatingState,
} from './types.js';
import { resolveOperatingPaths } from './workspace.js';

interface ReportRole {
  id: OperatingRoleId;
  displayLabel: string;
  mandate: string;
}

const LENS_ALIASES: Record<string, OperatingRoleId> = {
  ceo: 'strategy-finance',
  'strategy-finance': 'strategy-finance',
  cto: 'technology-risk',
  'technology-risk': 'technology-risk',
  cpo: 'product-activation',
  'product-activation': 'product-activation',
  cmo: 'growth-market',
  'growth-market': 'growth-market',
  coo: 'operations-customer',
  'operations-customer': 'operations-customer',
  chair: 'chair',
};

export interface OperatingLensReport {
  roleId: OperatingRoleId;
  label: string;
  mandate: string;
  outcome: OperatingRoleResult['outcome'] | 'not_evaluated';
  proposals: OperatingRoleResult['proposals'];
  gaps: string[];
  conflicts: string[];
  resultDigest: `sha256:${string}` | null;
  analysisMarkdown?: string;
  claims?: Array<Record<string, unknown>>;
  actions?: Array<Record<string, unknown>>;
}

function requestedLens(value?: string): OperatingRoleId | null {
  if (!value || value.toLowerCase() === 'all') return null;
  const role = LENS_ALIASES[value.toLowerCase()];
  if (!role) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      `Unknown operating lens ${value}. Use CEO, CTO, CPO, CMO, COO, Chair, or all.`,
    );
  }
  return role;
}

/**
 * Render a single role's advisory lens report as the exact Markdown the
 * `review`/`report` commands emit for that role. Exported so
 * `projection-persistence.ts` can persist each `cycles/<id>/board/<role>.md`
 * from the same assembly, guaranteeing the committed board file byte-matches
 * `planr operate report <cycleId> --lens <role>` (FR1). A role with no
 * advisor-result record renders honestly as `Status: not_evaluated`.
 */
export function markdownLens(report: OperatingLensReport): string {
  const lines = [
    `## ${report.label}`,
    '',
    report.mandate,
    '',
    `Status: ${report.outcome}`,
    '',
    ...(report.analysisMarkdown ? ['### Analysis', '', report.analysisMarkdown, ''] : []),
    ...(report.claims && report.claims.length > 0
      ? [
          '### Material claims',
          '',
          ...report.claims.map(
            (claim) =>
              `- **${String(claim.epistemicStatus ?? 'unknown')} · ${String(claim.confidence ?? '?')}/5** ${String(claim.statement ?? '')}`,
          ),
          '',
        ]
      : []),
    '### Recommendations',
    '',
    ...(report.proposals.length > 0
      ? report.proposals.map(
          (proposal) =>
            `- **${proposal.title}** (${proposal.severity}; I${proposal.impact} C${proposal.confidence} E${proposal.ease}) — ${proposal.proposal} Evidence: ${proposal.evidenceRefs.map((reference) => `\`${reference}\``).join(', ')}.`,
        )
      : ['- No evidence-backed recommendation was produced.']),
    '',
    '### Evidence gaps',
    '',
    ...(report.gaps.length > 0 ? report.gaps.map((gap) => `- ${gap}`) : ['- None.']),
    '',
    '### Conflicts',
    '',
    ...(report.conflicts.length > 0
      ? report.conflicts.map((conflict) => `- ${conflict}`)
      : ['- None.']),
  ];
  return lines.join('\n');
}

/**
 * FR8: the complete, uncapped registers appended to the persisted
 * `cycles/<id>/report.md` so the on-disk artifact is self-contained. The concise
 * brief `renderOperatingBrief` produces keeps its top-5/top-4 cap for the CLI's
 * `operate review`/`operate report` display; this renders every finding,
 * decision, evidence gap, and route with no `.slice()` cap, for the persisted
 * report path only. Callers pass the cycle-scoped state so the registers are
 * exactly this cycle's records.
 */
export function markdownCompleteRegisters(state: OperatingState): string {
  const evidence = (record: Record<string, unknown>): string => {
    const refs = [...new Set(stringArray(record.evidenceRefs))].sort();
    return refs.length > 0 ? refs.map((reference) => `\`${reference}\``).join(', ') : 'none';
  };
  const findings = [...state.findings].sort((left, right) => left.id.localeCompare(right.id));
  const decisions = [...state.decisions].sort((left, right) => left.id.localeCompare(right.id));
  const gaps = [...state.dataGaps].sort((left, right) => left.id.localeCompare(right.id));
  const routes = [...state.routes].sort((left, right) => left.id.localeCompare(right.id));
  return [
    '# Complete registers',
    '',
    'Every finding, decision, evidence gap, and route recorded for this cycle — the',
    'self-contained record the concise brief above deliberately caps.',
    '',
    `## All findings (${findings.length})`,
    '',
    ...(findings.length > 0
      ? findings.map(
          (finding) =>
            `- **${finding.id}** [${fieldText(finding, 'status') ?? 'proposed'} · ${
              fieldText(finding, 'lane') ?? 'OWNER'
            } · ${fieldText(finding, 'owner') ?? 'unassigned'} · ${
              fieldText(finding, 'severity') ?? 'low'
            }] ${fieldText(finding, 'title') ?? 'Untitled finding'} — ${
              fieldText(finding, 'proposal') ??
              fieldText(finding, 'problem') ??
              'Review the cited evidence.'
            } Evidence: ${evidence(finding)}.`,
        )
      : ['- None recorded.']),
    '',
    `## All decisions (${decisions.length})`,
    '',
    ...(decisions.length > 0
      ? decisions.map(
          (decision) =>
            `- **${decision.id}** [${fieldText(decision, 'status') ?? 'open'} · ${
              fieldText(decision, 'owner') ?? 'unassigned'
            }${fieldText(decision, 'deadline') ? ` · due ${fieldText(decision, 'deadline')}` : ''}] ${
              fieldText(decision, 'question') ?? 'Decision required'
            } Recommendation: ${
              fieldText(decision, 'recommendation') ?? 'Review the available options.'
            } Evidence: ${evidence(decision)}.`,
        )
      : ['- None recorded.']),
    '',
    `## All evidence gaps (${gaps.length})`,
    '',
    ...(gaps.length > 0
      ? gaps.map(
          (gap) =>
            `- **${gap.id}** [${fieldText(gap, 'status') ?? 'open'} · ${
              fieldText(gap, 'owner') ?? 'unassigned'
            }] ${fieldText(gap, 'question') ?? 'Evidence required'} — ${
              fieldText(gap, 'reason') ?? 'Evidence was not available.'
            } Evidence: ${evidence(gap)}.`,
        )
      : ['- None recorded.']),
    '',
    `## All routes (${routes.length})`,
    '',
    ...(routes.length > 0
      ? routes.map((route) => {
          const findingIds = stringArray(route.findingIds).sort();
          return `- **${route.id}** [${fieldText(route, 'state') ?? 'proposed'} · ${
            fieldText(route, 'cycleId') ?? ''
          }] findings: ${findingIds.length > 0 ? findingIds.join(', ') : 'none'}.`;
        })
      : ['- None recorded.']),
  ].join('\n');
}

/**
 * Assemble the human report for a governed cycle: the concise brief, the
 * per-role advisory lens reports, and the exact next actions, plus a single
 * rendered `markdown` string. This is the shared review/report Markdown
 * assembly — `lifecycle.ts`'s `readOperatingReview` human path reuses this
 * `markdown` output for `operate review` (FR3/E-003) rather than re-deriving the
 * per-role/actions logic, while the raw state object stays reserved for the
 * `--json` surface.
 */
export async function readOperatingReport(input: {
  projectRoot: string;
  cycleId?: string;
  lens?: string;
  localRoot?: string;
}): Promise<{
  cycleId: string;
  brief: string;
  reports: OperatingLensReport[];
  actions: Array<{
    kind: 'review' | 'finding' | 'route' | 'planning';
    label: string;
    command: string;
  }>;
  markdown: string;
}> {
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const fullState = await store.state();
  const cycleId = input.cycleId ?? fullState.summary.currentCycleId;
  if (!cycleId || !fullState.cycles.some((cycle) => cycle.id === cycleId)) {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      input.cycleId
        ? `Unknown operating cycle ${input.cycleId}.`
        : 'No operating cycle is available to report.',
    );
  }
  const selectedRole = requestedLens(input.lens);
  const [roleResults, richReports, roles] = await Promise.all([
    readPersistedOperatingRoleResults(store, cycleId),
    readPersistedOperatingAdvisorReports(store, cycleId),
    loadOperatingProtocol().then(
      (protocol) => protocol.listOperatingRoles() as unknown as ReportRole[],
    ),
  ]);
  const byRole = new Map(roleResults.map((result) => [result.roleId, result]));
  // FR7: the committed source of truth for a role's not_evaluated state is its
  // governed `missing-evidence` gap (the v1.2 role-result schema admits only
  // proposals|quiet|failed, so a citation-starved role commits a schema-legal
  // `quiet` result). Promote such a role to `not_evaluated` here and carry its
  // real gap reason, so neither the lens report nor the persisted board depends
  // on any advisory prose to reveal it.
  const integrity = buildOperatingIntegritySummary(fullState, cycleId);
  const notEvaluatedReasonsByRole = new Map<string, string[]>();
  for (const role of integrity.notEvaluatedRoles) {
    const existing = notEvaluatedReasonsByRole.get(role.roleId) ?? [];
    existing.push(role.reason);
    notEvaluatedReasonsByRole.set(role.roleId, existing);
  }
  const reports = roles
    .filter((role) => !selectedRole || role.id === selectedRole)
    .map((role) => {
      const result = byRole.get(role.id as OperatingRoleId);
      const rich = richReports.get(role.id);
      const notEvaluatedReasons = notEvaluatedReasonsByRole.get(role.id);
      const notEvaluated = notEvaluatedReasons !== undefined || result === undefined;
      const outcome: OperatingLensReport['outcome'] = notEvaluated
        ? 'not_evaluated'
        : (result as OperatingRoleResult).outcome;
      const gaps = [...(result?.gaps ?? [])];
      // When a role reads `not_evaluated` with no result-carried gap text, state
      // its real reason (from the governed gap) rather than defaulting to "- None."
      if (notEvaluated && gaps.length === 0 && notEvaluatedReasons) {
        gaps.push(...notEvaluatedReasons);
      }
      return {
        roleId: role.id as OperatingRoleId,
        label: String(role.displayLabel),
        mandate: String(role.mandate),
        outcome,
        proposals: notEvaluated ? [] : (result?.proposals ?? []),
        gaps,
        conflicts: result?.conflicts ?? [],
        resultDigest: result?.resultDigest ?? null,
        ...(rich
          ? {
              analysisMarkdown: rich.analysisMarkdown,
              claims: rich.claims as unknown as Array<Record<string, unknown>>,
              actions: rich.actions as unknown as Array<Record<string, unknown>>,
            }
          : {}),
      } satisfies OperatingLensReport;
    });
  const state = selectCycleState(fullState, cycleId);
  const actions: Array<{
    kind: 'review' | 'finding' | 'route' | 'planning';
    label: string;
    command: string;
  }> = [
    {
      kind: 'review' as const,
      label: 'Review the governed cycle',
      command: `planr operate review ${cycleId}`,
    },
    ...state.findings.map((finding) => ({
      kind: 'finding' as const,
      label: `Accept or reject ${finding.id}`,
      command: `planr operate findings show ${finding.id}`,
    })),
    ...state.findings.map((finding) => ({
      kind: 'planning' as const,
      label: `Create a quick task from ${finding.id}`,
      command: `planr quick create "Review operating finding ${finding.id}"`,
    })),
    ...state.findings.map((finding) => ({
      kind: 'planning' as const,
      label: `Create a task from ${finding.id} after selecting its story`,
      command: `planr task create --story <US-ID> --title "Address operating finding ${finding.id}" --manual`,
    })),
    ...state.routes.map((route) => ({
      kind: 'route' as const,
      label: `Preview ${route.id}`,
      command: `planr operate routes apply ${route.id} --preview`,
    })),
    ...state.routes
      .filter((route) =>
        ['create-spec', 'create-instrumentation-spec'].includes(
          String(
            (
              route as {
                actions?: Array<{ kind?: unknown }>;
              }
            ).actions?.[0]?.kind,
          ),
        ),
      )
      .map((route) => ({
        kind: 'planning' as const,
        label: `Create a governed spec from ${route.id}`,
        command: `planr operate routes apply ${route.id} --preview`,
      })),
    // FR7 — epic loop (rendering): group related ACCEPTED findings (shared
    // category / fingerprint lineage / Chair merge source, per
    // `groupRelatedAcceptedFindings`) and emit one ready-to-run `planr epic
    // create` suggestion naming the group's members. This is the human-facing
    // half of the same grouping the FR8 `create-epic` engine route encodes.
    ...groupRelatedAcceptedFindings(
      state.findings.filter((finding) => finding.status === 'accepted'),
    ).map((group) => ({
      kind: 'planning' as const,
      label: `Create an epic grouping ${group.memberIds.join(', ')}`,
      command: `planr epic create --title ${JSON.stringify(group.theme)}`,
    })),
  ];
  const brief = renderOperatingBrief(state);
  const markdown = [
    brief,
    '',
    '# Advisory lens reports',
    '',
    ...reports.flatMap((report) => [markdownLens(report), '']),
    // FR7: the readable tree carries cycle integrity as a first-class section,
    // sourced from the governed gaps — never contingent on a lens restating it.
    '# Integrity',
    '',
    renderOperatingIntegritySection(integrity),
    '',
    '# Exact next actions',
    '',
    ...actions.map((action) => `- **${action.label}:** \`${action.command}\``),
  ]
    .join('\n')
    .trimEnd();
  return { cycleId, brief, reports, actions, markdown };
}

// ── FR7 / E-007: self-contained decision-brief source assembly ───────────────
// A sibling of `readOperatingReport` that produces the structured brief/decision
// data consumed by `decision-brief.ts`'s self-contained rendering path, without
// duplicating the markdown-brief logic above. Evidence is carried as
// `{ ref, sensitivity }` only — never resolved content — so the ceiling filter
// applied at render time can drop above-ceiling citations safely.

type OperatingRecord = Record<string, unknown> & { id: string };

function fieldText(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * Resolve per-citation sensitivity for a set of evidence refs. Citation
 * snapshots are read at the maximum ceiling so sensitivity metadata is always
 * legible here; the configured ceiling is enforced later, at render time, by
 * dropping every above-ceiling citation. A ref with neither a snapshot nor a
 * finding-derived fallback defaults to `internal`, never a more shareable value.
 */
async function resolveEvidenceSensitivity(input: {
  projectRoot: string;
  localRoot?: string;
  refs: readonly string[];
  fallbackByRef: ReadonlyMap<string, OperatingSensitivity>;
}): Promise<DecisionBriefEvidence[]> {
  const paths = resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot });
  const cache = new OperatingEvidenceCache(paths.evidence, 'restricted');
  const unique = [
    ...new Set(input.refs.filter((ref) => typeof ref === 'string' && ref.trim())),
  ].sort();
  const resolved: DecisionBriefEvidence[] = [];
  for (const ref of unique) {
    let sensitivity = input.fallbackByRef.get(ref) ?? 'internal';
    try {
      const snapshot = await cache.getCitationSnapshot(ref);
      if (snapshot) sensitivity = snapshot.sensitivity;
    } catch {
      // An unreadable citation snapshot cannot lower its sensitivity; keep the
      // fallback so a citation is never treated as more shareable than it is.
    }
    resolved.push({ ref, sensitivity });
  }
  return resolved;
}

function findingSensitivityByRef(state: OperatingState): Map<string, OperatingSensitivity> {
  const byRef = new Map<string, OperatingSensitivity>();
  for (const finding of state.findings) {
    const sensitivity =
      (fieldText(finding, 'sensitivity') as OperatingSensitivity | undefined) ?? 'internal';
    for (const ref of stringArray(finding.evidenceRefs)) {
      byRef.set(ref, maximumSensitivity([byRef.get(ref) ?? 'public', sensitivity]));
    }
  }
  return byRef;
}

function decisionOptions(record: Record<string, unknown>): DecisionBriefOption[] {
  return (Array.isArray(record.options) ? record.options : [])
    .map((option) =>
      option &&
      typeof option === 'object' &&
      typeof (option as { label?: unknown }).label === 'string'
        ? { label: String((option as { label: string }).label) }
        : null,
    )
    .filter((option): option is DecisionBriefOption => option !== null);
}

function selectedOptionLabel(record: Record<string, unknown>): string | undefined {
  const selected = fieldText(record, 'selectedOption');
  if (!selected) return undefined;
  const match = (Array.isArray(record.options) ? record.options : []).find(
    (option) =>
      option && typeof option === 'object' && (option as { id?: unknown }).id === selected,
  ) as { label?: unknown } | undefined;
  return typeof match?.label === 'string' ? match.label : selected;
}

/**
 * Read the full decision record. The projected `state.decisions` intentionally
 * carries only the governance subset (no options/evidenceRefs/unblocks), so the
 * immutable decision fields are recovered from the `decision.open` event payload
 * and overlaid with the current governance status/selection from projected state.
 */
async function readFullOperatingDecision(
  store: OperatingEventStore,
  decisionId: string,
  projected: OperatingRecord | undefined,
): Promise<OperatingRecord> {
  const replay = await store.replay();
  let full: Record<string, unknown> | undefined;
  for (const event of replay.events) {
    if (event.entityId !== decisionId || event.type !== 'decision.open') continue;
    const record = (event.payload as { record?: unknown }).record;
    if (record && typeof record === 'object' && !Array.isArray(record)) {
      full = record as Record<string, unknown>;
    }
  }
  const base = full ?? projected;
  if (!base) {
    throw new OperateError('E_OPERATE_STATE_INVALID', `Unknown operating decision ${decisionId}.`);
  }
  return {
    ...base,
    ...(projected
      ? {
          status: projected.status,
          ...(projected.selectedOption !== undefined
            ? { selectedOption: projected.selectedOption }
            : {}),
        }
      : {}),
    id: decisionId,
  } as OperatingRecord;
}

function buildDecisionSource(
  decision: OperatingRecord,
  evidence: DecisionBriefEvidence[],
): DecisionBriefSource {
  const question = fieldText(decision, 'question') ?? 'Decision required';
  const unblocks = stringArray(decision.unblocks);
  const consequences = fieldText(decision, 'consequences');
  const blocksLines: string[] = [];
  if (unblocks.length > 0) {
    blocksLines.push('This decision blocks the following until it is made:');
    blocksLines.push(...unblocks.map((item) => `- ${item}`));
  }
  if (consequences) {
    if (blocksLines.length > 0) blocksLines.push('');
    blocksLines.push(consequences);
  }
  const facts: DecisionBriefSource['decision'] = {
    status: fieldText(decision, 'status'),
    owner: fieldText(decision, 'owner'),
    selectedOption: selectedOptionLabel(decision),
    recommendation: fieldText(decision, 'recommendation'),
    reversibility: fieldText(decision, 'reversibility'),
    deadline: fieldText(decision, 'deadline'),
    note: fieldText(decision, 'note'),
  };
  return {
    kind: 'decision',
    id: decision.id,
    cycleId: fieldText(decision, 'cycleId') ?? '',
    title: `${decision.id} — ${question}`,
    question,
    evidence,
    options: decisionOptions(decision),
    ...(blocksLines.length > 0 ? { blocks: blocksLines.join('\n') } : {}),
    decision: facts,
  };
}

function buildBriefSource(
  state: OperatingState,
  cycleId: string,
  evidence: DecisionBriefEvidence[],
): DecisionBriefSource {
  const surfaced = state.findings.filter(
    (finding) => finding.parked !== true && finding.status !== 'rejected',
  );
  const options: DecisionBriefOption[] = surfaced.slice(0, 6).map((finding) => ({
    label: `${finding.id}: ${fieldText(finding, 'title') ?? 'Untitled finding'}`,
    detail: `${fieldText(finding, 'lane') ?? 'OWNER'} · ${fieldText(finding, 'owner') ?? 'unassigned'} — ${fieldText(finding, 'proposal') ?? fieldText(finding, 'problem') ?? 'Review the cited evidence.'}`,
  }));
  const openDecisions = state.decisions.filter((decision) =>
    ['open', 'default-due'].includes(String(decision.status)),
  );
  const openGaps = state.dataGaps.filter((gap) => gap.status === 'open');
  const blocksLines: string[] = [];
  if (openDecisions.length > 0) {
    blocksLines.push('Owner decisions pending:');
    blocksLines.push(
      ...openDecisions
        .slice(0, 6)
        .map(
          (decision) =>
            `- ${decision.id}: ${fieldText(decision, 'question') ?? 'Decision required'}`,
        ),
    );
  }
  if (openGaps.length > 0) {
    if (blocksLines.length > 0) blocksLines.push('');
    blocksLines.push('Evidence gaps blocking progress:');
    blocksLines.push(
      ...openGaps
        .slice(0, 6)
        .map((gap) => `- ${gap.id}: ${fieldText(gap, 'question') ?? 'Evidence required'}`),
    );
  }
  const constraint = state.summary.currentConstraint;
  return {
    kind: 'brief',
    id: `operating-brief-${cycleId}`,
    cycleId,
    title: `OpenPlanr Operating Brief — ${cycleId}`,
    summary: `Cycle ${cycleId}. Evidence freshness: ${state.summary.evidenceFreshness}.`,
    ...(constraint ? { question: `Current constraint: ${constraint}` } : {}),
    evidence,
    ...(options.length > 0 ? { options } : {}),
    ...(blocksLines.length > 0 ? { blocks: blocksLines.join('\n') } : {}),
  };
}

/**
 * Assemble render-ready brief/decision data (FR7/E-007). With `decisionId`, the
 * result is a decision-focused source (question, cited evidence, options, and
 * what the decision blocks); otherwise it is the cycle brief. Evidence carries
 * only `{ ref, sensitivity }`, ready for the render-time sensitivity ceiling.
 */
export async function readOperatingDecisionBriefSource(input: {
  projectRoot: string;
  cycleId?: string;
  decisionId?: string;
  localRoot?: string;
}): Promise<DecisionBriefSource> {
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const fullState = await store.state();
  const fallbackByRef = findingSensitivityByRef(fullState);

  if (input.decisionId) {
    const projected = fullState.decisions.find((record) => record.id === input.decisionId) as
      | OperatingRecord
      | undefined;
    const decision = await readFullOperatingDecision(store, input.decisionId, projected);
    const evidence = await resolveEvidenceSensitivity({
      projectRoot: input.projectRoot,
      localRoot: input.localRoot,
      refs: stringArray(decision.evidenceRefs),
      fallbackByRef,
    });
    return buildDecisionSource(decision, evidence);
  }

  const cycleId = input.cycleId ?? fullState.summary.currentCycleId;
  if (!cycleId || !fullState.cycles.some((cycle) => cycle.id === cycleId)) {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      input.cycleId
        ? `Unknown operating cycle ${input.cycleId}.`
        : 'No operating cycle is available to render.',
    );
  }
  const state = selectCycleState(fullState, cycleId);
  const surfaced = state.findings.filter(
    (finding) => finding.parked !== true && finding.status !== 'rejected',
  );
  const openDecisions = state.decisions.filter((decision) =>
    ['open', 'default-due'].includes(String(decision.status)),
  );
  const openGaps = state.dataGaps.filter((gap) => gap.status === 'open');
  const refs = [
    ...surfaced.slice(0, 6).flatMap((finding) => stringArray(finding.evidenceRefs)),
    ...openDecisions.slice(0, 6).flatMap((decision) => stringArray(decision.evidenceRefs)),
    ...openGaps.slice(0, 6).flatMap((gap) => stringArray(gap.evidenceRefs)),
  ];
  const evidence = await resolveEvidenceSensitivity({
    projectRoot: input.projectRoot,
    localRoot: input.localRoot,
    refs,
    fallbackByRef,
  });
  return buildBriefSource(state, cycleId, evidence);
}
