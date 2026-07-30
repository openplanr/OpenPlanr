import { OperatingEventStore } from './event-store.js';
import { readPersistedOperatingRoleResults } from './maintenance.js';
import { renderOperatingBrief, selectCycleState } from './projection.js';
import { loadOperatingProtocol } from './protocol.js';
import { OperateError, type OperatingRoleId, type OperatingRoleResult } from './types.js';

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

function markdownLens(report: OperatingLensReport): string {
  const lines = [
    `## ${report.label}`,
    '',
    report.mandate,
    '',
    `Status: ${report.outcome}`,
    '',
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
  const [roleResults, roles] = await Promise.all([
    readPersistedOperatingRoleResults(store, cycleId),
    loadOperatingProtocol().then(
      (protocol) => protocol.listOperatingRoles() as unknown as ReportRole[],
    ),
  ]);
  const byRole = new Map(roleResults.map((result) => [result.roleId, result]));
  const reports = roles
    .filter((role) => !selectedRole || role.id === selectedRole)
    .map((role) => {
      const result = byRole.get(role.id as OperatingRoleId);
      return {
        roleId: role.id as OperatingRoleId,
        label: String(role.displayLabel),
        mandate: String(role.mandate),
        outcome: result?.outcome ?? 'not_evaluated',
        proposals: result?.proposals ?? [],
        gaps: result?.gaps ?? [],
        conflicts: result?.conflicts ?? [],
        resultDigest: result?.resultDigest ?? null,
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
  ];
  const brief = renderOperatingBrief(state);
  const markdown = [
    brief,
    '',
    '# Advisory lens reports',
    '',
    ...reports.flatMap((report) => [markdownLens(report), '']),
    '# Exact next actions',
    '',
    ...actions.map((action) => `- **${action.label}:** \`${action.command}\``),
  ]
    .join('\n')
    .trimEnd();
  return { cycleId, brief, reports, actions, markdown };
}
